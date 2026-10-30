import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  DiscordAPIError,
  DiscordjsError,
  DiscordjsErrorCodes,
  RESTJSONErrorCodes,
  type APIEmbed,
  type Client,
  type EmbedBuilder,
} from "discord.js";
import type { Logger } from "pino";
import type { GuildRow, HoneypotAction } from "@dragonbot/db";
import { HoneypotWarningSync, buildWarningEmbed } from "../../src/lib/honeypot-warning.js";
import { HoneypotService, WARNING_COLOR, WARNING_TITLE, warningText } from "../../src/services/honeypot.service.js";
import type { GuildService } from "../../src/services/guild.service.js";
import type { LoggingService } from "../../src/services/logging.service.js";

const BOT_ID = "bot-self";

/** What the sync logs when it gives up on a server because of an error it didn't expect. */
const SYNC_FAILED = "Honeypot warning sync failed";

function apiError(code: number, message: string, status = 403) {
  return new DiscordAPIError({ code, message }, code, status, "PUT", "/x", {});
}

const missingAccess = () => apiError(RESTJSONErrorCodes.MissingAccess, "Missing Access");
const missingPermissions = () => apiError(RESTJSONErrorCodes.MissingPermissions, "Missing Permissions");
const unknownMessage = () => apiError(RESTJSONErrorCodes.UnknownMessage, "Unknown Message", 404);
const unknownChannel = () => apiError(RESTJSONErrorCodes.UnknownChannel, "Unknown Channel", 404);

/** What guild.channels.fetch throws for a channel that belongs to another server. Its constructor is private in the typings. */
function otherServersChannelError(): Error {
  const DiscordjsErrorClass = DiscordjsError as unknown as new (code: DiscordjsErrorCodes) => Error;
  return new DiscordjsErrorClass(DiscordjsErrorCodes.GuildChannelUnowned);
}

interface FakeMessage {
  id: string;
  pinned: boolean;
  deleted: boolean;
  author: { id: string };
  embeds: APIEmbed[];
  pin: Mock<(reason?: string) => Promise<FakeMessage>>;
  edit: Mock<(options: { embeds: EmbedBuilder[] }) => Promise<FakeMessage>>;
  delete: Mock<() => Promise<FakeMessage>>;
}

/** A message in a channel. By default it's DragonBot's pinned kick warning. */
function fakeMessage(
  id: string,
  options: {
    action?: HoneypotAction;
    pinned?: boolean;
    authorId?: string;
    title?: string;
    pinError?: Error;
    deleteError?: Error;
    /** Someone else deletes it just before DragonBot pins it, so the pin gets Unknown Message. */
    goneBeforePin?: boolean;
  } = {},
): FakeMessage {
  const message: FakeMessage = {
    id,
    pinned: options.pinned ?? true,
    deleted: false,
    author: { id: options.authorId ?? BOT_ID },
    embeds: [{ color: WARNING_COLOR, title: options.title ?? WARNING_TITLE, description: warningText(options.action ?? "kick") }],
    pin: vi.fn(async () => {
      if (options.goneBeforePin) {
        message.deleted = true;
        throw unknownMessage();
      }
      if (options.pinError) throw options.pinError;
      message.pinned = true;
      return message;
    }),
    edit: vi.fn(async ({ embeds }: { embeds: EmbedBuilder[] }) => {
      message.embeds = embeds.map((embed) => embed.toJSON());
      return message;
    }),
    delete: vi.fn(async () => {
      if (options.deleteError) throw options.deleteError;
      message.deleted = true;
      return message;
    }),
  };
  return message;
}

/**
 * A text channel holding the given messages. What the sync posts lands in `posted` and can then be fetched,
 * and pinned messages show up in the pins until they're deleted.
 */
function fakeChannel(
  id: string,
  options: {
    messages?: FakeMessage[];
    fetchError?: Error;
    pinsError?: Error;
    sendError?: Error;
    postedPinError?: Error;
    /** How many of the first posts someone else deletes before DragonBot can pin them, as a cleaner bot would. */
    postsGoneBeforePin?: number;
    textBased?: boolean;
  } = {},
) {
  const messages = [...(options.messages ?? [])];
  const posted: FakeMessage[] = [];
  const present = () => messages.filter((message) => !message.deleted);
  return {
    id,
    posted,
    isTextBased: () => options.textBased ?? true,
    isSendable: () => options.textBased ?? true,
    send: vi.fn(async ({ embeds }: { embeds: EmbedBuilder[] }) => {
      if (options.sendError) throw options.sendError;
      const message = fakeMessage(`${id}-posted-${posted.length + 1}`, {
        pinned: false,
        pinError: options.postedPinError,
        goneBeforePin: posted.length < (options.postsGoneBeforePin ?? 0),
      });
      message.embeds = embeds.map((embed) => embed.toJSON());
      messages.push(message);
      posted.push(message);
      return message;
    }),
    messages: {
      fetch: vi.fn(async ({ message: messageId }: { message: string; force?: boolean }) => {
        if (options.fetchError) throw options.fetchError;
        const found = present().find((message) => message.id === messageId);
        if (!found) throw unknownMessage();
        return found;
      }),
      fetchPins: vi.fn(async () => {
        if (options.pinsError) throw options.pinsError;
        return { items: present().filter((message) => message.pinned).map((message) => ({ message })), hasMore: false };
      }),
    },
  };
}

