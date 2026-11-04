import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type EmbedBuilder,
  type Message,
} from "discord.js";
import type { GuildRow } from "@dragonbot/db";
import { handleHoneypotMessage } from "../../src/lib/honeypot-enforcer.js";
import { handleRepeatSpamMessage } from "../../src/lib/repeat-spam-enforcer.js";
import { HoneypotService, UNBAN_REASON } from "../../src/services/honeypot.service.js";
import { RepeatSpamService } from "../../src/services/repeat-spam.service.js";
import type { BotContext } from "../../src/types/context.js";

/** A fixed clock, so case start and end times are predictable. */
const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);

/** A sentence well over the length floor, posted as the spam in most tests. */
const SENTENCE = "Free nitro for everyone who clicks the link in my profile today";
const OTHER_SENTENCE = "Has anyone here tried the new raid boss this week yet";

function apiError(code: number, message: string, status: number) {
  return new DiscordAPIError({ code, message }, code, status, "PUT", "/x", {});
}

const unknownMember = () => apiError(RESTJSONErrorCodes.UnknownMember, "Unknown Member", 404);
const unknownBan = () => apiError(RESTJSONErrorCodes.UnknownBan, "Unknown Ban", 404);
const unknownMessage = () => apiError(RESTJSONErrorCodes.UnknownMessage, "Unknown Message", 404);
const unknownChannel = () => apiError(RESTJSONErrorCodes.UnknownChannel, "Unknown Channel", 404);
const missingPermissions = () => apiError(RESTJSONErrorCodes.MissingPermissions, "Missing Permissions", 403);

function fakeMember(options: { permissions?: bigint[]; roleIds?: string[] } = {}) {
  return {
    permissions: new PermissionsBitField(options.permissions ?? []),
    roles: { cache: new Collection((options.roleIds ?? []).map((id): [string, { id: string }] => [id, { id }])) },
  };
}

type FakeMember = ReturnType<typeof fakeMember>;

function fakeTextChannel(id: string) {
  return {
    id,
    isTextBased: () => true,
    messages: {
      cache: new Collection<string, unknown>(),
      delete: vi.fn(async (_messageId: string): Promise<void> => {}),
    },
    bulkDelete: vi.fn(async () => new Collection()),
  };
}

type FakeTextChannel = ReturnType<typeof fakeTextChannel>;

const CHANNEL_IDS = ["a", "b", "c", "d", "e", "trap"];

/** A server where nobody is banned and every ban, member lookup, unban and delete works, unless a test says otherwise. */
function fakeGuild() {
  const cache = new Collection<string, FakeTextChannel>(CHANNEL_IDS.map((id): [string, FakeTextChannel] => [id, fakeTextChannel(id)]));
  return {
    id: "g1",
    members: {
      ban: vi.fn(async (_userId: string, _options: unknown): Promise<unknown> => "u1"),
      fetch: vi.fn(async (_userId: string): Promise<unknown> => fakeMember()),
    },
    bans: {
      fetch: vi.fn(async (_options: unknown): Promise<unknown> => {
        throw unknownBan();
      }),
      remove: vi.fn(async (_userId: string, _reason?: string): Promise<unknown> => null),
    },
    channels: {
      cache,
      fetch: vi.fn(async (id: string): Promise<unknown> => cache.get(id) ?? null),
    },
    systemChannelId: null as string | null,
  };
}

type FakeGuild = ReturnType<typeof fakeGuild>;

/** Message IDs count up from here, so every post is newer than the trap's warning, 100. */
let nextMessageId = 200;

interface MessageOptions {
  channelId?: string;
  id?: string;
  content?: string;
  authorIsBot?: boolean;
  system?: boolean;
  webhookId?: string | null;
  /** null when the gateway sent no member, so the handler has to look the author up. */
  member?: FakeMember | null;
  createdTimestamp?: number;
}

