import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  DiscordAPIError,
  HTTPError,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type EmbedBuilder,
  type Guild,
  type Message,
} from "discord.js";
import type { Logger } from "pino";
import type { GuildRow } from "@dragonbot/db";
import { deleteLateMessage, handleHoneypotMessage, sweepCachedMessages } from "../../src/lib/honeypot-enforcer.js";
import {
  HoneypotService,
  IN_FLIGHT_TIMEOUT_MS,
  LATE_MESSAGE_WINDOW_MS,
  SWEEP_DELAY_MS,
  UNBAN_REASON,
} from "../../src/services/honeypot.service.js";
import type { BotContext } from "../../src/types/context.js";

/** A fixed clock, so "the last hour" is a real hour. */
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const HOUR_MS = 3_600_000;

function apiError(code: number, message: string, status: number) {
  return new DiscordAPIError({ code, message }, code, status, "PUT", "/x", {});
}

const unknownMember = () => apiError(RESTJSONErrorCodes.UnknownMember, "Unknown Member", 404);
const unknownBan = () => apiError(RESTJSONErrorCodes.UnknownBan, "Unknown Ban", 404);
const unknownMessage = () => apiError(RESTJSONErrorCodes.UnknownMessage, "Unknown Message", 404);
const missingPermissions = () => apiError(RESTJSONErrorCodes.MissingPermissions, "Missing Permissions", 403);
/** Discord's answer when the server requires 2FA for moderation and its owner has none. */
const twoFactorRequired = () =>
  apiError(RESTJSONErrorCodes.TwoFactorAuthenticationIsRequired, "Two factor is required for this operation", 403);
/** What discord.js throws once a 5xx outlasts its retries. */
const serverError = (status: 500 | 503) =>
  new HTTPError(status, status === 500 ? "Internal Server Error" : "Service Unavailable", "PUT", "/x", {});
/** What discord.js throws when a request times out. */
const timeoutError = () => new DOMException("This operation was aborted", "AbortError");

function fakeMember(options: { permissions?: bigint[]; roleIds?: string[] } = {}) {
  return {
    permissions: new PermissionsBitField(options.permissions ?? []),
    roles: { cache: new Collection((options.roleIds ?? []).map((id): [string, { id: string }] => [id, { id }])) },
  };
}

type FakeMember = ReturnType<typeof fakeMember>;

/** A server where nobody is banned and every ban, member lookup and unban works, unless a test says otherwise. */
function fakeGuild() {
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
    channels: { cache: new Collection<string, unknown>() },
    systemChannelId: null as string | null,
  };
}

type FakeGuild = ReturnType<typeof fakeGuild>;

interface MessageOptions {
  id?: string;
  channelId?: string;
  authorId?: string;
  authorIsBot?: boolean;
  createdTimestamp?: number;
  system?: boolean;
  webhookId?: string | null;
  /** null when the gateway sent no member, so the handler has to look the author up. */
  member?: FakeMember | null;
  deleteError?: Error;
}

/** A message posted now in the honeypot channel, trap, by u1, an ordinary member, unless the options say otherwise. */
function fakeMessage(guild: FakeGuild, options: MessageOptions = {}) {
  const channelId = options.channelId ?? "trap";
  const authorId = options.authorId ?? "u1";
  return {
    id: options.id ?? "111",
    guildId: guild.id,
    guild,
    channelId,
    channel: { id: channelId, name: channelId },
    author: {
      id: authorId,
      bot: options.authorIsBot ?? false,
      tag: `${authorId}#0001`,
      displayAvatarURL: () => `https://cdn.example/${authorId}.png`,
    },
    member: options.member === undefined ? fakeMember() : options.member,
    system: options.system ?? false,
    webhookId: options.webhookId ?? null,
    content: "everything below is FREE, DM me",
    attachments: new Collection(),
    reactions: { cache: new Collection() },
    stickers: new Collection(),
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    editedTimestamp: null,
    nonce: null,
    client: { name: "fake client" },
    delete: vi.fn(async () => {
      if (options.deleteError) throw options.deleteError;
    }),
  };
}

type FakeMessage = ReturnType<typeof fakeMessage>;

const asMessage = (message: FakeMessage) => message as unknown as Message<true>;

/**
 * The honeypot is armed in trap, with its warning 100 posted there before the test's posts (111 and up). Members with
 * verified-role are verified.
 */
function honeypotRow(overrides: Record<string, unknown> = {}): GuildRow {
  return {
    guildId: "g1",
    isHoneypotEnabled: true,
    honeypotChannelId: "trap",
    honeypotAction: "kick",
    honeypotWarningChannelId: "trap",
    honeypotWarningMessageId: "100",
    verificationRoleId: "verified-role",
    ...overrides,
  } as unknown as GuildRow;
}

/** Fresh rows under which the honeypot no longer acts in trap, whatever the cached row says. null: the row is gone. */
const DISARMED_ROWS: (Record<string, unknown> | null)[] = [
  { isHoneypotEnabled: false },
  { honeypotChannelId: "another-channel" },
  { honeypotWarningChannelId: null, honeypotWarningMessageId: null },
  { honeypotAction: "mute" },
  null,
];

/**
 * The honeypot service is the real one; the log sink, the settings read and Discord are fakes.
 * The database agrees with the cached row unless `fresh` changes it; a null `fresh` means the row is gone.
 */
