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
import { findHoneypotChannelConflict, type GuildRow, type HoneypotAction } from "@dragonbot/db";
import type { GuildService } from "../services/guild.service.js";
import { WARNING_COLOR, WARNING_TITLE, warningText, type HoneypotService } from "../services/honeypot.service.js";
import type { LoggingService } from "../services/logging.service.js";
import { TTLCache } from "../utils/cache.js";

/** A notice with the same text goes to a server's log channel at most once in this many seconds. */
const NOTICE_REPEAT_SECONDS = 86_400;

/** How many of the honeypot channel's pins are searched for a warning to adopt. */
const PINS_SEARCHED = 50;

const PIN_REASON = "Honeypot warning";

/** The most new warnings DragonBot posts in one server in any POST_WINDOW_MS, counted across syncs. */
const MAX_POSTS_PER_WINDOW = 3;
const POST_WINDOW_MS = 10 * 60 * 1000;

/**
 * How long a delete handler's word that a message was deleted waits for a sync to use it. A deleted message's ID never
 * comes back, so a word that outlives its sync is harmless; this only bounds the memory.
 */
const GONE_HINT_SECONDS = 3_600;

const CHANNEL_MISMATCH_NOTICE =
  "The honeypot is off: its channel setting doesn't match a channel in this server. Pick the channel again in the dashboard.";

interface StoredWarning {
  channelId: string;
  messageId: string;
}

/** What pinning a warning found. "gone" is Unknown Message: the warning was deleted. Any other failure has been reported. */
type PinResult = "pinned" | "gone" | "failed";

/** What a sync's caller knows that the sync should act on. */
export interface SyncOptions {
  /** Forget the server's repost budget first: an admin asked for the warning again. */
  resetBudget?: boolean;
  /** A message a delete handler saw deleted. If it's the stored warning, the sync takes it as gone without fetching it. */
  goneMessageId?: string;
}

/** The pinned warning: the title and the wording for the action, and nothing else. */
export function buildWarningEmbed(action: HoneypotAction): EmbedBuilder {
  return new EmbedBuilder().setColor(WARNING_COLOR).setTitle(WARNING_TITLE).setDescription(warningText(action));
}

/**
 * Why the honeypot can't be armed in this channel, as a notice, or null. Members are expected to post in the System
 * Messages channel (Discord's "Wave to say hi" button) and in channels other DragonBot settings use.
 */