type FakeChannel = ReturnType<typeof fakeChannel>;

/** A server whose channels are looked up by ID. A channel that isn't listed is gone. */
function fakeGuild(id: string, channels: Record<string, FakeChannel | Error>) {
  return {
    id,
    channels: {
      fetch: vi.fn(async (channelId: string) => {
        const channel = channels[channelId];
        if (channel instanceof Error) throw channel;
        if (!channel) throw unknownChannel();
        return channel;
      }),
    },
  };
}

type FakeGuild = ReturnType<typeof fakeGuild>;

type HoneypotRow = Pick<
  GuildRow,
  | "guildId"
  | "isHoneypotEnabled"
  | "honeypotChannelId"
  | "honeypotAction"
  | "honeypotWarningChannelId"
  | "honeypotWarningMessageId"
>;

/** By default the honeypot is on in channel c1, set to kick, and no warning is stored. */
function honeypotRow(overrides: Partial<HoneypotRow> = {}): HoneypotRow {
  return {
    guildId: "g1",
    isHoneypotEnabled: true,
    honeypotChannelId: "c1",
    honeypotAction: "kick",
    honeypotWarningChannelId: null,
    honeypotWarningMessageId: null,
    ...overrides,
  };
}

/**
 * The guild table is in memory: setHoneypotWarning writes the row that the next getSettingsFresh reads.
 * The honeypot service is the real one, so the skip set and the per-server lock are real too.
 */