function setup(options: { row?: Record<string, unknown>; fresh?: Record<string, unknown> | null } = {}) {
  const row = honeypotRow(options.row);
  const guild = fakeGuild();
  const honeypot = new HoneypotService();
  const logging = {
    shouldLog: vi.fn(async (_guildId: string, _event: string) => true),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
    sendNotice: vi.fn(async (_guildId: string, _description: string, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
  const guildService = {
    getSettingsFresh: vi.fn(async (_guildId: string) => (options.fresh === null ? null : { ...row, ...options.fresh })),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = { logger, services: { honeypot, logging, guild: guildService } } as unknown as BotContext;
  const run = (message: FakeMessage) => handleHoneypotMessage(asMessage(message), row, ctx);
  return { row, guild, honeypot, logging, guildService, logger, ctx, run };
}

type FakeLogging = ReturnType<typeof setup>["logging"];

function logEntries(logging: FakeLogging) {
  return logging.sendLogEmbed.mock.calls.map(([, embed]) => embed.toJSON());
}

/** The Honeypot Action field of each log entry sent, in order. */
function loggedActions(logging: FakeLogging) {
  return logEntries(logging).map((entry) => entry.fields?.find((field) => field.name === "Honeypot Action")?.value);
}

/** The notice texts sent, in order. */
function notices(logging: FakeLogging) {
  return logging.sendNotice.mock.calls.map(([, description]) => description);
}

function cachedMessage(id: string, authorId: string | null, createdTimestamp: number) {
  // A partial message in the cache has no author.
  return { id, author: authorId === null ? null : { id: authorId }, createdTimestamp, delete: vi.fn(async () => {}) };
}

type CachedMessage = ReturnType<typeof cachedMessage>;

function fakeTextChannel(id: string, messages: CachedMessage[], options: { bulkDeleteError?: Error } = {}) {
  return {
    id,
    isTextBased: () => true,
    messages: { cache: new Collection(messages.map((message): [string, CachedMessage] => [message.id, message])) },
    bulkDelete: vi.fn(async (ids: string[], _filterOld?: boolean) => {
      if (options.bulkDeleteError) throw options.bulkDeleteError;
      return new Collection(ids.map((messageId): [string, undefined] => [messageId, undefined]));
    }),
  };
}

function sweepGuild(channels: Record<string, unknown>): Guild {
  return { id: "g1", channels: { cache: new Collection(Object.entries(channels)) } } as unknown as Guild;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleHoneypotMessage", () => {
  it("ignores other channels and an unconfigured honeypot", async () => {
    const cases = [
      { row: {}, channelId: "general" },
      { row: { isHoneypotEnabled: false }, channelId: "trap" },
      { row: { honeypotChannelId: null }, channelId: "trap" },
    ];
    for (const { row, channelId } of cases) {
      const { guild, logging, guildService, run } = setup({ row });
      const message = fakeMessage(guild, { channelId });

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    }
  });

  it("does nothing while the warning is not posted", async () => {
    const unarmed = [
      // Never posted, for example because DragonBot can't send messages there.
      { honeypotWarningChannelId: null, honeypotWarningMessageId: null },
      { honeypotWarningMessageId: null },
      // Still stored in the old channel after the honeypot moved.
      { honeypotWarningChannelId: "old-trap" },
    ];
    for (const row of unarmed) {
      const { guild, logging, run } = setup({ row });
      const message = fakeMessage(guild);

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    }
  });

  it("leaves a honeypot in the server's System Messages channel alone", async () => {
    // Discord's "Wave to say hi" button posts the member's sticker as a reply to a join notice, and a reply isn't a
    // system message. The check also holds when the System Messages channel moved there after the honeypot was armed.
    for (const member of [fakeMember(), fakeMember({ roleIds: ["verified-role"] })]) {
      const { guild, logging, guildService, run } = setup({ row: { honeypotAction: "ban" } });
      guild.systemChannelId = "trap";
      const message = fakeMessage(guild, { member });

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      expect(logging.sendNotice).not.toHaveBeenCalled();
      // Decided from the gateway's copy of the server, before any lookup or re-read.
      expect(guild.members.fetch).not.toHaveBeenCalled();
      expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
    }
  });

  it("removes nobody when the fresh row shares the honeypot channel with another setting", async () => {
    // For example two dashboard saves at the same moment, each passing the dashboard's check before the other's write.
    for (const member of [fakeMember(), fakeMember({ roleIds: ["verified-role"] })]) {
      const { guild, logging, guildService, run } = setup({ fresh: { introChannelId: "trap" } });
      const message = fakeMessage(guild, { member });

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(guildService.getSettingsFresh).toHaveBeenCalledWith("g1");
      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      expect(logging.sendNotice).not.toHaveBeenCalled();
    }
  });

  it("leaves a post that isn't newer than the warning alone", async () => {
    // A gateway replay, or a post made while the warning was being replaced, was made with no warning shown.
    const cases = [
      { warning: "100", post: "99" },
      { warning: "100", post: "100" },
      // Not a snowflake: nothing can be compared, so nothing is done.
      { warning: "w1", post: "111" },
      { warning: "100", post: "m111" },
    ];
    for (const { warning, post } of cases) {
      const { guild, logging, guildService, run } = setup({ row: { honeypotWarningMessageId: warning } });
      const message = fakeMessage(guild, { id: post });

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      // Decided from the cached row, before any settings re-read.
      expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
    }
  });

  it("leaves a post alone when the fresh row's warning is newer than it", async () => {
    // The cached warning is older than the post, but the warning was replaced after the post was made.
    const { guild, logging, guildService, run } = setup({
      row: { honeypotWarningMessageId: "100" },
      fresh: { honeypotWarningMessageId: "200" },
    });
    const message = fakeMessage(guild, { id: "150" });

    await expect(run(message)).resolves.toBe("not_honeypot");

    expect(guildService.getSettingsFresh).toHaveBeenCalledWith("g1");
    expect(message.delete).not.toHaveBeenCalled();
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("leaves system messages in the honeypot alone", async () => {
    // A join notice has the new member as its author. Webhook and bot posts are left alone too.
    for (const options of [{ system: true }, { webhookId: "hook-1" }, { authorIsBot: true }]) {
      const { guild, logging, run } = setup();
      const message = fakeMessage(guild, options);

      await expect(run(message)).resolves.toBe("handled");

      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    }
  });

  it("ignores staff completely", async () => {
    const staffPermissions = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
    ];
    for (const permission of staffPermissions) {
      const { guild, logging, guildService, run } = setup({ row: { honeypotAction: "ban" } });
      const message = fakeMessage(guild, { member: fakeMember({ permissions: [permission] }) });

      // "handled", so a staff post in the honeypot earns no XP either.
      await expect(run(message)).resolves.toBe("handled");

      expect(message.delete).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      expect(logging.sendNotice).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      // Staff are left alone before the settings re-read.
      expect(guildService.getSettingsFresh).not.toHaveBeenCalled();
    }
  });

  it("removes helpers who only have Manage Messages or Timeout Members", async () => {
    const { guild, run } = setup({ row: { honeypotAction: "ban" } });
    const helper = fakeMember({ permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers] });

    await expect(run(fakeMessage(guild, { member: helper }))).resolves.toBe("handled");

    expect(guild.members.ban).toHaveBeenCalledTimes(1);
  });

  it("deletes and logs a verified member's message without removing them", async () => {
    const { guild, honeypot, logging, run } = setup();
    const message = fakeMessage(guild, { member: fakeMember({ roleIds: ["verified-role"] }) });

    await expect(run(message)).resolves.toBe("handled");

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(honeypot.consumeOwnDeletion("111")).toBe(true);
    expect(logEntries(logging).map((entry) => entry.title)).toEqual(["Message Deleted (Honeypot)"]);
    expect(loggedActions(logging)).toEqual(["Message deleted only (verified member)."]);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(guild.bans.fetch).not.toHaveBeenCalled();
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("bans with cleanup and the marked reason in ban mode", async () => {
    const { guild, honeypot, logging, ctx, run } = setup({ row: { honeypotAction: "ban" } });
    const message = fakeMessage(guild);

    await expect(run(message)).resolves.toBe("handled");

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).toHaveBeenCalledWith("u1", {
      deleteMessageSeconds: 3600,
      reason: "[Honeypot] posted in #trap (msg 111)",
    });
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).not.toHaveBeenCalled();
    const record = { action: "ban", reason: "[Honeypot] posted in #trap (msg 111)", channelId: "trap" };
    expect(honeypot.takeBanEvent("g1", "u1")).toEqual(record);
    expect(honeypot.takeRemoveEvent("g1", "u1")).toEqual(record);
    expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(true);
    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "message_delete");
    expect(logging.sendLogEmbed).toHaveBeenCalledWith("g1", expect.anything(), message.client, ctx.logger);
    const [entry] = logEntries(logging);
    expect(entry.title).toBe("Message Deleted (Honeypot)");
    expect(entry.fields).toContainEqual({ name: "Honeypot Action", value: "Banned. Their messages from the last hour were cleaned up." });
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("bans then unbans in kick mode", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.fetch).toHaveBeenCalledWith({ user: "u1", force: true, cache: false });
    expect(guild.members.ban).toHaveBeenCalledWith("u1", {
      deleteMessageSeconds: 3600,
      reason: "[Honeypot kick] posted in #trap (msg 111)",
    });
    expect(guild.bans.remove).toHaveBeenCalledWith("u1", "[Honeypot kick] unban after message cleanup");
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
    // The ban list is checked before the ban, and the unban follows the ban.
    expect(guild.bans.fetch.mock.invocationCallOrder[0]).toBeLessThan(guild.members.ban.mock.invocationCallOrder[0]);
    expect(guild.members.ban.mock.invocationCallOrder[0]).toBeLessThan(guild.bans.remove.mock.invocationCallOrder[0]);
    expect(honeypot.takeRemoveEvent("g1", "u1")).toMatchObject({ action: "kick" });
    expect(loggedActions(logging)).toEqual(["Kicked. Their messages from the last hour were cleaned up."]);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("never unbans someone who was already banned", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.fetch.mockResolvedValue({ user: { id: "u1" }, reason: "banned by a moderator" });
    const message = fakeMessage(guild);

    await expect(run(message)).resolves.toBe("handled");

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(honeypot.wasRecentlyActioned("g1", "u1")).toBe(false);
    expect(loggedActions(logging)).toEqual(["Already banned. Message deleted only."]);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("removes nobody in kick mode when the ban list can't be checked", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.fetch.mockRejectedValue(serverError(503));
    const message = fakeMessage(guild);

    await expect(run(message)).resolves.toBe("handled");

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(honeypot.wasRecentlyActioned("g1", "u1")).toBe(false);
    expect(loggedActions(logging)).toEqual([
      "Removal failed: couldn't check whether they were already banned (Service Unavailable). Message deleted only.",
    ]);
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
  });

  it("treats Unknown Ban on the unban as success", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.remove.mockRejectedValue(unknownBan());

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
    expect(loggedActions(logging)).toEqual(["Kicked. Their messages from the last hour were cleaned up."]);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("retries a failed unban once", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.remove.mockRejectedValueOnce(serverError(500));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.remove).toHaveBeenCalledTimes(2);
    expect(loggedActions(logging)).toEqual(["Kicked. Their messages from the last hour were cleaned up."]);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("reports a stuck ban when the unban fails twice", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.remove.mockRejectedValue(serverError(500));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.remove).toHaveBeenCalledTimes(2);
    const [value] = loggedActions(logging);
    expect(value).toContain("still banned");
    expect(value).toBe(
      "Kicked, but the unban failed: Internal Server Error. They are still banned and need a manual unban.",
    );
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    const [notice] = notices(logging);
    expect(notice).toContain("<@u1>");
    expect(notice).toContain(value);
  });

  it("checks an uncertain ban result and finishes the kick", async () => {
    for (const error of [serverError(503), timeoutError()]) {
      const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
      guild.members.ban.mockRejectedValue(error);
      // Not banned before the ban; banned when checked after it.
      guild.bans.fetch.mockRejectedValueOnce(unknownBan()).mockResolvedValueOnce({ user: { id: "u1" } });

      await expect(run(fakeMessage(guild))).resolves.toBe("handled");

      expect(guild.bans.fetch).toHaveBeenCalledTimes(2);
      expect(guild.bans.remove).toHaveBeenCalledWith("u1", UNBAN_REASON);
      expect(honeypot.takeBanEvent("g1", "u1")).toMatchObject({ action: "kick" });
      expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(true);
      expect(loggedActions(logging)).toEqual(["Kicked. Their messages from the last hour were cleaned up."]);
      expect(logging.sendNotice).not.toHaveBeenCalled();
    }
  });

  it("drops the record when the check shows an uncertain ban didn't happen", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.members.ban.mockRejectedValue(serverError(503));
    // Not banned before the ban, and still not banned after it.
    guild.bans.fetch.mockRejectedValue(unknownBan());

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.fetch).toHaveBeenCalledTimes(2);
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(honeypot.takeBanEvent("g1", "u1")).toBeNull();
    expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(false);
    expect(loggedActions(logging)).toEqual(["Removal failed: Service Unavailable. Message deleted only."]);
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfirmed removal when the ban check fails too", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    const leftover = cachedMessage("left-1", "u1", T0 - 60_000);
    guild.channels.cache.set("general", fakeTextChannel("general", [leftover]));
    guild.members.ban.mockRejectedValue(serverError(503));
    guild.bans.fetch.mockRejectedValueOnce(unknownBan()).mockRejectedValueOnce(serverError(503));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    // Unbanning a ban that never happened is harmless, so the kick is finished either way.
    expect(guild.bans.remove).toHaveBeenCalledWith("u1", UNBAN_REASON);
    const [value] = loggedActions(logging);
    expect(value).toMatch(/^Removal unconfirmed:/);
    expect(value).toBe("Removal unconfirmed: Service Unavailable. Check the ban list.");
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain(value);
    // A late ban event still stays out of ban sync.
    expect(honeypot.takeBanEvent("g1", "u1")).toMatchObject({ action: "kick" });
    // The account may still be a member: no late window, and no sweep.
    expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(false);
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);
    expect(leftover.delete).not.toHaveBeenCalled();
  });

  it("reports still banned after an uncertain ban whose unban fails", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    const leftover = cachedMessage("left-1", "u1", T0 - 60_000);
    guild.channels.cache.set("general", fakeTextChannel("general", [leftover]));
    guild.members.ban.mockRejectedValue(serverError(500));
    // Not banned before the ban; the check after it fails too, so nobody can tell whether the ban happened.
    guild.bans.fetch.mockRejectedValueOnce(unknownBan()).mockRejectedValueOnce(serverError(500));
    guild.bans.remove.mockRejectedValue(serverError(500));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.remove).toHaveBeenCalledTimes(2);
    const stuck = "Kicked, but the unban failed: Internal Server Error. They are still banned and need a manual unban.";
    expect(loggedActions(logging)).toEqual([stuck]);
    expect(notices(logging)).toEqual([`<@u1> (u1) posted in the honeypot <#trap>. ${stuck}`]);
    // The ban was never confirmed: no late window, and no sweep.
    expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(false);
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);
    expect(leftover.delete).not.toHaveBeenCalled();
  });

  it("never bans for a case that timed out before its record", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    // The already-banned check sits in a backed-up queue until the case has timed out.
    guild.bans.fetch.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(unknownBan()), IN_FLIGHT_TIMEOUT_MS + 1);
        }),
    );

    const handled = run(fakeMessage(guild));
    await vi.advanceTimersByTimeAsync(IN_FLIGHT_TIMEOUT_MS + 1);

    await expect(handled).resolves.toBe("handled");
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(honeypot.wasRecentlyActioned("g1", "u1")).toBe(false);
    const [value] = loggedActions(logging);
    expect(value).toMatch(/^Removal failed: the case timed out/);
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
  });

  it("drops the record and reports when the ban is refused", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "ban" } });
    guild.members.ban.mockRejectedValue(missingPermissions());
    const message = fakeMessage(guild);

    await expect(run(message)).resolves.toBe("handled");

    expect(message.delete).toHaveBeenCalledTimes(1);
    // A refusal is certain, so there's nothing to check.
    expect(guild.bans.fetch).not.toHaveBeenCalled();
    expect(honeypot.takeBanEvent("g1", "u1")).toBeNull();
    expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(false);
    const [value] = loggedActions(logging);
    expect(value).toMatch(/^Removal failed:/);
    expect(value).toBe("Removal failed: Missing Permissions. Message deleted only.");
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain(value);
  });

  it("cuts a long failure reason to 200 characters", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "ban" } });
    guild.members.ban.mockRejectedValue(apiError(RESTJSONErrorCodes.MissingPermissions, "x".repeat(2_000), 403));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    const expected = `Removal failed: ${"x".repeat(200)}. Message deleted only.`;
    expect(loggedActions(logging)).toEqual([expected]);
    expect(notices(logging)[0]).toContain(expected);
    expect(notices(logging)[0]).not.toContain("x".repeat(201));
  });

  it("deletes but never removes when the member lookup fails for another reason", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "ban" } });
    guild.members.fetch.mockRejectedValue(serverError(503));
    const message = fakeMessage(guild, { member: null });

    await expect(run(message)).resolves.toBe("handled");

    expect(guild.members.fetch).toHaveBeenCalledWith("u1");
    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(loggedActions(logging)).toEqual(["Message deleted only. Couldn't check membership, so nobody was removed."]);
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)).toEqual([
      "<@u1> (u1) posted in the honeypot <#trap>. " +
        "Message deleted only. Couldn't check membership (Service Unavailable), so nobody was removed.",
    ]);
  });

  it("fetches the member when the gateway payload has none", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "ban" } });
    const message = fakeMessage(guild, { member: null });

    await expect(run(message)).resolves.toBe("handled");

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(guild.members.fetch).toHaveBeenCalledWith("u1");
    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    // A member, not an account that already left: the log claims the cleanup, and their departure matches the ban.
    expect(loggedActions(logging)).toEqual(["Banned. Their messages from the last hour were cleaned up."]);
    expect(honeypot.takeRemoveEvent("g1", "u1")).toMatchObject({ action: "ban" });
  });

  it("bans an account that already left and says so", async () => {
    for (const action of ["ban", "kick"] as const) {
      const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: action } });
      guild.members.fetch.mockRejectedValue(unknownMember());

      await expect(run(fakeMessage(guild, { member: null }))).resolves.toBe("handled");

      expect(guild.members.ban).toHaveBeenCalledWith("u1", {
        deleteMessageSeconds: 3600,
        reason: `${action === "ban" ? "[Honeypot]" : "[Honeypot kick]"} posted in #trap (msg 111)`,
      });
      expect(honeypot.takeBanEvent("g1", "u1")).toMatchObject({ action });
      // Banning someone who isn't a member sends no remove event, so their next departure isn't taken for this ban.
      expect(honeypot.takeRemoveEvent("g1", "u1")).toBeNull();
      const done = action === "ban" ? "Banned." : "Kicked.";
      expect(loggedActions(logging)).toEqual([`${done} They had already left; only what DragonBot saw was cleaned up.`]);
    }
  });

  it("re-reads settings and skips removal when the honeypot was turned off", async () => {
    // The dashboard's reload ping was lost, so the cached row still says the honeypot is armed here.
    const changed = [
      { isHoneypotEnabled: false },
      { honeypotChannelId: "another-channel" },
      { honeypotWarningChannelId: null, honeypotWarningMessageId: null },
      null,
    ];
    for (const fresh of changed) {
      const { guild, logging, guildService, run } = setup({ fresh });
      const message = fakeMessage(guild);

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(guildService.getSettingsFresh).toHaveBeenCalledWith("g1");
      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    }
  });

  it("checks the verification role in the fresh settings before removing", async () => {
    const { guild, logging, run } = setup({ row: { verificationRoleId: null }, fresh: { verificationRoleId: "verified-role" } });
    const message = fakeMessage(guild, { member: fakeMember({ roleIds: ["verified-role"] }) });

    await expect(run(message)).resolves.toBe("handled");

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(loggedActions(logging)).toEqual(["Message deleted only (verified member)."]);
  });

  it("removes nobody when the stored action is neither kick nor ban", async () => {
    const { guild, run } = setup({ fresh: { honeypotAction: "mute" } });
    const message = fakeMessage(guild);

    await expect(run(message)).resolves.toBe("not_honeypot");

    expect(guild.members.ban).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
  });

  it("leaves a verified member's post alone when the fresh row is disarmed", async () => {
    // The dashboard's reload ping was lost, so the cached row still says the honeypot is armed here.
    for (const fresh of DISARMED_ROWS) {
      const { guild, logging, guildService, run } = setup({ fresh });
      const message = fakeMessage(guild, { member: fakeMember({ roleIds: ["verified-role"] }) });

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(guildService.getSettingsFresh).toHaveBeenCalledWith("g1");
      expect(message.delete).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      expect(logging.sendNotice).not.toHaveBeenCalled();
    }
  });

  it("leaves a post alone when the lookup fails and the fresh row is disarmed", async () => {
    for (const fresh of DISARMED_ROWS) {
      const { guild, logging, guildService, run } = setup({ fresh });
      guild.members.fetch.mockRejectedValue(serverError(500));
      const message = fakeMessage(guild, { member: null });

      await expect(run(message)).resolves.toBe("not_honeypot");

      expect(guildService.getSettingsFresh).toHaveBeenCalledWith("g1");
      expect(message.delete).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      expect(logging.sendNotice).not.toHaveBeenCalled();
    }
  });

  it("rejects and removes nobody when the settings re-read fails", async () => {
    // An ordinary member, a verified member, and an author whose lookup fails: the re-read comes before all of them.
    for (const member of [fakeMember(), fakeMember({ roleIds: ["verified-role"] }), null]) {
      const { guild, logging, guildService, run } = setup({ row: { honeypotAction: "ban" } });
      guild.members.fetch.mockRejectedValue(serverError(503));
      guildService.getSettingsFresh.mockRejectedValue(new Error("database unreachable"));
      const message = fakeMessage(guild, { member });

      // The event loader logs the error.
      await expect(run(message)).rejects.toThrow("database unreachable");

      expect(message.delete).not.toHaveBeenCalled();
      expect(guild.members.ban).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
      expect(logging.sendNotice).not.toHaveBeenCalled();
    }
  });

  it("handles a burst from one account as one case", async () => {
    const { guild, ctx, row, logging } = setup({ row: { honeypotAction: "kick" } });
    // The ban waits behind rate limits for two seconds.
    guild.members.ban.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("u1"), 2_000)));
    const m1 = fakeMessage(guild, { id: "111" });
    const m2 = fakeMessage(guild, { id: "112" });

    const burst = Promise.all([handleHoneypotMessage(asMessage(m1), row, ctx), handleHoneypotMessage(asMessage(m2), row, ctx)]);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(burst).resolves.toEqual(["handled", "handled"]);

    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(m1.delete).toHaveBeenCalled();
    expect(m2.delete).toHaveBeenCalled();
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
    expect(ctx.services.honeypot.consumeOwnDeletion("112")).toBe(true);

    // A straggler, sent while the case ran but delivered after it ended, belongs to the same case.
    await vi.advanceTimersByTimeAsync(1_000);
    const straggler = fakeMessage(guild, { id: "113", createdTimestamp: T0 + 1_000 });
    await expect(handleHoneypotMessage(asMessage(straggler), row, ctx)).resolves.toBe("handled");
    expect(straggler.delete).toHaveBeenCalledTimes(1);
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
  });

  it("treats a rejoined account's honeypot post inside the late window as a new case", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });

    await expect(run(fakeMessage(guild, { id: "111" }))).resolves.toBe("handled");
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);

    // The kicked account rejoins and posts in the honeypot again a few seconds later.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(honeypot.isWithinLateWindow("g1", "u1")).toBe(true);
    await expect(run(fakeMessage(guild, { id: "222" }))).resolves.toBe("handled");

    expect(guild.members.ban).toHaveBeenCalledTimes(2);
    expect(guild.members.ban).toHaveBeenLastCalledWith("u1", {
      deleteMessageSeconds: 3600,
      reason: "[Honeypot kick] posted in #trap (msg 222)",
    });
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(2);
  });

  it("ends the case before the log entry is sent", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "kick" } });
    const slowLog = deferred();
    logging.sendLogEmbed.mockReturnValueOnce(slowLog.promise);

    const first = run(fakeMessage(guild, { id: "111" }));
    await vi.waitFor(() => expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1));
    // While the log send is slow, the kicked account rejoins and posts in the honeypot again.
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(run(fakeMessage(guild, { id: "222" }))).resolves.toBe("handled");

    expect(guild.members.ban).toHaveBeenCalledTimes(2);
    slowLog.resolve();
    await expect(first).resolves.toBe("handled");
  });

  it("keeps the shutdown drain waiting for the log entry and notices", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.remove.mockRejectedValue(serverError(500));
    const slowNotice = deferred();
    logging.sendNotice.mockReturnValueOnce(slowNotice.promise);

    const handled = run(fakeMessage(guild));
    await vi.waitFor(() => expect(logging.sendNotice).toHaveBeenCalledTimes(1));
    let drained = false;
    const drain = honeypot.drain(5_000).then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(drained).toBe(false);
    slowNotice.resolve();
    await drain;
    expect(drained).toBe(true);
    await expect(handled).resolves.toBe("handled");
  });

  it("keeps the shutdown drain waiting for a removal whose settings re-read is pending", async () => {
    const { row, guild, honeypot, guildService, run } = setup({ row: { honeypotAction: "kick" } });
    const slowRead = deferred();
    guildService.getSettingsFresh.mockImplementationOnce(async () => {
      await slowRead.promise;
      return row;
    });

    const handled = run(fakeMessage(guild));
    await vi.waitFor(() => expect(guildService.getSettingsFresh).toHaveBeenCalledTimes(1));
    let removalAtDrain: { bans: number; unbans: number } | undefined;
    const drain = honeypot.drain(5_000).then(() => {
      removalAtDrain = { bans: guild.members.ban.mock.calls.length, unbans: guild.bans.remove.mock.calls.length };
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(removalAtDrain).toBeUndefined();
    slowRead.resolve();
    await drain;
    // Shutdown goes on to destroy the client only once the kick's ban and its unban have both gone out.
    expect(removalAtDrain).toEqual({ bans: 1, unbans: 1 });
    await expect(handled).resolves.toBe("handled");
  });

  it("keeps the shutdown drain waiting for a verified member's log entry", async () => {
    const { guild, honeypot, logging, run } = setup();
    const slowLog = deferred();
    logging.sendLogEmbed.mockReturnValueOnce(slowLog.promise);

    const handled = run(fakeMessage(guild, { member: fakeMember({ roleIds: ["verified-role"] }) }));
    await vi.waitFor(() => expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1));
    let drained = false;
    const drain = honeypot.drain(5_000).then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(drained).toBe(false);
    slowLog.resolve();
    await drain;
    expect(drained).toBe(true);
    await expect(handled).resolves.toBe("handled");
  });

  it("starts no kick once shutdown has begun", async () => {
    const posts = [
      {
        deleteError: undefined,
        title: "Message Deleted (Honeypot)",
        text: "Message deleted only. DragonBot was shutting down, so nobody was removed.",
        deleteNotices: [] as string[],
      },
      // The delete fails: the texts say so, and the delete notice follows as usual.
      {
        deleteError: missingPermissions(),
        title: "Honeypot Message (Delete Failed)",
        text: "Couldn't delete the message. DragonBot was shutting down, so nobody was removed.",
        deleteNotices: ["Couldn't delete the message: Missing Permissions. Delete it by hand if it's still there."],
      },
    ];
    for (const { deleteError, title, text, deleteNotices } of posts) {
      for (const logsDeletes of [true, false]) {
        const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
        logging.shouldLog.mockResolvedValue(logsDeletes);
        const endCase = vi.spyOn(honeypot, "endCase");
        const drain = honeypot.drain(5_000);
        const message = fakeMessage(guild, { deleteError });

        await expect(run(message)).resolves.toBe("handled");

        // The drain's cap or destroy() could cut a kick off between its ban and its unban, so none starts.
        expect(guild.bans.fetch).not.toHaveBeenCalled();
        expect(guild.members.ban).not.toHaveBeenCalled();
        expect(guild.bans.remove).not.toHaveBeenCalled();
        expect(honeypot.wasRecentlyActioned("g1", "u1")).toBe(false);
        expect(message.delete).toHaveBeenCalledTimes(1);
        expect(honeypot.consumeOwnDeletion("111")).toBe(true);
        expect(logEntries(logging).map((entry) => entry.title)).toEqual(logsDeletes ? [title] : []);
        expect(loggedActions(logging)).toEqual(logsDeletes ? [text] : []);
        // The notice goes out whatever the log toggles: the account is still in the server.
        expect(notices(logging)).toEqual(
          [text, ...deleteNotices].map((notice) => `<@u1> (u1) posted in the honeypot <#trap>. ${notice}`),
        );
        // The case ended straight away, before the delete, so the account's next post is a new case.
        expect(endCase).toHaveBeenCalledTimes(1);
        expect(endCase.mock.invocationCallOrder[0]).toBeLessThan(message.delete.mock.invocationCallOrder[0]);
        expect(honeypot.beginCase("g1", "u1", Date.now() + 1)).toMatchObject({ kind: "start" });
        await drain;
      }
    }
  });

  it("still bans in ban mode once shutdown has begun", async () => {
    // A ban cut short by shutdown strands nobody. The cached row may still say kick: the fresh row's action decides.
    for (const cachedAction of ["ban", "kick"] as const) {
      const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: cachedAction }, fresh: { honeypotAction: "ban" } });
      const drain = honeypot.drain(5_000);

      await expect(run(fakeMessage(guild))).resolves.toBe("handled");

      expect(guild.members.ban).toHaveBeenCalledWith("u1", {
        deleteMessageSeconds: 3600,
        reason: "[Honeypot] posted in #trap (msg 111)",
      });
      expect(guild.members.ban).toHaveBeenCalledTimes(1);
      expect(guild.bans.remove).not.toHaveBeenCalled();
      expect(honeypot.takeBanEvent("g1", "u1")).toMatchObject({ action: "ban" });
      expect(loggedActions(logging)).toEqual(["Banned. Their messages from the last hour were cleaned up."]);
      expect(logging.sendNotice).not.toHaveBeenCalled();
      await drain;
    }
  });

  it("finishes a kick that began before shutdown, and deletes its same-case messages as usual", async () => {
    const { guild, ctx, row, honeypot, logging } = setup({ row: { honeypotAction: "kick" } });
    // The ban waits behind rate limits for two seconds, so the case is still running when shutdown begins.
    guild.members.ban.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("u1"), 2_000)));
    const trigger = fakeMessage(guild, { id: "111" });
    const handled = handleHoneypotMessage(asMessage(trigger), row, ctx);
    await vi.waitFor(() => expect(guild.members.ban).toHaveBeenCalledTimes(1));

    let drained = false;
    const drain = honeypot.drain(5_000).then(() => {
      drained = true;
    });
    // Another post from the account, part of the running case.
    const follower = fakeMessage(guild, { id: "112" });
    await expect(handleHoneypotMessage(asMessage(follower), row, ctx)).resolves.toBe("handled");
    expect(follower.delete).toHaveBeenCalledTimes(1);
    expect(drained).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(handled).resolves.toBe("handled");
    await drain;

    // The case that began before the drain ends with its ban and its unban, and the follower adds no entry or notice.
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
    expect(loggedActions(logging)).toEqual(["Kicked. Their messages from the last hour were cleaned up."]);
    expect(logging.sendNotice).not.toHaveBeenCalled();
  });

  it("calls getSettingsFresh once per message", async () => {
    // An ordinary member, a verified member, and an author whose lookup fails, before shutdown and during it.
    for (const shuttingDown of [false, true]) {
      for (const member of [fakeMember(), fakeMember({ roleIds: ["verified-role"] }), null]) {
        const { guild, honeypot, logging, guildService, run } = setup({ row: { honeypotAction: "kick" } });
        guild.members.fetch.mockRejectedValue(serverError(503));
        if (shuttingDown) void honeypot.drain(5_000);

        await expect(run(fakeMessage(guild, { member }))).resolves.toBe("handled");

        expect(guildService.getSettingsFresh).toHaveBeenCalledTimes(1);
        expect(guildService.getSettingsFresh).toHaveBeenCalledWith("g1");
        // Each one reached its log entry on that one read.
        expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("logs only when deleted messages are logged, but always sends notices", async () => {
    const { guild, logging, run } = setup({ row: { honeypotAction: "ban" } });
    logging.shouldLog.mockResolvedValue(false);
    guild.members.ban.mockRejectedValue(missingPermissions());

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");
    await expect(run(fakeMessage(guild, { id: "222", authorId: "u2", member: fakeMember({ roleIds: ["verified-role"] }) }))).resolves.toBe("handled");

    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "message_delete");
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    // The failed ban is still reported.
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
  });

  it("still sends the stuck-ban notice when the log entry fails", async () => {
    const { guild, logging, logger, run } = setup({ row: { honeypotAction: "kick" } });
    guild.bans.remove.mockRejectedValue(serverError(500));
    logging.sendLogEmbed.mockRejectedValue(new Error("log channel unreachable"));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    expect(guild.bans.remove).toHaveBeenCalledTimes(2);
    expect(logging.sendNotice).toHaveBeenCalledTimes(1);
    expect(notices(logging)[0]).toContain("still banned");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Couldn't send the honeypot log entry",
    );
  });

  it("logs a case that went wrong at warn level, and any other case at info", async () => {
    const cases: {
      prepare: (guild: FakeGuild) => void;
      action: "kick" | "ban";
      /** The case's outcome. */
      kind: string;
      level: "warn" | "info";
    }[] = [
      { prepare: () => {}, action: "kick", kind: "removed", level: "info" },
      {
        prepare: (guild) => guild.bans.fetch.mockResolvedValue({ user: { id: "u1" } }),
        action: "kick",
        kind: "already_banned",
        level: "info",
      },
      {
        prepare: (guild) => guild.members.ban.mockRejectedValue(missingPermissions()),
        action: "ban",
        kind: "failed",
        level: "warn",
      },
      {
        prepare: (guild) => {
          guild.members.ban.mockRejectedValue(serverError(503));
          guild.bans.fetch.mockRejectedValueOnce(unknownBan()).mockRejectedValueOnce(serverError(503));
        },
        action: "kick",
        kind: "unconfirmed",
        level: "warn",
      },
      {
        prepare: (guild) => guild.bans.remove.mockRejectedValue(serverError(500)),
        action: "kick",
        kind: "still_banned",
        level: "warn",
      },
    ];
    for (const { prepare, action, kind, level } of cases) {
      const { guild, logger, run } = setup({ row: { honeypotAction: action } });
      prepare(guild);

      await expect(run(fakeMessage(guild))).resolves.toBe("handled");

      // Without a log channel, this line is the only trace of a kicked account left banned.
      expect(logger[level]).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "g1", userId: "u1", outcome: expect.objectContaining({ kind }) }),
        "Honeypot case handled",
      );
      const otherLevel = level === "warn" ? "info" : "warn";
      expect(logger[otherLevel]).not.toHaveBeenCalledWith(expect.anything(), "Honeypot case handled");
    }
  });

  it("marks the trigger as its own deletion and treats Unknown Message on delete as fine", async () => {
    const { guild, honeypot, logging, logger, run } = setup({ row: { honeypotAction: "ban" } });
    const markOwnDeletion = vi.spyOn(honeypot, "markOwnDeletion");
    // The ban's cleanup can delete the trigger first.
    const message = fakeMessage(guild, { deleteError: unknownMessage() });

    await expect(run(message)).resolves.toBe("handled");

    expect(markOwnDeletion).toHaveBeenCalledWith("111");
    expect(markOwnDeletion.mock.invocationCallOrder[0]).toBeLessThan(message.delete.mock.invocationCallOrder[0]);
    expect(markOwnDeletion.mock.invocationCallOrder[0]).toBeLessThan(guild.members.ban.mock.invocationCallOrder[0]);
    expect(honeypot.consumeOwnDeletion("111")).toBe(true);
    expect(guild.members.ban).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    // The message is gone, so there's nothing to report, and the entry reads as for any delete.
    expect(logging.sendNotice).not.toHaveBeenCalled();
    expect(logEntries(logging).map((entry) => entry.title)).toEqual(["Message Deleted (Honeypot)"]);
  });

  it("reports a message it couldn't delete, whatever the log toggles", async () => {
    const posts = [
      // A verified member's post, where the delete is the honeypot's only protection. The server requires 2FA for
      // moderation and its owner has none, so Discord refuses the delete.
      {
        member: fakeMember({ roleIds: ["verified-role"] }),
        deleteError: twoFactorRequired(),
        bans: 0,
        logged: "Couldn't delete the message. Nobody was removed (verified member).",
        notice: "Couldn't delete the message: Two factor is required for this operation. Delete it by hand if it's still there.",
      },
      // An ordinary member's post, where a channel overwrite takes away Manage Messages but the ban still works. The
      // text says nothing about the message: the ban's cleanup usually takes it.
      {
        member: fakeMember(),
        deleteError: missingPermissions(),
        bans: 1,
        logged: "Banned. Their messages from the last hour were cleaned up.",
        notice: "Couldn't delete the message: Missing Permissions. Delete it by hand if it's still there.",
      },
    ];
    for (const { member, deleteError, bans, logged, notice } of posts) {
      for (const logsDeletes of [true, false]) {
        const { guild, logging, run } = setup({ row: { honeypotAction: "ban" } });
        logging.shouldLog.mockResolvedValue(logsDeletes);
        const message = fakeMessage(guild, { member, deleteError });

        await expect(run(message)).resolves.toBe("handled");

        expect(message.delete).toHaveBeenCalledTimes(1);
        expect(guild.members.ban).toHaveBeenCalledTimes(bans);
        // The log entry never claims the delete, and the notice tells a moderator the message may still be up.
        const titles = logEntries(logging).map((entry) => entry.title);
        expect(titles).toEqual(logsDeletes ? ["Honeypot Message (Delete Failed)"] : []);
        expect(loggedActions(logging)).toEqual(logsDeletes ? [logged] : []);
        expect(notices(logging)).toEqual([`<@u1> (u1) posted in the honeypot <#trap>. ${notice}`]);
      }
    }
  });

  it("reports a trigger it couldn't delete after the case's own notice", async () => {
    const cases: {
      prepare: (guild: FakeGuild) => void;
      member?: FakeMember | null;
      action: "kick" | "ban";
      /** The Honeypot Action field. */
      logged: string;
      /** The notices the case sends before the delete failure notice. */
      caseNotices: string[];
    }[] = [
      // Membership unknown, so nobody is removed.
      {
        prepare: (guild) => guild.members.fetch.mockRejectedValue(serverError(503)),
        member: null,
        action: "ban",
        logged: "Couldn't delete the message. Couldn't check membership, so nobody was removed.",
        caseNotices: ["Couldn't delete the message. Couldn't check membership (Service Unavailable), so nobody was removed."],
      },
      // The ban is refused.
      {
        prepare: (guild) => guild.members.ban.mockRejectedValue(missingPermissions()),
        action: "ban",
        logged: "Removal failed: Missing Permissions. Couldn't delete the message.",
        caseNotices: ["Removal failed: Missing Permissions. Couldn't delete the message."],
      },
      // Already banned, so neither a ban nor its cleanup follows.
      {
        prepare: (guild) => guild.bans.fetch.mockResolvedValue({ user: { id: "u1" } }),
        action: "kick",
        logged: "Already banned. Couldn't delete the message.",
        caseNotices: [],
      },
      // The texts that say nothing about the message stay as they are. Kicked: the ban's cleanup usually takes the
      // message, but it can miss the newest one.
      {
        prepare: () => {},
        action: "kick",
        logged: "Kicked. Their messages from the last hour were cleaned up.",
        caseNotices: [],
      },
      // Nobody can tell whether the ban happened.
      {
        prepare: (guild) => {
          guild.members.ban.mockRejectedValue(serverError(503));
          guild.bans.fetch.mockRejectedValueOnce(unknownBan()).mockRejectedValueOnce(serverError(503));
        },
        action: "kick",
        logged: "Removal unconfirmed: Service Unavailable. Check the ban list.",
        caseNotices: ["Removal unconfirmed: Service Unavailable. Check the ban list."],
      },
      // Kicked, but left banned.
      {
        prepare: (guild) => guild.bans.remove.mockRejectedValue(serverError(500)),
        action: "kick",
        logged: "Kicked, but the unban failed: Internal Server Error. They are still banned and need a manual unban.",
        caseNotices: ["Kicked, but the unban failed: Internal Server Error. They are still banned and need a manual unban."],
      },
    ];
    for (const { prepare, member, action, logged, caseNotices } of cases) {
      const { guild, logging, run } = setup({ row: { honeypotAction: action } });
      prepare(guild);
      const message = fakeMessage(guild, { member, deleteError: missingPermissions() });

      await expect(run(message)).resolves.toBe("handled");

      expect(logEntries(logging).map((entry) => entry.title)).toEqual(["Honeypot Message (Delete Failed)"]);
      expect(loggedActions(logging)).toEqual([logged]);
      // The delete failure notice comes last, and it is the only one that carries the delete's reason.
      const deleteNotice = "Couldn't delete the message: Missing Permissions. Delete it by hand if it's still there.";
      expect(notices(logging)).toEqual(
        [...caseNotices, deleteNotice].map((text) => `<@u1> (u1) posted in the honeypot <#trap>. ${text}`),
      );
    }
  });

  it("cuts a long delete failure reason to 200 characters", async () => {
    const { guild, logging, run } = setup();
    const message = fakeMessage(guild, {
      member: fakeMember({ roleIds: ["verified-role"] }),
      deleteError: apiError(RESTJSONErrorCodes.MissingPermissions, "x".repeat(2_000), 403),
    });

    await expect(run(message)).resolves.toBe("handled");

    expect(notices(logging)).toEqual([
      `<@u1> (u1) posted in the honeypot <#trap>. Couldn't delete the message: ${"x".repeat(200)}. Delete it by hand if it's still there.`,
    ]);
  });

  it("keeps the shutdown drain waiting for the delete failure notice", async () => {
    const { guild, honeypot, logging, run } = setup({ row: { honeypotAction: "kick" } });
    const slowNotice = deferred();
    logging.sendNotice.mockReturnValueOnce(slowNotice.promise);

    const handled = run(fakeMessage(guild, { deleteError: missingPermissions() }));
    await vi.waitFor(() => expect(logging.sendNotice).toHaveBeenCalledTimes(1));
    let drained = false;
    const drain = honeypot.drain(5_000).then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(drained).toBe(false);
    slowNotice.resolve();
    await drain;
    expect(drained).toBe(true);
    await expect(handled).resolves.toBe("handled");
  });

  it("sends no notice when a same-case message's delete fails", async () => {
    // First the trigger is deleted and only its follower's delete fails; then both deletes fail.
    for (const triggerDeleteError of [undefined, missingPermissions()]) {
      const { guild, ctx, row, logging, logger } = setup({ row: { honeypotAction: "kick" } });
      // The ban waits behind rate limits for two seconds, so the follower arrives while the case runs.
      guild.members.ban.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("u1"), 2_000)));
      const trigger = fakeMessage(guild, { id: "111", deleteError: triggerDeleteError });
      const follower = fakeMessage(guild, { id: "112", deleteError: missingPermissions() });

      const burst = Promise.all([
        handleHoneypotMessage(asMessage(trigger), row, ctx),
        handleHoneypotMessage(asMessage(follower), row, ctx),
      ]);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(burst).resolves.toEqual(["handled", "handled"]);

      expect(follower.delete).toHaveBeenCalledTimes(1);
      expect(guild.members.ban).toHaveBeenCalledTimes(1);
      expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
      // Only pino hears about the follower. A notice per message would flood the log channel during a burst.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "112" }),
        "Couldn't delete a honeypot message",
      );
      const triggerNotice =
        "<@u1> (u1) posted in the honeypot <#trap>. Couldn't delete the message: Missing Permissions. " +
        "Delete it by hand if it's still there.";
      expect(notices(logging)).toEqual(triggerDeleteError ? [triggerNotice] : []);
    }
  });

  it("schedules the sweep 15 seconds after a removal", async () => {
    const { guild, run } = setup({ row: { honeypotAction: "ban" } });
    const leftover = cachedMessage("left-1", "u1", T0 - 60_000);
    guild.channels.cache.set("general", fakeTextChannel("general", [leftover]));

    await expect(run(fakeMessage(guild))).resolves.toBe("handled");

    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS - 1);
    expect(leftover.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(leftover.delete).toHaveBeenCalledTimes(1);
  });

  it("schedules the sweep straight after the ban, before a slow unban finishes", async () => {
    const { guild, run } = setup({ row: { honeypotAction: "kick" } });
    const leftover = cachedMessage("left-1", "u1", T0 - 60_000);
    guild.channels.cache.set("general", fakeTextChannel("general", [leftover]));
    // The unban waits behind rate limits for a minute.
    guild.bans.remove.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 60_000)));

    const handled = run(fakeMessage(guild));
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);

    // The sweep counts from the ban, so a slow unban can't push it past the action record.
    expect(guild.bans.remove).toHaveBeenCalledTimes(1);
    expect(leftover.delete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(handled).resolves.toBe("handled");
  });
});