function armingRefusal(guild: Guild, row: GuildRow, channelId: string): string | null {
  if (channelId === guild.systemChannelId) {
    return (
      `The honeypot is off: <#${channelId}> is this server's System Messages channel, where members' "Wave to say hi" ` +
      "replies would get them removed. Pick another channel in the dashboard."
    );
  }
  const conflict = findHoneypotChannelConflict(row);
  if (conflict) {
    return `The honeypot is off: <#${channelId}> is also this server's ${conflict} channel. Pick another channel in the dashboard.`;
  }
  return null;
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
  /** When each server's recent new warnings were posted, oldest first, for its repost budget. Forgotten on a restart. */
  private postTimes = new Map<string, number[]>();
  /** Messages the delete handlers saw deleted, by server and message ID. */
  private goneHints = new TTLCache<true>(GONE_HINT_SECONDS);

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
  sync(guildId: string, options: SyncOptions = {}): Promise<void> {
    // Before the join check, so a request that joins a waiting sync still counts.
    if (options.resetBudget) this.postTimes.delete(guildId);
    if (options.goneMessageId) this.goneHints.set(`${guildId}:${options.goneMessageId}`, true);
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

    let desired =
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

    // A channel where members are expected to post gets no warning, exactly as if the honeypot were off.
    const refusal = desired ? armingRefusal(guild, row, desired.channelId) : null;
    if (refusal) desired = null;

    if (stored && (!desired || stored.channelId !== desired.channelId)) {
      await this.removeOldWarning(guild, stored);
      stored = null;
    }
    if (refusal) await this.notify(guildId, refusal);
    if (!desired) return;

    const channel = await this.fetchHoneypotChannel(guild, desired.channelId, stored !== null);
    if (!channel) return;
    if (channel.id !== desired.channelId) {
      // Discord resolved the setting to another channel ID, for example a zero-padded one. The dashboard's checks
      // compared the setting's string, so this channel may be one they would have refused.
      if (stored) await this.removeOldWarning(guild, stored);
      await this.notify(guildId, CHANNEL_MISMATCH_NOTICE);
      return;
    }

    if (stored) {
      let current: Message | null = null;
      // A delete handler saw it deleted: it's gone, whatever a fetch would say now, Missing Access included.
      if (!this.takeGoneHint(guildId, stored.messageId)) {
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
      }
      // Pinned, or a pin failure that has been reported: either way it's there, and it still arms the honeypot.
      if (
        current &&
        (await this.updateWording(current, desired.action)) !== "gone" &&
        (current.pinned || (await this.pinWarning(guildId, channel.id, current)) !== "gone")
      ) {
        return;
      }
      // Gone, including when the edit or the pin found it deleted since the fetch. Forget it before anything else can
      // fail, so the honeypot is never armed without a warning.
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

  /** Whether a delete handler saw this message deleted. The word is used up. */
  private takeGoneHint(guildId: string, messageId: string): boolean {
    const key = `${guildId}:${messageId}`;
    if (!this.goneHints.get(key)) return false;
    this.goneHints.invalidate(key);
    return true;
  }

  /**
   * Adopts a warning DragonBot already pinned in the channel, such as one whose IDs failed to save, and deletes any
   * extras. A new warning should be posted only when this finds none: when the pins can't be read, one may be there.
   * "none" also covers a warning adopted and then found deleted.
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
    // The pins were read a round trip ago, and no delete handler recognises a deletion since: it compared the deleted
    // message with the IDs stored before these. Checked before the edit, which would only throw.
    const keptIsThere =
      (await this.isStillThere(channel, kept.id)) && (await this.updateWording(kept, action)) !== "gone";
    if (!keptIsThere) await this.guildService.setHoneypotWarning(guildId, null);
    for (const extra of extras) {
      try {
        await this.deleteOwnMessage(extra);
      } catch (err) {
        if (!isGone(err)) {
          await this.notify(guildId, `Couldn't remove a duplicate honeypot warning in <#${channel.id}>; please delete it by hand.`, err);
        }
      }
    }
    return keptIsThere ? "adopted" : "none";
  }

  /** False when a forced fetch finds the message gone. When the fetch can't tell, the message counts as there. */
  private async isStillThere(channel: GuildTextBasedChannel, messageId: string): Promise<boolean> {
    try {
      await channel.messages.fetch({ message: messageId, force: true });
      return true;
    } catch (err) {
      return !isGone(err);
    }
  }

  /**
   * Posts a warning, stores its IDs and pins it, within the server's repost budget. The pin always follows the store,
   * so a pin that finds the warning gone catches a deletion that beat the store, which no delete handler could
   * recognise. That warning is forgotten and another posted. Every post counts against the budget, whatever its
   * reason, and syncs that deletions start share it, so a bot that deletes every warning can't keep DragonBot posting.
   */
  private async postWarning(guildId: string, channel: GuildTextBasedChannel, action: HoneypotAction): Promise<void> {
    for (;;) {
      if (!this.hasPostBudget(guildId)) {
        // Cleared again, so a spent budget can never leave the honeypot armed on a warning that's gone.
        await this.guildService.setHoneypotWarning(guildId, null);
        await this.notify(
          guildId,
          `The honeypot warning in <#${channel.id}> was deleted ${MAX_POSTS_PER_WINDOW} times in ${POST_WINDOW_MS / 60_000} minutes, ` +
            "so DragonBot stopped posting it. The honeypot is off until the warning stays up: save the server's settings " +
            "in the dashboard or run /admin reload to try again.",
        );
        return;
      }

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
      this.countPost(guildId);

      if ((await this.storeAndPin(guildId, channel.id, posted)) !== "gone") return;
      // Deleted before its pin, so the honeypot must not stay armed on it.
      this.log.warn({ guildId, channelId: channel.id, messageId: posted.id }, "Honeypot warning deleted before it was pinned");
      await this.guildService.setHoneypotWarning(guildId, null);
    }
  }

  /** Whether the server has posted fewer than MAX_POSTS_PER_WINDOW warnings in the last POST_WINDOW_MS. */
  private hasPostBudget(guildId: string): boolean {
    const since = Date.now() - POST_WINDOW_MS;
    const recent = (this.postTimes.get(guildId) ?? []).filter((postedAt) => postedAt > since);
    if (recent.length > 0) this.postTimes.set(guildId, recent);
    else this.postTimes.delete(guildId);
    return recent.length < MAX_POSTS_PER_WINDOW;
  }

  private countPost(guildId: string): void {
    this.postTimes.set(guildId, [...(this.postTimes.get(guildId) ?? []), Date.now()]);
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

  /** Edits the warning in place when its wording doesn't match the action. "gone" when the edit finds it deleted. */
  private async updateWording(message: Message, action: HoneypotAction): Promise<"current" | "gone"> {
    if (message.embeds[0]?.description === warningText(action)) return "current";
    try {
      await message.edit({ embeds: [buildWarningEmbed(action)] });
    } catch (err) {
      if (hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage)) return "gone";
      throw err;
    }
    return "current";
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
