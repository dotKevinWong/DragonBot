import {
  DiscordAPIError,
  EmbedBuilder,
  RESTJSONErrorCodes,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import type { Logger } from "pino";
import type { HoneypotAction } from "@dragonbot/db";
import type { GuildService } from "../services/guild.service.js";
import { WARNING_COLOR, WARNING_TITLE, warningText, type HoneypotService } from "../services/honeypot.service.js";
import type { LoggingService } from "../services/logging.service.js";
import { TTLCache } from "../utils/cache.js";

/** A notice with the same text goes to a server's log channel at most once in this many seconds. */
const NOTICE_REPEAT_SECONDS = 86_400;

/** How many of the honeypot channel's pins are searched for a warning to adopt. */
const PINS_SEARCHED = 50;

const PIN_REASON = "Honeypot warning";

/** The most warnings one sync posts when each is deleted before it can be pinned. */
const MAX_POSTS_PER_SYNC = 3;

interface StoredWarning {
  channelId: string;
  messageId: string;
}

/** What pinning a warning found. "gone" is Unknown Message: the warning was deleted. Any other failure has been reported. */
type PinResult = "pinned" | "gone" | "failed";

/** The pinned warning: the title and the wording for the action, and nothing else. */
export function buildWarningEmbed(action: HoneypotAction): EmbedBuilder {
  return new EmbedBuilder().setColor(WARNING_COLOR).setTitle(WARNING_TITLE).setDescription(warningText(action));
}

function hasErrorCode(err: unknown, ...codes: number[]): boolean {
  return err instanceof DiscordAPIError && typeof err.code === "number" && codes.includes(err.code);
}

/** Unknown Message or Unknown Channel: the warning, or its channel, no longer exists. */
function isGone(err: unknown): boolean {
  return hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel);
}

/** Why a Discord call failed, short enough for a notice. */
function reasonFor(err: unknown): string {
  const reason = err instanceof Error && err.message ? err.message : String(err);
  return reason.slice(0, 200);
}

/**
 * Keeps each server's honeypot warning posted and pinned in its honeypot channel, and removes it when the honeypot
 * is turned off or moved. A sync compares the warning that should exist with the one that does and fixes only the
 * difference, so running it twice changes nothing. The honeypot enforces only while a warning's IDs are stored,
 * so IDs are stored only for a warning that is posted, and a warning found gone never keeps its IDs.
 */
export class HoneypotWarningSync {
  private log: Logger;
  /** Notices already sent, by server and text, so a lasting problem is reported once a day, not on every sync. */
  private noticesSent = new TTLCache<true>(NOTICE_REPEAT_SECONDS);
  /** The sync waiting for each server's lock, which later requests for that server join. */
  private waitingSyncs = new Map<string, Promise<void>>();