describe("deleteLateMessage", () => {
  it("deletes late messages from a removed account for two minutes", async () => {
    const { guild, honeypot, ctx, run } = setup({ row: { honeypotAction: "ban" } });
    await run(fakeMessage(guild));

    const late = fakeMessage(guild, { id: "222", channelId: "general" });
    await expect(deleteLateMessage(asMessage(late), ctx)).resolves.toBe(true);
    expect(late.delete).toHaveBeenCalledTimes(1);
    expect(honeypot.consumeOwnDeletion("222")).toBe(true);

    // A failed delete is ignored.
    const undeletable = fakeMessage(guild, { id: "223", channelId: "general", deleteError: missingPermissions() });
    await expect(deleteLateMessage(asMessage(undeletable), ctx)).resolves.toBe(true);

    // Other accounts are left alone.
    const other = fakeMessage(guild, { id: "333", channelId: "general", authorId: "u2" });
    await expect(deleteLateMessage(asMessage(other), ctx)).resolves.toBe(false);
    expect(other.delete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LATE_MESSAGE_WINDOW_MS + 1);
    const later = fakeMessage(guild, { id: "444", channelId: "general" });
    await expect(deleteLateMessage(asMessage(later), ctx)).resolves.toBe(false);
    expect(later.delete).not.toHaveBeenCalled();
  });
});

