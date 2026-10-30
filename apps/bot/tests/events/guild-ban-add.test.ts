import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbedBuilder, GuildBan } from "discord.js";
import event from "../../src/events/guild-ban-add.js";
import { HoneypotService, RECORD_TTL_MS, type ActionRecord } from "../../src/services/honeypot.service.js";
import type { BotContext } from "../../src/types/context.js";

const kickRecord: ActionRecord = { action: "kick", reason: "[Honeypot kick] posted in #trap (msg 111)", channelId: "trap" };
const banRecord: ActionRecord = { action: "ban", reason: "[Honeypot] posted in #trap (msg 111)", channelId: "trap" };

/** What a honeypot removal leaves behind once its ban call resolves: a confirmed action record for the account. */
function recordRemoval(honeypot: HoneypotService, record: ActionRecord, userId = "u1") {
  const started = honeypot.beginCase("g1", userId, Date.now());
  if (started.kind !== "start") throw new Error("expected a new case");
  honeypot.recordAction("g1", userId, started.caseId, record);
  honeypot.confirmAction("g1", userId, started.caseId);
}

/**
 * u1 has just been banned from g1, and Discord returns the ban with `fetchedReason` (none unless the test gives one).
 * The honeypot is the real in-memory service. The user records, the log sink, ban sync and Discord are fakes.
 */
function setup(options: { fetchedReason?: string; shouldLog?: boolean } = {}) {
  const fetchBan = vi.fn(async (_options: unknown) => ({ reason: options.fetchedReason ?? null }));
  const ban = {
    guild: { id: "g1", bans: { fetch: fetchBan } },
    user: { id: "u1", tag: "u1#0001", displayAvatarURL: () => "https://cdn.example/u1.png" },
    client: { name: "fake client" },
  } as unknown as GuildBan;
  const honeypot = new HoneypotService();
  const user = { markBanned: vi.fn(async (_userId: string, _guildId: string): Promise<unknown> => undefined) };
  const logging = {
    shouldLog: vi.fn(async (_guildId: string, _event: string) => options.shouldLog ?? true),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
  const moderation = {
    syncBan: vi.fn(async (_userId: string, _guildId: string, _client: unknown, _logger: unknown) => 1),
  };
  const logger = { child: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })) };
  const ctx = { logger, services: { honeypot, user, logging, moderation } } as unknown as BotContext;
  return { ban, fetchBan, honeypot, user, logging, moderation, ctx };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("guildBanAdd event", () => {
  it("does nothing for a honeypot kick's ban", async () => {
    // A honeypot kick bans only to clean up the account's messages, and unbans straight away.
    const { ban, fetchBan, honeypot, user, logging, moderation, ctx } = setup();
    recordRemoval(honeypot, kickRecord);

    await event.execute(ban, ctx);

    expect(user.markBanned).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    expect(moderation.syncBan).not.toHaveBeenCalled();
    expect(fetchBan).not.toHaveBeenCalled();
  });

  it("logs a honeypot ban with the honeypot reason and never syncs it", async () => {
    // Discord returns this ban with no reason, so the logged one can only come from the record.
    const { ban, fetchBan, honeypot, user, logging, moderation, ctx } = setup();
    recordRemoval(honeypot, banRecord);

    await event.execute(ban, ctx);

    expect(user.markBanned).toHaveBeenCalledWith("u1", "g1");
    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "ban");
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
    expect(logging.sendLogEmbed.mock.calls[0][1].toJSON().title).toBe("Member Banned");
    expect(logging.sendLogEmbed.mock.calls[0][1].toJSON().fields).toContainEqual(
      expect.objectContaining({ name: "Reason", value: "[Honeypot] posted in #trap (msg 111)" }),
    );
    expect(moderation.syncBan).not.toHaveBeenCalled();
    expect(fetchBan).not.toHaveBeenCalled();
  });

  it("does not sync a ban whose reason carries the honeypot marker even without a record", async () => {
    // For example a honeypot kick's ban whose record is gone. Servers that don't log bans are covered too.
    for (const shouldLog of [true, false]) {
      const { ban, fetchBan, logging, moderation, ctx } = setup({
        fetchedReason: "[Honeypot kick] posted in #trap (msg 111)",
        shouldLog,
      });

      await event.execute(ban, ctx);

      expect(moderation.syncBan).not.toHaveBeenCalled();
      // One read serves both the log and the check.
      expect(fetchBan).toHaveBeenCalledTimes(1);
      expect(logging.sendLogEmbed).toHaveBeenCalledTimes(shouldLog ? 1 : 0);
    }
  });

  it("syncs ordinary bans as before", async () => {
    const { ban, honeypot, user, logging, moderation, ctx } = setup({ fetchedReason: "spam" });
    // The honeypot has just banned another account in this server, but not this one.
    recordRemoval(honeypot, banRecord, "other-account");

    await event.execute(ban, ctx);

    expect(user.markBanned).toHaveBeenCalledWith("u1", "g1");
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
    expect(logging.sendLogEmbed.mock.calls[0][1].toJSON().fields).toContainEqual(
      expect.objectContaining({ name: "Reason", value: "spam" }),
    );
    expect(moderation.syncBan).toHaveBeenCalledTimes(1);
    expect(moderation.syncBan).toHaveBeenCalledWith("u1", "g1", ban.client, ctx.logger);
  });

  it("reads the record before any await", async () => {
    vi.useFakeTimers();
    // Discord returns this ban with no reason, so only the record keeps it out of ban sync.
    const { ban, honeypot, user, logging, moderation, ctx } = setup();
    recordRemoval(honeypot, banRecord);
    const write = deferred();
    user.markBanned.mockReturnValueOnce(write.promise);

    const handled = event.execute(ban, ctx);
    expect(user.markBanned).toHaveBeenCalled();
    // The database write is slow, and the record expires while it waits.
    vi.advanceTimersByTime(RECORD_TTL_MS + 1);
    expect(honeypot.wasRecentlyActioned("g1", "u1")).toBe(false);
    write.resolve();
    await handled;

    expect(moderation.syncBan).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed.mock.calls[0][1].toJSON().fields).toContainEqual(
      expect.objectContaining({ name: "Reason", value: "[Honeypot] posted in #trap (msg 111)" }),
    );
  });
});