function setup(rows: HoneypotRow[], guilds: Record<string, FakeGuild | Error>) {
  const table = new Map(rows.map((row) => [row.guildId, { ...row }]));
  const guildService = {
    getSettingsFresh: vi.fn(async (guildId: string) => {
      const row = table.get(guildId);
      return row ? { ...row } : null;
    }),
    setHoneypotWarning: vi.fn(async (guildId: string, ids: { channelId: string; messageId: string } | null) => {
      const row = table.get(guildId);
      if (!row) return;
      row.honeypotWarningChannelId = ids?.channelId ?? null;
      row.honeypotWarningMessageId = ids?.messageId ?? null;
    }),
    // The settings cache holds every row, unless a test drops some.
    getAllCached: vi.fn(() => [...table.values()]),
    hydrateAll: vi.fn(async () => table.size),
  };
  const client = {
    user: { id: BOT_ID },
    guilds: {
      fetch: vi.fn(async (guildId: string) => {
        const guild = guilds[guildId];
        if (guild instanceof Error) throw guild;
        if (!guild) throw apiError(RESTJSONErrorCodes.UnknownGuild, "Unknown Guild", 404);
        return guild;
      }),
    },
    channels: { fetch: vi.fn() },
  };
  const logging = { sendNotice: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  const honeypot = new HoneypotService();
  const warning = new HoneypotWarningSync(
    client as unknown as Client,
    guildService as unknown as GuildService,
    honeypot,
    logging as unknown as LoggingService,
    logger as unknown as Logger,
  );
  return { warning, guildService, client, logging, logger, honeypot };
}

/** One server, g1, with the honeypot row changed by the overrides. */
function setupServer(overrides: Partial<HoneypotRow>, channels: Record<string, FakeChannel | Error>) {
  const guild = fakeGuild("g1", channels);
  return { ...setup([honeypotRow(overrides)], { g1: guild }), guild };
}

/** The warn logs for servers the sync gave up on because of an error it didn't expect. */
function syncFailures(logger: { warn: Mock }) {
  return logger.warn.mock.calls.filter((call) => call[1] === SYNC_FAILED);
}

/** The notice texts sent, in order. */
function notices(logging: { sendNotice: Mock }): string[] {
  return logging.sendNotice.mock.calls.map((call) => call[1] as string);
}

/** The warning embed for the action: its title, its color and its wording, and nothing else. */
function warningEmbedFor(action: HoneypotAction) {
  return expect.objectContaining({ data: { color: WARNING_COLOR, title: WARNING_TITLE, description: warningText(action) } });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("buildWarningEmbed", () => {
  it("holds only the title, the color and the wording for the action", () => {
    expect(buildWarningEmbed("kick").toJSON()).toEqual({
      color: 0xf0b232,
      title: "⚠️ Do not post in this channel",
      description: "If you send a message in this channel, you will be automatically kicked. There will be no exceptions.",
    });
    expect(buildWarningEmbed("ban").toJSON()).toEqual({
      color: 0xf0b232,
      title: "⚠️ Do not post in this channel",
      description: "If you send a message in this channel, you will be automatically banned. There will be no exceptions.",
    });
  });
});

describe("HoneypotWarningSync.sync", () => {
  it("posts and pins the warning when the honeypot is configured and nothing is stored", async () => {
    const channel = fakeChannel("c1");
    const { warning, guildService, logger } = setupServer({}, { c1: channel });

    await warning.sync("g1");

    expect(channel.send).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: "⚠️ Do not post in this channel", color: 0xf0b232 }),
        }),
      ],
    });
    expect(channel.send).toHaveBeenCalledWith({ embeds: [warningEmbedFor("kick")] });
    expect(channel.posted).toHaveLength(1);
    const posted = channel.posted[0];
    expect(posted.pin).toHaveBeenCalledWith("Honeypot warning");
    expect(guildService.setHoneypotWarning).toHaveBeenCalledWith("g1", { channelId: "c1", messageId: posted.id });
    // Stored before the pin: a posted warning arms the honeypot even if it can't be pinned.
    expect(guildService.setHoneypotWarning.mock.invocationCallOrder[0]).toBeLessThan(posted.pin.mock.invocationCallOrder[0]);
    // It looked for a warning to adopt before posting one.
    expect(channel.messages.fetchPins).toHaveBeenCalledWith({ limit: 50 });
    expect(syncFailures(logger)).toEqual([]);
  });

  it("edits the stored warning in place when the action changes", async () => {
    const stored = fakeMessage("w1", { action: "kick" });
    const channel = fakeChannel("c1", { messages: [stored] });
    const { warning, guildService, logger } = setupServer(
      { honeypotAction: "ban", honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: channel },
    );

    await warning.sync("g1");

    expect(stored.edit).toHaveBeenCalledWith({ embeds: [warningEmbedFor("ban")] });
    expect(channel.send).not.toHaveBeenCalled();
    expect(stored.pin).not.toHaveBeenCalled();
    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(syncFailures(logger)).toEqual([]);
  });

  it("moves the warning when the channel changes", async () => {
    const old = fakeMessage("w0");
    const oldChannel = fakeChannel("c0", { messages: [old] });
    const channel = fakeChannel("c1");
    const { warning, guildService, honeypot, logger } = setupServer(
      { honeypotWarningChannelId: "c0", honeypotWarningMessageId: "w0" },
      { c0: oldChannel, c1: channel },
    );
    const markOwnDeletion = vi.spyOn(honeypot, "markOwnDeletion");

    await warning.sync("g1");

    expect(old.delete).toHaveBeenCalledTimes(1);
    expect(markOwnDeletion).toHaveBeenCalledWith("w0");
    expect(markOwnDeletion.mock.invocationCallOrder[0]).toBeLessThan(old.delete.mock.invocationCallOrder[0]);
    // The delete log will skip it.
    expect(honeypot.consumeOwnDeletion("w0")).toBe(true);
    expect(channel.posted).toHaveLength(1);
    expect(old.delete.mock.invocationCallOrder[0]).toBeLessThan(channel.send.mock.invocationCallOrder[0]);
    expect(guildService.setHoneypotWarning.mock.calls).toEqual([
      ["g1", null],
      ["g1", { channelId: "c1", messageId: channel.posted[0].id }],
    ]);
    expect(syncFailures(logger)).toEqual([]);
  });

  it("reports an old warning it can't delete, forgets it, and posts in the new channel", async () => {
    const oldChannel = fakeChannel("c0", { messages: [fakeMessage("w0")], fetchError: missingAccess() });
    const channel = fakeChannel("c1");
    const { warning, guildService, client, logging, logger } = setupServer(
      { honeypotWarningChannelId: "c0", honeypotWarningMessageId: "w0" },
      { c0: oldChannel, c1: channel },
    );

    await warning.sync("g1");

    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(logging.sendNotice).toHaveBeenCalledWith(
      "g1",
      "Couldn't remove the old honeypot warning in <#c0>; please delete it by hand.",
      client,
      expect.anything(),
    );
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(guildService.setHoneypotWarning.mock.calls).toEqual([
      ["g1", null],
      ["g1", { channelId: "c1", messageId: channel.posted[0].id }],
    ]);
    expect(syncFailures(logger)).toEqual([]);
  });

  it("removes the warning and clears the ids when turned off", async () => {
    // Turned off, and left on with the channel cleared.
    for (const overrides of [{ isHoneypotEnabled: false }, { honeypotChannelId: null }]) {
      const stored = fakeMessage("w1");
      const channel = fakeChannel("c1", { messages: [stored] });
      const { warning, guildService, honeypot, logger } = setupServer(
        { ...overrides, honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
        { c1: channel },
      );

      await warning.sync("g1");

      expect(stored.delete).toHaveBeenCalledTimes(1);
      expect(honeypot.consumeOwnDeletion("w1")).toBe(true);
      expect(guildService.setHoneypotWarning.mock.calls).toEqual([["g1", null]]);
      expect(channel.send).not.toHaveBeenCalled();
      expect(syncFailures(logger)).toEqual([]);
    }
  });

  it("reposts when the stored warning is gone", async () => {
    // w1 was deleted, so fetching it fails with Unknown Message.
    const channel = fakeChannel("c1");
    const { warning, guildService, logger } = setupServer(
      { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: channel },
    );

    await warning.sync("g1");

    expect(channel.posted).toHaveLength(1);
    const posted = channel.posted[0];
    expect(posted.pin).toHaveBeenCalledWith("Honeypot warning");
    expect(guildService.setHoneypotWarning).toHaveBeenLastCalledWith("g1", { channelId: "c1", messageId: posted.id });
    expect(syncFailures(logger)).toEqual([]);
  });

  it("adopts a warning already in the pins and deletes duplicates", async () => {
    const someoneElses = fakeMessage("not-ours", { authorId: "another-bot" }); // the same title, from another account
    const rules = fakeMessage("rules", { title: "Server rules" }); // DragonBot's, but not a warning
    const kept = fakeMessage("w-a");
    const duplicate = fakeMessage("w-b");
    const channel = fakeChannel("c1", { messages: [someoneElses, rules, kept, duplicate] });
    const { warning, guildService, honeypot, logger } = setupServer({}, { c1: channel });
    const markOwnDeletion = vi.spyOn(honeypot, "markOwnDeletion");

    await warning.sync("g1");

    expect(guildService.setHoneypotWarning.mock.calls).toEqual([["g1", { channelId: "c1", messageId: "w-a" }]]);
    expect(kept.delete).not.toHaveBeenCalled();
    expect(kept.edit).not.toHaveBeenCalled();
    expect(duplicate.delete).toHaveBeenCalledTimes(1);
    expect(markOwnDeletion).toHaveBeenCalledWith("w-b");
    expect(markOwnDeletion.mock.invocationCallOrder[0]).toBeLessThan(duplicate.delete.mock.invocationCallOrder[0]);
    expect(someoneElses.delete).not.toHaveBeenCalled();
    expect(rules.delete).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(syncFailures(logger)).toEqual([]);
  });

  it("brings an adopted warning's wording up to date", async () => {
    const kept = fakeMessage("w-a", { action: "kick" });
    const channel = fakeChannel("c1", { messages: [kept] });
    const { warning, guildService } = setupServer({ honeypotAction: "ban" }, { c1: channel });

    await warning.sync("g1");

    expect(guildService.setHoneypotWarning).toHaveBeenCalledWith("g1", { channelId: "c1", messageId: "w-a" });
    expect(kept.edit).toHaveBeenCalledWith({ embeds: [warningEmbedFor("ban")] });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("reports a duplicate warning it can't delete and still deletes the rest", async () => {
    const kept = fakeMessage("w-a");
    const stuck = fakeMessage("w-b", { deleteError: new Error("Service Unavailable") });
    const duplicate = fakeMessage("w-c");
    const channel = fakeChannel("c1", { messages: [kept, stuck, duplicate] });
    const { warning, guildService, logging, logger } = setupServer({}, { c1: channel });

    await warning.sync("g1");

    expect(guildService.setHoneypotWarning).toHaveBeenCalledWith("g1", { channelId: "c1", messageId: "w-a" });
    expect(duplicate.delete).toHaveBeenCalledTimes(1);
    expect(notices(logging)).toEqual(["Couldn't remove a duplicate honeypot warning in <#c1>; please delete it by hand."]);
    expect(syncFailures(logger)).toEqual([]);
  });

  it("keeps the stored ids and sends a notice when it can't check the warning", async () => {
    const channel = fakeChannel("c1", { messages: [fakeMessage("w1")], fetchError: missingPermissions() });
    const { warning, guildService, logging, logger } = setupServer(
      { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: channel },
    );

    await warning.sync("g1");

    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.messages.fetchPins).not.toHaveBeenCalled();
    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain("<#c1>");
    expect(syncFailures(logger)).toEqual([]);
  });

  it("stores a posted warning even when pinning fails, and says so", async () => {
    const failures = [
      { error: missingPermissions(), named: "Pin Messages" },
      {
        error: apiError(RESTJSONErrorCodes.MaximumNumberOfPinsReachedForTheChannel, "Maximum number of pins reached (250)", 400),
        named: "pin limit",
      },
    ];
    for (const { error, named } of failures) {
      const channel = fakeChannel("c1", { postedPinError: error });
      const { warning, guildService, logging, logger } = setupServer({}, { c1: channel });

      await warning.sync("g1");

      expect(channel.posted).toHaveLength(1);
      expect(guildService.setHoneypotWarning).toHaveBeenCalledWith("g1", { channelId: "c1", messageId: channel.posted[0].id });
      expect(logging.sendNotice).toHaveBeenCalledTimes(1);
      expect(notices(logging)[0]).toContain("<#c1>");
      expect(notices(logging)[0]).toContain(named);
      expect(syncFailures(logger)).toEqual([]);
    }
  });

  it("re-pins a warning found unpinned", async () => {
    const stored = fakeMessage("w1", { pinned: false });
    const channel = fakeChannel("c1", { messages: [stored] });
    const { warning, guildService, logger } = setupServer(
      { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: channel },
    );

    await warning.sync("g1");

    // Read from Discord rather than the message cache, which may not know the warning was unpinned.
    expect(channel.messages.fetch).toHaveBeenCalledWith({ message: "w1", force: true });
    expect(stored.pin).toHaveBeenCalledWith("Honeypot warning");
    expect(stored.edit).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(syncFailures(logger)).toEqual([]);
  });

  it("posts again when the new warning is deleted before it is pinned", async () => {
    // For example a purge's next batch, or a cleaner bot, takes the warning before its ID is stored, where no
    // delete handler can recognise it.
    const channel = fakeChannel("c1", { postsGoneBeforePin: 1 });
    const { warning, guildService, logging, logger } = setupServer({}, { c1: channel });

    await warning.sync("g1");

    expect(channel.posted).toHaveLength(2);
    const [gone, kept] = channel.posted;
    expect(gone.pin).toHaveBeenCalledTimes(1);
    expect(kept.pin).toHaveBeenCalledWith("Honeypot warning");
    expect(kept.pinned).toBe(true);
    expect(guildService.setHoneypotWarning.mock.calls).toEqual([
      ["g1", { channelId: "c1", messageId: gone.id }],
      ["g1", null],
      ["g1", { channelId: "c1", messageId: kept.id }],
    ]);
    // The deleted warning's IDs were cleared before the next one was posted.
    expect(guildService.setHoneypotWarning.mock.invocationCallOrder[1]).toBeLessThan(channel.send.mock.invocationCallOrder[1]);
    // A deleted warning isn't a pin failure, so there's no "Couldn't pin" notice.
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(syncFailures(logger)).toEqual([]);
  });

  it("clears and posts again when saving the ids failed and the pin finds the warning gone", async () => {
    // The failed save may still have reached the database, so the gone warning's IDs are cleared either way.
    const channel = fakeChannel("c1", { postsGoneBeforePin: 1 });
    const { warning, guildService, logging, logger } = setupServer({}, { c1: channel });
    const saveError = new Error("database is down");
    guildService.setHoneypotWarning.mockRejectedValueOnce(saveError);

    await warning.sync("g1");

    expect(channel.posted).toHaveLength(2);
    const [gone, kept] = channel.posted;
    expect(guildService.setHoneypotWarning.mock.calls).toEqual([
      ["g1", { channelId: "c1", messageId: gone.id }],
      ["g1", null],
      ["g1", { channelId: "c1", messageId: kept.id }],
    ]);
    expect(kept.pinned).toBe(true);
    // The save's error is logged rather than ending the sync.
    expect(logger.warn).toHaveBeenCalledWith(
      { err: saveError, guildId: "g1", channelId: "c1", messageId: gone.id },
      "Couldn't store the honeypot warning's IDs",
    );
    expect(syncFailures(logger)).toEqual([]);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("gives up after three warnings are deleted before they are pinned", async () => {
    const givenUp =
      "The honeypot warning in <#c1> was deleted as soon as it was posted, 3 times in a row. " +
      "The honeypot is off until the warning stays up. Check for a bot or tool deleting messages there.";
    // Nothing stored yet, and a stored warning found unpinned whose pin finds it gone: the same limit of 3 posts.
    const starts = [
      { row: {}, messages: [], cleared: [] },
      {
        row: { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
        messages: [fakeMessage("w1", { pinned: false, goneBeforePin: true })],
        cleared: [["g1", null]],
      },
    ];
    for (const start of starts) {
      // Every new message is deleted as soon as it appears.
      const channel = fakeChannel("c1", { messages: start.messages, postsGoneBeforePin: 10 });
      const { warning, guildService, logging, logger } = setupServer(start.row, { c1: channel });

      await warning.sync("g1");

      expect(channel.posted).toHaveLength(3);
      expect(guildService.setHoneypotWarning.mock.calls).toEqual([
        ...start.cleared,
        ...channel.posted.flatMap((post) => [
          ["g1", { channelId: "c1", messageId: post.id }],
          ["g1", null],
        ]),
      ]);
      // The IDs stay cleared, so the honeypot stays off.
      expect(await guildService.getSettingsFresh("g1")).toMatchObject({
        honeypotWarningChannelId: null,
        honeypotWarningMessageId: null,
      });
      expect(notices(logging)).toEqual([givenUp]);
      expect(syncFailures(logger)).toEqual([]);
    }
  });

  it("replaces an unpinned stored warning whose pin finds it gone", async () => {
    // Deleted between the sync's fetch and its pin.
    const stored = fakeMessage("w1", { pinned: false, goneBeforePin: true });
    const channel = fakeChannel("c1", { messages: [stored] });
    const { warning, guildService, logging, logger } = setupServer(
      { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: channel },
    );

    await warning.sync("g1");

    expect(stored.pin).toHaveBeenCalledTimes(1);
    expect(channel.posted).toHaveLength(1);
    const posted = channel.posted[0];
    expect(posted.pin).toHaveBeenCalledWith("Honeypot warning");
    expect(guildService.setHoneypotWarning.mock.calls).toEqual([
      ["g1", null],
      ["g1", { channelId: "c1", messageId: posted.id }],
    ]);
    // It looked for a warning to adopt before posting one.
    expect(channel.messages.fetchPins).toHaveBeenCalledTimes(1);
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(syncFailures(logger)).toEqual([]);
  });

  it("keeps a warning armed when its pin fails for another reason", async () => {
    // Only Unknown Message means the warning is gone. Even Unknown Channel is reported as before.
    const failures = [
      { error: missingPermissions, why: "DragonBot needs the Pin Messages permission there" },
      { error: unknownChannel, why: "Unknown Channel" },
    ];
    for (const { error, why } of failures) {
      // A new warning, and a stored one found unpinned: both stay stored, with the notice and no second post.
      const posting = fakeChannel("c1", { postedPinError: error() });
      const stored = fakeMessage("w1", { pinned: false, pinError: error() });
      const repinning = fakeChannel("c1", { messages: [stored] });
      const cases = [
        { channel: posting, row: {}, written: () => [["g1", { channelId: "c1", messageId: posting.posted[0].id }]] },
        { channel: repinning, row: { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" }, written: () => [] },
      ];
      for (const { channel, row, written } of cases) {
        const { warning, guildService, logging, logger } = setupServer(row, { c1: channel });

        await warning.sync("g1");

        expect(channel.send).toHaveBeenCalledTimes(row.honeypotWarningMessageId ? 0 : 1);
        expect(guildService.setHoneypotWarning.mock.calls).toEqual(written());
        expect(notices(logging)).toEqual([`Couldn't pin the honeypot warning in <#c1>: ${why}.`]);
        expect(syncFailures(logger)).toEqual([]);
      }
      expect(stored.pin).toHaveBeenCalledTimes(1);
    }
  });

  it("leaves a server without a honeypot or a stored warning alone", async () => {
    // Every dashboard save syncs its server, honeypot or not.
    const { warning, client, guildService, logging, logger } = setupServer({ isHoneypotEnabled: false }, {});

    await warning.sync("g1");

    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("runs one sync at a time per server", async () => {
    const channel = fakeChannel("c1");
    const { warning, guildService } = setupServer({}, { c1: channel });

    // For example a dashboard save and a deleted-warning event at the same moment.
    await Promise.all([warning.sync("g1"), warning.sync("g1")]);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(guildService.setHoneypotWarning).toHaveBeenCalledTimes(1);
  });

  it("joins a sync still waiting to start instead of queueing another", async () => {
    // A bot deleting each repost on arrival sends a delete event, and so a sync request, for each one.
    const channel = fakeChannel("c1");
    const { warning, guildService } = setupServer({}, { c1: channel });
    const readRow = guildService.getSettingsFresh.getMockImplementation()!;
    // Each sync starts by reading the settings. The test lets each read finish in turn, until it stops holding them.
    const reads: Array<() => void> = [];
    let holdReads = true;
    guildService.getSettingsFresh.mockImplementation(async (guildId: string) => {
      if (holdReads) await new Promise<void>((resolve) => reads.push(resolve));
      return readRow(guildId);
    });

    const first = warning.sync("g1");
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    // Asked while the first sync runs: one more sync covers all three, since it reads the settings when it starts.
    const asked = [warning.sync("g1"), warning.sync("g1"), warning.sync("g1")];
    reads[0]();
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    // Asked once that sync has started: it may have read the settings already, so this gets a sync of its own.
    const askedLater = warning.sync("g1");
    reads[1]();
    await vi.waitFor(() => expect(reads).toHaveLength(3));
    holdReads = false;
    reads[2]();
    await Promise.all([first, ...asked, askedLater]);

    expect(guildService.getSettingsFresh).toHaveBeenCalledTimes(3);
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when it runs again", async () => {
    const channel = fakeChannel("c1");
    const { warning, guildService, logging } = setupServer({}, { c1: channel });

    await warning.sync("g1");
    await warning.sync("g1");

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.posted[0].pin).toHaveBeenCalledTimes(1);
    expect(channel.posted[0].edit).not.toHaveBeenCalled();
    expect(guildService.setHoneypotWarning).toHaveBeenCalledTimes(1);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("sends a notice and stores nothing when the warning can't be posted", async () => {
    const channel = fakeChannel("c1", { sendError: missingPermissions() });
    const { warning, guildService, logging, logger } = setupServer({}, { c1: channel });

    await warning.sync("g1");

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain("<#c1>");
    expect(notices(logging)[0]).toContain("Missing Permissions");
    expect(syncFailures(logger)).toEqual([]);
  });

  it("disarms when the stored warning is gone and can't be replaced", async () => {
    // w1 was deleted. The new warning can't be posted, or the pins can't be read to look for one to adopt.
    const channels = [fakeChannel("c1", { sendError: missingPermissions() }), fakeChannel("c1", { pinsError: missingAccess() })];
    for (const channel of channels) {
      const { warning, guildService, logging, logger } = setupServer(
        { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
        { c1: channel },
      );

      await warning.sync("g1");

      expect(guildService.setHoneypotWarning.mock.calls).toEqual([["g1", null]]);
      expect(logging.sendNotice).toHaveBeenCalledTimes(1);
      expect(syncFailures(logger)).toEqual([]);
    }
  });

  it("doesn't post a second warning when it can't look through the pins", async () => {
    const channel = fakeChannel("c1", { pinsError: missingAccess() });
    const { warning, guildService, logging, logger } = setupServer({}, { c1: channel });

    await warning.sync("g1");

    expect(channel.send).not.toHaveBeenCalled();
    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain("<#c1>");
    expect(syncFailures(logger)).toEqual([]);
  });

  it("adopts its own warning on the next sync when saving the ids failed", async () => {
    const channel = fakeChannel("c1");
    const { warning, guildService, logger } = setupServer({}, { c1: channel });
    guildService.setHoneypotWarning.mockRejectedValueOnce(new Error("database is down"));

    await warning.sync("g1");

    expect(channel.posted).toHaveLength(1);
    // Pinned anyway, so the next sync finds it in the pins.
    expect(channel.posted[0].pin).toHaveBeenCalledTimes(1);
    expect(syncFailures(logger)).toHaveLength(1);

    await warning.sync("g1");

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(guildService.setHoneypotWarning).toHaveBeenLastCalledWith("g1", { channelId: "c1", messageId: channel.posted[0].id });
  });

  it("sends the same sync notice only once per day per server", async () => {
    vi.useFakeTimers();
    const rows = ["g1", "g2"].map((guildId) =>
      honeypotRow({ guildId, honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" }),
    );
    const failingServer = (guildId: string) =>
      fakeGuild(guildId, { c1: fakeChannel("c1", { messages: [fakeMessage("w1")], fetchError: missingPermissions() }) });
    const { warning, logging } = setup(rows, { g1: failingServer("g1"), g2: failingServer("g2") });
    const start = Date.now();

    await warning.sync("g1");
    await warning.sync("g1");
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);

    // The same text is still news to another server.
    await warning.sync("g2");
    expect(logging.sendNotice).toHaveBeenCalledTimes(2);
    expect(logging.sendNotice.mock.calls[1][0]).toBe("g2");

    vi.setSystemTime(start + 86_400_000);
    await warning.sync("g1");
    expect(logging.sendNotice).toHaveBeenCalledTimes(2);

    vi.setSystemTime(start + 86_400_001);
    await warning.sync("g1");
    expect(logging.sendNotice).toHaveBeenCalledTimes(3);
    expect(notices(logging)[2]).toBe(notices(logging)[0]);
  });

  it("fetches the channel through the guild, never the client", async () => {
    const oldChannel = fakeChannel("c0", { messages: [fakeMessage("w0")] });
    const channel = fakeChannel("c1");
    const { warning, client, guild } = setupServer(
      { honeypotWarningChannelId: "c0", honeypotWarningMessageId: "w0" },
      { c0: oldChannel, c1: channel },
    );

    await warning.sync("g1");

    expect(client.guilds.fetch).toHaveBeenCalledWith("g1");
    expect(guild.channels.fetch).toHaveBeenCalledWith("c0");
    expect(guild.channels.fetch).toHaveBeenCalledWith("c1");
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(channel.posted).toHaveLength(1);
  });

  it("sends a notice and posts nothing when the honeypot channel can't be used", async () => {
    const forum = fakeChannel("c1", { textBased: false });
    // A channel DragonBot can't see, a channel ID from another server, and a channel that isn't a text channel.
    for (const c1 of [missingAccess(), otherServersChannelError(), forum]) {
      const { warning, guildService, logging, logger } = setupServer({}, { c1 });

      await warning.sync("g1");

      expect(logging.sendNotice).toHaveBeenCalledTimes(1);
      expect(notices(logging)[0]).toContain("<#c1>");
      expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
      expect(syncFailures(logger)).toEqual([]);
    }
    expect(forum.send).not.toHaveBeenCalled();
  });

  it("keeps the stored ids when it can't check the honeypot channel", async () => {
    const { warning, guildService, logging } = setupServer(
      { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: missingAccess() },
    );

    await warning.sync("g1");

    expect(guildService.setHoneypotWarning).not.toHaveBeenCalled();
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
  });

  it("forgets a warning whose channel was deleted, and says so", async () => {
    const { warning, guildService, logging, logger } = setupServer(
      { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "w1" },
      { c1: unknownChannel() },
    );

    await warning.sync("g1");

    expect(guildService.setHoneypotWarning.mock.calls).toEqual([["g1", null]]);
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain("<#c1>");
    expect(syncFailures(logger)).toEqual([]);
  });

  it("finishes the sync when a notice can't be sent", async () => {
    const oldChannel = fakeChannel("c0", { messages: [fakeMessage("w0")], fetchError: missingAccess() });
    const channel = fakeChannel("c1");
    const { warning, guildService, logging, logger } = setupServer(
      { honeypotWarningChannelId: "c0", honeypotWarningMessageId: "w0" },
      { c0: oldChannel, c1: channel },
    );
    logging.sendNotice.mockRejectedValue(new Error("database is down"));

    await warning.sync("g1");

    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(channel.posted).toHaveLength(1);
    expect(guildService.setHoneypotWarning).toHaveBeenLastCalledWith("g1", { channelId: "c1", messageId: channel.posted[0].id });
    expect(syncFailures(logger)).toEqual([]);
  });
});

describe("HoneypotWarningSync.syncAll", () => {
  it("keeps going when one server fails during syncAll", async () => {
    const channel = fakeChannel("c1");
    const { warning, guildService, logger } = setup(
      [honeypotRow({ guildId: "g1" }), honeypotRow({ guildId: "g2" }), honeypotRow({ guildId: "g3" })],
      {
        g1: apiError(RESTJSONErrorCodes.UnknownGuild, "Unknown Guild", 404), // DragonBot left this server
        g2: fakeGuild("g2", { c1: fakeChannel("c1") }),
        g3: fakeGuild("g3", { c1: channel }),
      },
    );
    const readRow = guildService.getSettingsFresh.getMockImplementation()!;
    guildService.getSettingsFresh.mockImplementation(async (guildId: string) => {
      if (guildId === "g2") throw new Error("database is down");
      return readRow(guildId);
    });

    await expect(warning.syncAll()).resolves.toBeUndefined();

    expect(channel.posted).toHaveLength(1);
    expect(guildService.setHoneypotWarning).toHaveBeenCalledWith("g3", { channelId: "c1", messageId: channel.posted[0].id });
    // Only g2's error is a failure: a server DragonBot isn't in is skipped quietly.
    expect(syncFailures(logger)).toHaveLength(1);
  });

  it("visits servers that are configured or still have a stored warning, and skips the rest", async () => {
    const { warning } = setup(
      [
        honeypotRow({ guildId: "configured" }),
        honeypotRow({
          guildId: "off-with-warning",
          isHoneypotEnabled: false,
          honeypotWarningChannelId: "c1",
          honeypotWarningMessageId: "w1",
        }),
        honeypotRow({ guildId: "off", isHoneypotEnabled: false }),
        honeypotRow({ guildId: "no-channel", honeypotChannelId: null }),
      ],
      {},
    );
    let running = 0;
    let mostAtOnce = 0;
    const sync = vi.spyOn(warning, "sync").mockImplementation(async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await Promise.resolve();
      running -= 1;
    });

    await warning.syncAll();

    expect(sync.mock.calls).toEqual([["configured"], ["off-with-warning"]]);
    expect(mostAtOnce).toBe(1);
  });

  it("visits a configured server that another write dropped from the settings cache", async () => {
    // At startup the birthday check writes its servers' rows before this sync runs, and each write drops the row from the cache.
    const kept = honeypotRow({ guildId: "g1" });
    const dropped = honeypotRow({ guildId: "g2" });
    const { warning, guildService } = setup([kept, dropped], {});
    let cached = [kept];
    guildService.getAllCached.mockImplementation(() => cached);
    guildService.hydrateAll.mockImplementation(async () => {
      cached = [kept, dropped];
      return cached.length;
    });
    const sync = vi.spyOn(warning, "sync").mockResolvedValue();

    await warning.syncAll();

    expect(sync.mock.calls).toEqual([["g1"], ["g2"]]);
  });

  it("syncs the servers already cached when it can't re-read the settings", async () => {
    const { warning, guildService, logger } = setup([honeypotRow({ guildId: "g1" })], {});
    guildService.hydrateAll.mockRejectedValue(new Error("database is down"));
    const sync = vi.spyOn(warning, "sync").mockResolvedValue();

    await expect(warning.syncAll()).resolves.toBeUndefined();

    expect(sync.mock.calls).toEqual([["g1"]]);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Couldn't re-read the guild settings before the honeypot warning sync; syncing the cached servers",
    );
  });
});