/** A post by u1, an ordinary member, of SENTENCE in channel a, unless the options say otherwise. */
function fakeMessage(guild: FakeGuild, options: MessageOptions = {}) {
  const channelId = options.channelId ?? "a";
  return {
    id: options.id ?? String(nextMessageId++),
    guildId: guild.id,
    guild,
    channelId,
    channel: { id: channelId, name: channelId },
    author: {
      id: "u1",
      bot: options.authorIsBot ?? false,
      tag: "u1#0001",
      displayAvatarURL: () => "https://cdn.example/u1.png",
    },
    member: options.member === undefined ? fakeMember() : options.member,
    system: options.system ?? false,
    webhookId: options.webhookId ?? null,
    content: options.content ?? SENTENCE,
    attachments: new Collection(),
    reactions: { cache: new Collection() },
    stickers: new Collection(),
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    editedTimestamp: null,
    nonce: null,
    client: { name: "fake client" },
    delete: vi.fn(async () => {}),
  };
}

type FakeMessage = ReturnType<typeof fakeMessage>;

const asMessage = (message: FakeMessage) => message as unknown as Message<true>;

/** The repeated-message check is on at 3 channels, ignoring case. The channel trap is off. */
function repeatRow(overrides: Record<string, unknown> = {}): GuildRow {
  return {
    guildId: "g1",
    isRepeatSpamEnabled: true,
    repeatSpamChannelCount: 3,
    repeatSpamMatchMode: "ignore_case",
    verificationRoleId: "verified-role",
    isHoneypotEnabled: false,
    honeypotChannelId: null,
    honeypotAction: "kick",
    honeypotWarningChannelId: null,
    honeypotWarningMessageId: null,
    ...overrides,
  } as unknown as GuildRow;
}

/**
 * Both services are the real ones; the log sink, the settings read and Discord are fakes. The database agrees with
 * the cached row unless `fresh` changes it; a null `fresh` means the row is gone.
 */