describe("sweepCachedMessages", () => {
  it("sweeps the account's cached messages from the last hour in every channel", async () => {
    const since = T0 - HOUR_MS;
    const recent = [cachedMessage("r1", "u1", T0 - 1_000), cachedMessage("r2", "u1", since), cachedMessage("r3", "u1", T0 - 2_000)];
    const old = cachedMessage("old", "u1", since - 1);
    const someoneElse = cachedMessage("o1", "u2", T0 - 1_000);
    const partial = cachedMessage("p1", null, T0 - 1_000);
    const general = fakeTextChannel("general", [recent[0], old, someoneElse, partial, recent[1]]);
    const thread = fakeTextChannel("thread-1", [recent[2]]);
    // A forum holds threads, not messages.
    const forum = { id: "forum", isTextBased: () => false };
    const logger = { warn: vi.fn() };

    const count = await sweepCachedMessages(
      sweepGuild({ general, "thread-1": thread, forum }),
      "u1",
      since,
      logger as unknown as Logger,
    );

    expect(count).toBe(3);
    expect(general.bulkDelete).toHaveBeenCalledWith(["r1", "r2"], true);
    expect(thread.bulkDelete).not.toHaveBeenCalled();
    expect(recent[2].delete).toHaveBeenCalledTimes(1);
    for (const untouched of [old, someoneElse, partial]) expect(untouched.delete).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("deletes more than 100 cached messages in chunks", async () => {
    const messages = Array.from({ length: 101 }, (_, i) => cachedMessage(`m${i}`, "u1", T0 - i));
    const general = fakeTextChannel("general", messages);

    const count = await sweepCachedMessages(sweepGuild({ general }), "u1", T0 - HOUR_MS, { warn: vi.fn() } as unknown as Logger);

    expect(count).toBe(101);
    expect(general.bulkDelete).toHaveBeenCalledTimes(1);
    expect(general.bulkDelete).toHaveBeenCalledWith(
      messages.slice(0, 100).map((message) => message.id),
      true,
    );
    expect(messages[100].delete).toHaveBeenCalledTimes(1);
  });

  it("carries on past a failed delete and counts only what it deleted", async () => {
    const failing = fakeTextChannel("general", [cachedMessage("a1", "u1", T0), cachedMessage("a2", "u1", T0)], {
      bulkDeleteError: missingPermissions(),
    });
    const kept = cachedMessage("b1", "u1", T0);
    const working = fakeTextChannel("memes", [kept]);
    const logger = { warn: vi.fn() };

    const count = await sweepCachedMessages(sweepGuild({ general: failing, memes: working }), "u1", T0 - HOUR_MS, logger as unknown as Logger);

    expect(count).toBe(1);
    expect(kept.delete).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