  constructor(
    private client: Client,
    private guildService: GuildService,
    private honeypot: HoneypotService,
    private logging: LoggingService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "honeypot-warning" });
  }

  /**
   * Brings one server's warning in line with its settings, one sync per server at a time. Never rejects.
   * A request made while a sync for the server is still waiting to start joins that sync, which reads the settings
   * when it starts. Otherwise a bot deleting each new warning on arrival, which sends a sync request per repost,
   * would queue syncs faster than they run.
   */
  sync(guildId: string): Promise<void> {
    const waiting = this.waitingSyncs.get(guildId);
    if (waiting) return waiting;
    const run = this.honeypot
      .runExclusive(guildId, () => {
        // Started: from here on it may have read the settings, so a new request needs a sync of its own.
        this.waitingSyncs.delete(guildId);
        return this.reconcile(guildId);
      })
      .catch((err: unknown) => {
        this.log.warn({ err, guildId }, "Honeypot warning sync failed");
      });
    this.waitingSyncs.set(guildId, run);
    return run;
  }

  /** Syncs, one after another, every server that is configured or still has a stored warning to remove. Never rejects. */
  async syncAll(): Promise<void> {
    try {
      // Each settings write drops its server from the cache (at startup the birthday check writes just before this
      // runs), so the cache alone can miss servers. Re-read them all first.
      await this.guildService.hydrateAll();
    } catch (err) {
      this.log.warn({ err }, "Couldn't re-read the guild settings before the honeypot warning sync; syncing the cached servers");
    }
    const guildIds = this.guildService
      .getAllCached()
      .filter((row) => (row.isHoneypotEnabled && row.honeypotChannelId) || row.honeypotWarningMessageId)
      .map((row) => row.guildId);
    for (const guildId of guildIds) {
      await this.sync(guildId);
    }
  }

  /** Runs inside the server's lock, so it must never call sync for the same server: the lock isn't re-entrant. */
  private async reconcile(guildId: string): Promise<void> {
    // From the database, not the cache, which can be stale after a hydrateAll.
    const row = await this.guildService.getSettingsFresh(guildId);
    if (!row) return;

    const desired =
      row.isHoneypotEnabled && row.honeypotChannelId
        ? { channelId: row.honeypotChannelId, action: row.honeypotAction }
        : null;
    let stored: StoredWarning | null =
      row.honeypotWarningChannelId && row.honeypotWarningMessageId
        ? { channelId: row.honeypotWarningChannelId, messageId: row.honeypotWarningMessageId }
        : null;
    if (!desired && !stored) return;

    let guild: Guild;
    try {
      guild = await this.client.guilds.fetch(guildId);
    } catch {
      return; // DragonBot isn't in that server.
    }

    if (stored && (!desired || stored.channelId !== desired.channelId)) {
      await this.removeOldWarning(guild, stored);
      stored = null;
    }
    if (!desired) return;

    const channel = await this.fetchHoneypotChannel(guild, desired.channelId, stored !== null);
    if (!channel) return;

    if (stored) {
      let current: Message | null = null;
      try {
        // Forced, so the pinned flag comes from Discord rather than a cached copy that may be out of date.
        current = await channel.messages.fetch({ message: stored.messageId, force: true });
      } catch (err) {
        if (!isGone(err)) {
          // Can't tell whether it's still there: keep its IDs and don't post a second one.
          await this.notify(guildId, `Couldn't check the honeypot warning in <#${channel.id}>: ${reasonFor(err)}.`, err);
          return;
        }
      }
      if (current) {
        await this.updateWording(current, desired.action);
        // Pinned, or a pin failure that has been reported: either way it's there, and it still arms the honeypot.
        if (current.pinned || (await this.pinWarning(guildId, channel.id, current)) !== "gone") return;
        // Its pin found it deleted since the fetch, so it's gone after all: replace it as below.
      }
      // Gone. Forget it before anything else can fail, so the honeypot is never armed without a warning.
      await this.guildService.setHoneypotWarning(guildId, null);
    }

    if ((await this.adoptPinnedWarning(guildId, channel, desired.action)) === "none") {
      await this.postWarning(guildId, channel, desired.action);
    }
  }

  /**
   * Deletes a warning that's no longer wanted, because the honeypot was turned off or moved, and forgets its IDs even
   * when the deletion fails. There's only one stored pair, and keeping the old one would stop the new warning from
   * ever being stored.
   */
  private async removeOldWarning(guild: Guild, old: StoredWarning): Promise<void> {
    try {
      const channel = await guild.channels.fetch(old.channelId);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch({ message: old.messageId, force: true });
        await this.deleteOwnMessage(message);
        this.log.info({ guildId: guild.id, channelId: old.channelId }, "Old honeypot warning removed");
      }
    } catch (err) {
      if (!isGone(err)) {
        await this.notify(guild.id, `Couldn't remove the old honeypot warning in <#${old.channelId}>; please delete it by hand.`, err);
      }
    }
    await this.guildService.setHoneypotWarning(guild.id, null);
  }

  /** The honeypot channel, or null after reporting why the warning can't go there. */
  private async fetchHoneypotChannel(
    guild: Guild,
    channelId: string,
    warningStoredThere: boolean,
  ): Promise<GuildTextBasedChannel | null> {
    let channel;
    try {
      // Through the guild, never the client: the dashboard only checks the ID's format, so it could be another server's channel.
      channel = await guild.channels.fetch(channelId);
    } catch (err) {
      if (isGone(err)) {
        // The stored warning went with the channel.
        if (warningStoredThere) await this.guildService.setHoneypotWarning(guild.id, null);
        await this.notify(guild.id, `The honeypot channel <#${channelId}> no longer exists, so no warning is posted. Pick another channel in the dashboard.`, err);
        return null;
      }
      await this.notify(guild.id, `Couldn't check the honeypot channel <#${channelId}>: ${reasonFor(err)}.`, err);
      return null;
    }
    if (!channel?.isTextBased() || !channel.isSendable()) {
      await this.notify(guild.id, `Couldn't post the honeypot warning in <#${channelId}>: it isn't a text channel.`);
      return null;
    }
    return channel;
  }

  /**
   * Adopts a warning DragonBot already pinned in the channel, such as one whose IDs failed to save, and deletes any
   * extras. A new warning should be posted only when this finds none: when the pins can't be read, one may be there.
   */
  private async adoptPinnedWarning(
    guildId: string,
    channel: GuildTextBasedChannel,
    action: HoneypotAction,
  ): Promise<"adopted" | "none" | "cant_tell"> {
    let pins;
    try {
      pins = await channel.messages.fetchPins({ limit: PINS_SEARCHED });
    } catch (err) {
      await this.notify(guildId, `Couldn't read the pinned messages in <#${channel.id}>: ${reasonFor(err)}.`, err);
      return "cant_tell";
    }

    const botId = this.client.user?.id;
    const [kept, ...extras] = pins.items
      .map((pin) => pin.message)
      .filter((message) => message.author.id === botId && message.embeds[0]?.title === WARNING_TITLE);
    if (!kept) return "none";

    await this.guildService.setHoneypotWarning(guildId, { channelId: channel.id, messageId: kept.id });
    await this.updateWording(kept, action);
    for (const extra of extras) {
      try {
        await this.deleteOwnMessage(extra);
      } catch (err) {
        if (!isGone(err)) {
          await this.notify(guildId, `Couldn't remove a duplicate honeypot warning in <#${channel.id}>; please delete it by hand.`, err);
        }
      }
    }
    return "adopted";
  }

  /**
   * Posts a warning, stores its IDs and pins it. The pin always follows the store, so a pin that finds the warning
   * gone catches a deletion that beat the store, which no delete handler could recognise. That warning is forgotten
   * and another posted, up to MAX_POSTS_PER_SYNC posts.
   */
  private async postWarning(guildId: string, channel: GuildTextBasedChannel, action: HoneypotAction): Promise<void> {
    for (let posts = 0; posts < MAX_POSTS_PER_SYNC; posts++) {
      let posted: Message;
      try {
        posted = await channel.send({ embeds: [buildWarningEmbed(action)] });
      } catch (err) {
        // Nothing is stored, so the honeypot stays off.
        await this.notify(
          guildId,
          `Couldn't post the honeypot warning in <#${channel.id}>: ${reasonFor(err)}. The honeypot is off until the warning is posted.`,
          err,
        );
        return;
      }

      if ((await this.storeAndPin(guildId, channel.id, posted)) !== "gone") return;
      // Deleted before its pin, so the honeypot must not stay armed on it.
      this.log.warn({ guildId, channelId: channel.id, messageId: posted.id }, "Honeypot warning deleted before it was pinned");
      await this.guildService.setHoneypotWarning(guildId, null);
    }
    // The IDs stay cleared, so the honeypot stays off until a later sync gets a warning to stay up.
    await this.notify(
      guildId,
      `The honeypot warning in <#${channel.id}> was deleted as soon as it was posted, ${MAX_POSTS_PER_SYNC} times in a row. ` +
        "The honeypot is off until the warning stays up. Check for a bot or tool deleting messages there.",
    );
  }

  /**
   * Stores a new warning's IDs straight away, since a posted warning arms the honeypot even if it can't be pinned,
   * then pins it. It's pinned even when storing the IDs failed, so the next sync adopts it from the pins instead of
   * posting another, and the store's error is then rethrown. The exception is a pin that finds the warning gone:
   * the caller clears the IDs and posts again either way, so the store's error is only logged.
   */
  private async storeAndPin(guildId: string, channelId: string, posted: Message): Promise<PinResult> {
    let storeFailure: { err: unknown } | null = null;
    try {
      await this.guildService.setHoneypotWarning(guildId, { channelId, messageId: posted.id });
      this.log.info({ guildId, channelId, messageId: posted.id }, "Honeypot warning posted");
    } catch (err) {
      storeFailure = { err };
    }
    const pin = await this.pinWarning(guildId, channelId, posted);
    if (storeFailure) {
      if (pin !== "gone") throw storeFailure.err;
      this.log.warn({ err: storeFailure.err, guildId, channelId, messageId: posted.id }, "Couldn't store the honeypot warning's IDs");
    }
    return pin;
  }

  /** Edits the warning in place when its wording doesn't match the action. */
  private async updateWording(message: Message, action: HoneypotAction): Promise<void> {
    if (message.embeds[0]?.description === warningText(action)) return;
    await message.edit({ embeds: [buildWarningEmbed(action)] });
  }

  /**
   * Pins a warning. Unknown Message means the warning was deleted: that goes back to the caller, with no notice.
   * Any other failure is reported and costs only the pin: a posted warning still arms the honeypot.
   */
  private async pinWarning(guildId: string, channelId: string, message: Message): Promise<PinResult> {
    try {
      await message.pin(PIN_REASON);
      return "pinned";
    } catch (err) {
      if (hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage)) return "gone";
      const why = hasErrorCode(err, RESTJSONErrorCodes.MissingPermissions)
        ? "DragonBot needs the Pin Messages permission there"
        : hasErrorCode(err, RESTJSONErrorCodes.MaximumNumberOfPinsReachedForTheChannel)
          ? "the channel has reached Discord's pin limit"
          : reasonFor(err);
      await this.notify(guildId, `Couldn't pin the honeypot warning in <#${channelId}>: ${why}.`, err);
      return "failed";
    }
  }

  /** Deletes one of DragonBot's warnings, marked first as its own deletion so the delete log skips it. */
  private async deleteOwnMessage(message: Message): Promise<void> {
    this.honeypot.markOwnDeletion(message.id);
    await message.delete();
  }

  /** Reports a problem through pino and in the server's log channel, the latter once a day per text. Never throws. */
  private async notify(guildId: string, text: string, err?: unknown): Promise<void> {
    this.log.warn({ err, guildId }, text);
    const key = `${guildId}:${text}`;
    if (this.noticesSent.get(key)) return;
    this.noticesSent.set(key, true);
    try {
      await this.logging.sendNotice(guildId, text, this.client, this.log);
    } catch (noticeErr) {
      this.log.warn({ err: noticeErr, guildId }, "Couldn't send a honeypot notice");
    }
  }
}