function setup(options: { row?: Record<string, unknown>; fresh?: Record<string, unknown> | null } = {}) {
  const row = repeatRow(options.row);
  const guild = fakeGuild();
  const honeypot = new HoneypotService();
  const repeatSpam = new RepeatSpamService();
  const logging = {
    shouldLog: vi.fn(async (_guildId: string, _event: string) => true),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
    sendHoneypotEmbed: vi.fn(
      async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {},
    ),
    sendNotice: vi.fn(async (_guildId: string, _description: string, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
  const guildService = {
    getSettingsFresh: vi.fn(async (_guildId: string) => (options.fresh === null ? null : { ...row, ...options.fresh })),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = { logger, services: { honeypot, repeatSpam, logging, guild: guildService } } as unknown as BotContext;
  const run = (message: FakeMessage) => handleRepeatSpamMessage(asMessage(message), row, ctx);
  /** Posts one message per channel, in order, and returns each result. */
  const postIn = async (channelIds: string[], options: Omit<MessageOptions, "channelId"> = {}) => {
    const results: string[] = [];
    for (const channelId of channelIds) results.push(await run(fakeMessage(guild, { ...options, channelId })));
    return results;
  };
  return { row, guild, honeypot, repeatSpam, logging, guildService, logger, ctx, run, postIn };
}

type FakeLogging = ReturnType<typeof setup>["logging"];

function embeds(logging: FakeLogging) {
  return logging.sendHoneypotEmbed.mock.calls.map(([, embed]) => embed.toJSON());
}

function field(embed: ReturnType<EmbedBuilder["toJSON"]>, name: string) {
  return embed.fields?.find((f) => f.name === name)?.value;
}

/** The notice texts sent, in order. */
function notices(logging: FakeLogging) {
  return logging.sendNotice.mock.calls.map(([, description]) => description);
}

function channelDeletes(guild: FakeGuild) {
  return [...guild.channels.cache.values()].flatMap((channel) => channel.messages.delete.mock.calls);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets pending promise callbacks run. */
async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

const LEAD = "<@u1> (u1) posted the same message in 3 channels (repeated-message check).";

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleRepeatSpamMessage", () => {
  it("kicks an account that posts the same sentence in 3 channels, through the trap's kick path", async () => {
    const { guild, honeypot, postIn } = setup();

    const results = await postIn(["a", "b", "c"]);

    expect(results).toEqual(["not_caught", "not_caught", "handled"]);
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).toHaveBeenCalledWith("u1", {
      deleteMessageSeconds: 3600,
      reason: "[Honeypot kick] same message in 3 channels",
    });
    expect(guild.bans.remove).toHaveBeenCalledWith("u1", UNBAN_REASON);
    expect(honeypot.takeBanEvent("g1", "u1")?.action).toBe("kick");
    // The ban cleaned up the last hour of messages, so DragonBot deletes no copy itself.
    expect(channelDeletes(guild)).toEqual([]);
  });

  it("does nothing below the configured count", async () => {
    const { guild, postIn } = setup({ row: { repeatSpamChannelCount: 4 } });

    await postIn(["a", "b", "c"]);
    expect(guild.members.ban).not.toHaveBeenCalled();

    await postIn(["d"]);
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
  });

  it("never acts on repeats in one channel", async () => {
    const { guild, logging, postIn } = setup();

    const results = await postIn(["a", "a", "a", "a"]);

    expect(results).toEqual(["not_caught", "not_caught", "not_caught", "not_caught"]);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(channelDeletes(guild)).toEqual([]);
    expect(logging.sendHoneypotEmbed).not.toHaveBeenCalled();
  });

  it("leaves staff alone completely", async () => {
    const { guild, logging, guildService, postIn } = setup();

    const results = await postIn(["a", "b", "c", "d"], {
      member: fakeMember({ permissions: [PermissionFlagsBits.KickMembers] }),
    });

    expect(results).toEqual(["not_caught", "not_caught", "not_caught", "not_caught"]);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(channelDeletes(guild)).toEqual([]);
    expect(logging.sendHoneypotEmbed).not.toHaveBeenCalled();
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
  });

  it("leaves verified members alone completely", async () => {
    const { guild, logging, guildService, postIn } = setup();

    const results = await postIn(["a", "b", "c", "d"], { member: fakeMember({ roleIds: ["verified-role"] }) });

    expect(results).toEqual(["not_caught", "not_caught", "not_caught", "not_caught"]);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(channelDeletes(guild)).toEqual([]);
    expect(logging.sendHoneypotEmbed).not.toHaveBeenCalled();
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
  });

  it("does nothing when the member lookup fails", async () => {
    const { guild, logging, logger, postIn } = setup();
    guild.members.fetch.mockRejectedValue(missingPermissions());

    const results = await postIn(["a", "b", "c"], { member: null });

    expect(results).toEqual(["not_caught", "not_caught", "not_caught"]);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(channelDeletes(guild)).toEqual([]);
    expect(logging.sendHoneypotEmbed).not.toHaveBeenCalled();
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // The tracker was cleared, so one more copy is below the count again.
    await expect(postIn(["d"], { member: null })).resolves.toEqual(["not_caught"]);
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("leaves staff alone when only the fetched member shows it", async () => {
    const { guild, logging, guildService, postIn } = setup();
    guild.members.fetch.mockResolvedValue(fakeMember({ permissions: [PermissionFlagsBits.BanMembers] }));

    const results = await postIn(["a", "b", "c"], { member: null });

    expect(results).toEqual(["not_caught", "not_caught", "not_caught"]);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(channelDeletes(guild)).toEqual([]);
    expect(logging.sendHoneypotEmbed).not.toHaveBeenCalled();
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(guildService.getSettingsFresh).not.toHaveBeenCalled();

    await expect(postIn(["d"], { member: null })).resolves.toEqual(["not_caught"]);
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it("kicks an author who already left", async () => {
    const { guild, logging, postIn } = setup();
    guild.members.fetch.mockRejectedValue(unknownMember());

    await postIn(["a", "b", "c"], { member: null });

    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(field(embeds(logging)[0], "Honeypot Action")).toBe(
      "Kicked. They had already left; only what DragonBot saw was cleaned up.",
    );
  });

  it("makes no Discord or database calls below the threshold", async () => {
    const { guild, guildService, postIn } = setup();

    await postIn(["a", "b"], { member: null });

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  it("ignores bot, webhook and system posts, and servers with the check off", async () => {
    const ignored: MessageOptions[] = [{ authorIsBot: true }, { webhookId: "hook" }, { system: true }];
    for (const options of ignored) {
      const { guild, run } = setup();
      await run(fakeMessage(guild, { ...options, channelId: "a" }));
      await run(fakeMessage(guild, { ...options, channelId: "b" }));

      await expect(run(fakeMessage(guild, { channelId: "c" }))).resolves.toBe("not_caught");
      expect(guild.members.ban).not.toHaveBeenCalled();
    }

    const { guild, ctx, run } = setup();
    const off = repeatRow({ isRepeatSpamEnabled: false });
    await handleRepeatSpamMessage(asMessage(fakeMessage(guild, { channelId: "a" })), off, ctx);
    await handleRepeatSpamMessage(asMessage(fakeMessage(guild, { channelId: "b" })), off, ctx);

    await expect(run(fakeMessage(guild, { channelId: "c" }))).resolves.toBe("not_caught");
    expect(guild.members.ban).not.toHaveBeenCalled();
  });

  it("re-reads settings and kicks nobody when the fresh row no longer catches it", async () => {
    const freshRows: (Record<string, unknown> | null)[] = [
      { isRepeatSpamEnabled: false },
      { repeatSpamChannelCount: 4 },
      { repeatSpamMatchMode: "exact" },
      { repeatSpamMatchMode: "fuzzy" },
      { verificationRoleId: "new-verified-role" },
      null,
    ];
    for (const fresh of freshRows) {
      const { guild, guildService, postIn } = setup({ fresh });

      const results = await postIn(["a", "b", "c"], { member: fakeMember({ roleIds: ["new-verified-role"] }) });

      expect(results).toEqual(["not_caught", "not_caught", "not_caught"]);
      expect(guildService.getSettingsFresh).toHaveBeenCalledTimes(1);
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(channelDeletes(guild)).toEqual([]);
    }
  });

  it("kicks an account once for a burst", async () => {
    const { guild, logging, run } = setup();
    guild.members.fetch.mockImplementation(async () => {
      await Promise.resolve();
      return fakeMember();
    });
    const copies = ["a", "b", "c", "d", "e"].map((channelId) =>
      fakeMessage(guild, { channelId, member: null, createdTimestamp: T0 - 1_000 }),
    );

    await Promise.all(copies.map(run));

    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(logging.sendHoneypotEmbed).toHaveBeenCalledTimes(1);
    expect(copies[3].delete).toHaveBeenCalled();
    expect(copies[4].delete).toHaveBeenCalled();
  });

  it("deletes copies that arrive while the case is open", async () => {
    const { guild, postIn, run } = setup();
    const banHeld = deferred();
    guild.members.ban.mockImplementation(async () => {
      await banHeld.promise;
      return "u1";
    });

    await postIn(["a", "b"]);
    const third = run(fakeMessage(guild, { channelId: "c" }));
    await flush();
    expect(guild.members.ban).toHaveBeenCalledTimes(1);

    const copy = fakeMessage(guild, { channelId: "d" });
    await expect(run(copy)).resolves.toBe("handled");
    expect(copy.delete).toHaveBeenCalled();

    const different = fakeMessage(guild, { channelId: "d", content: OTHER_SENTENCE });
    await expect(run(different)).resolves.toBe("not_caught");
    expect(different.delete).not.toHaveBeenCalled();

    banHeld.resolve();
    await expect(third).resolves.toBe("handled");
  });

  it("shares the case with the channel trap", async () => {
    const trapArmed = {
      isHoneypotEnabled: true,
      honeypotChannelId: "trap",
      honeypotAction: "ban",
      honeypotWarningChannelId: "trap",
      honeypotWarningMessageId: "100",
    };
    const { row, guild, ctx, postIn, run } = setup({ row: trapArmed });
    const banHeld = deferred();
    guild.members.ban.mockImplementation(async () => {
      await banHeld.promise;
      return "u1";
    });

    await postIn(["a", "b"]);
    const third = run(fakeMessage(guild, { channelId: "c" }));
    await flush();

    const trapPost = fakeMessage(guild, { channelId: "trap" });
    await expect(handleHoneypotMessage(asMessage(trapPost), row, ctx)).resolves.toBe("handled");
    expect(trapPost.delete).toHaveBeenCalled();

    banHeld.resolve();
    await third;
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).toHaveBeenCalledWith("u1", {
      deleteMessageSeconds: 3600,
      reason: "[Honeypot kick] same message in 3 channels",
    });
    expect(guild.bans.remove).toHaveBeenCalled();
  });

  it("deletes the copies itself when the kick fails, then sends a notice naming the check", async () => {
    const { guild, logging, run } = setup();
    guild.members.ban.mockRejectedValue(missingPermissions());
    const posted = ["a", "b", "c"].map((channelId) => fakeMessage(guild, { channelId }));

    for (const message of posted) await run(message);

    const noticeOrder = logging.sendNotice.mock.invocationCallOrder[0];
    for (const message of posted) {
      const channel = guild.channels.cache.get(message.channelId)!;
      expect(channel.messages.delete).toHaveBeenCalledWith(message.id);
      expect(channel.messages.delete.mock.invocationCallOrder[0]).toBeLessThan(noticeOrder);
    }
    expect(notices(logging)).toEqual([`${LEAD} Removal failed: Missing Permissions. Copies deleted.`]);
  });

  it("reports copies it couldn't delete", async () => {
    const { guild, logging, postIn } = setup();
    guild.members.ban.mockRejectedValue(missingPermissions());
    guild.channels.cache.get("b")!.messages.delete.mockRejectedValue(missingPermissions());

    await postIn(["a", "b", "c"]);

    const sent = notices(logging);
    expect(sent[0]).toBe(`${LEAD} Removal failed: Missing Permissions. Couldn't delete every copy.`);
    expect(sent.at(-1)).toBe(
      `${LEAD} Couldn't delete 1 of the 3 copies: Missing Permissions. Delete them by hand if they're still there.`,
    );
  });

  it("counts a copy as deleted only when Discord says it is gone", async () => {
    const { guild, logging, postIn } = setup();
    guild.members.ban.mockRejectedValue(missingPermissions());
    guild.channels.cache.get("a")!.messages.delete.mockRejectedValue(unknownMessage());
    guild.channels.fetch.mockImplementation(async (id: string) => {
      if (id === "b") throw unknownChannel();
      if (id === "c") return null;
      return guild.channels.cache.get(id) ?? null;
    });

    await postIn(["a", "b", "c"]);

    const sent = notices(logging);
    expect(sent[0]).toMatch(/Couldn't delete every copy\.$/);
    expect(sent.at(-1)!.startsWith(`${LEAD} Couldn't delete 1 of the 3 copies: `)).toBe(true);
  });

  it("logs the case with its own embed, whatever the event switches", async () => {
    const { logging, postIn } = setup();

    await postIn(["a", "b", "c"]);

    expect(logging.sendHoneypotEmbed).toHaveBeenCalledTimes(1);
    const [embed] = embeds(logging);
    expect(embed.title).toBe("Repeated Messages (Honeypot)");
    expect(field(embed, "Channels")).toBe("<#a>, <#b>, <#c>");
    expect(field(embed, "Content")).toBe(SENTENCE);
    expect(logging.shouldLog).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("starts no kick during shutdown and deletes nothing", async () => {
    const { guild, honeypot, logging, postIn, run } = setup();
    void honeypot.drain(1000);

    await postIn(["a", "b"]);
    const third = fakeMessage(guild, { channelId: "c" });
    await expect(run(third)).resolves.toBe("handled");

    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(third.delete).not.toHaveBeenCalled();
    expect(channelDeletes(guild)).toEqual([]);
    const sent = notices(logging);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(`${LEAD} DragonBot was shutting down, so nobody was removed.`);
    expect(field(embeds(logging)[0], "Honeypot Action")).toBe("DragonBot was shutting down, so nobody was removed.");
  });

  it("keeps the shutdown drain waiting for the case", async () => {
    const { guild, honeypot, postIn, run } = setup();
    const banHeld = deferred();
    guild.members.ban.mockImplementation(async () => {
      await banHeld.promise;
      return "u1";
    });

    await postIn(["a", "b"]);
    const third = run(fakeMessage(guild, { channelId: "c" }));
    await flush();
    let drained = false;
    const drain = honeypot.drain(5_000).then(() => {
      drained = true;
    });
    await flush();
    expect(drained).toBe(false);

    banHeld.resolve();
    await third;
    await drain;
    expect(drained).toBe(true);
  });
});
