import { describe, expect, it, vi } from "vitest";
import { Collection, type EmbedBuilder, type GuildMember } from "discord.js";
import event from "../../src/events/guild-member-remove.js";
import { HoneypotService, type ActionRecord } from "../../src/services/honeypot.service.js";
import type { BotContext } from "../../src/types/context.js";

const kickRecord: ActionRecord = { action: "kick", reason: "[Honeypot kick] posted in #trap (msg 111)", channelId: "trap" };
const banRecord: ActionRecord = { action: "ban", reason: "[Honeypot] posted in #trap (msg 111)", channelId: "trap" };

interface FakeAuditEntry {
  id: string;
  targetId: string;
  executor: { id: string; tag: string };
  reason: string | null;
  createdTimestamp: number;
}

/** What a honeypot removal leaves behind once its ban call resolves: a confirmed action record for the account. */
function recordRemoval(honeypot: HoneypotService, record: ActionRecord, userId = "u1") {
  const started = honeypot.beginCase("g1", userId, Date.now());
  if (started.kind !== "start") throw new Error("expected a new case");
  honeypot.recordAction("g1", userId, started.caseId, record);
  honeypot.confirmAction("g1", userId, started.caseId);
}

/**
 * u1 has just left g1, whose audit log holds `kickEntries`. DragonBot is bot-self.
 * The honeypot is the real in-memory service. The log sink and Discord are fakes.
 */
function setup(kickEntries: FakeAuditEntry[] = []) {
  const fetchAuditLogs = vi.fn(async (_options: unknown) => ({
    entries: new Collection(kickEntries.map((entry): [string, FakeAuditEntry] => [entry.id, entry])),
  }));
  const member = {
    id: "u1",
    guild: { id: "g1", fetchAuditLogs },
    user: { tag: "u1#0001", displayAvatarURL: () => "https://cdn.example/u1.png" },
    client: { user: { id: "bot-self", tag: "DragonBot#0001" } },
  } as unknown as GuildMember;
  const honeypot = new HoneypotService();
  const logging = {
    shouldLog: vi.fn(async (_guildId: string, _event: string) => true),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
  const logger = { child: vi.fn(() => ({})) };
  const ctx = { logger, services: { honeypot, logging } } as unknown as BotContext;
  return { member, fetchAuditLogs, honeypot, logging, ctx };
}

type FakeLogging = ReturnType<typeof setup>["logging"];

/** Each log entry sent, in order. */
function logEntries(logging: FakeLogging) {
  return logging.sendLogEmbed.mock.calls.map(([, embed]) => embed.toJSON());
}

describe("guildMemberRemove event", () => {
  it("logs a honeypot kick as kicked by DragonBot without checking the audit log", async () => {
    // The kick was a ban and an unban, so the audit log holds no kick to find.
    const { member, fetchAuditLogs, honeypot, logging, ctx } = setup();
    recordRemoval(honeypot, kickRecord);

    await event.execute(member, ctx);

    expect(fetchAuditLogs).not.toHaveBeenCalled();
    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "member_leave");
    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "kick");
    const entries = logEntries(logging);
    expect(entries.map((entry) => entry.title)).toEqual(["Member Kicked", "Kick"]);
    for (const entry of entries) {
      expect(entry.fields).toContainEqual(
        expect.objectContaining({ name: "Kicked by", value: "<@bot-self> (DragonBot#0001)" }),
      );
      expect(entry.fields).toContainEqual(
        expect.objectContaining({ name: "Reason", value: "[Honeypot kick] posted in #trap (msg 111)" }),
      );
    }
  });

  it("writes no Member Left entry for a honeypot ban", async () => {
    // The honeypot's own entry and "Member Banned" already tell the story.
    const { member, fetchAuditLogs, honeypot, logging, ctx } = setup();
    recordRemoval(honeypot, banRecord);

    await event.execute(member, ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    expect(fetchAuditLogs).not.toHaveBeenCalled();
  });

  it("logs ordinary leaves and kicks as before", async () => {
    // In both, the honeypot has just kicked another account in this server, but not this one.
    // Leaving on their own: the audit log holds no kick.
    const left = setup();
    recordRemoval(left.honeypot, kickRecord, "other-account");

    await event.execute(left.member, left.ctx);

    expect(left.fetchAuditLogs).toHaveBeenCalledTimes(1);
    const leftEntries = logEntries(left.logging);
    expect(leftEntries.map((entry) => entry.title)).toEqual(["Member Left"]);
    expect(leftEntries[0].fields).not.toContainEqual(expect.objectContaining({ name: "Kicked by" }));

    // Kicked by a moderator, as the audit log shows.
    const kicked = setup([
      {
        id: "entry-1",
        targetId: "u1",
        executor: { id: "mod-1", tag: "mod#0001" },
        reason: "spamming",
        createdTimestamp: Date.now() - 1_000,
      },
    ]);
    recordRemoval(kicked.honeypot, kickRecord, "other-account");

    await event.execute(kicked.member, kicked.ctx);

    expect(kicked.fetchAuditLogs).toHaveBeenCalledTimes(1);
    const kickedEntries = logEntries(kicked.logging);
    expect(kickedEntries.map((entry) => entry.title)).toEqual(["Member Kicked", "Kick"]);
    for (const entry of kickedEntries) {
      expect(entry.fields).toContainEqual(expect.objectContaining({ name: "Kicked by", value: "<@mod-1> (mod#0001)" }));
      expect(entry.fields).toContainEqual(expect.objectContaining({ name: "Reason", value: "spamming" }));
    }
  });
});
