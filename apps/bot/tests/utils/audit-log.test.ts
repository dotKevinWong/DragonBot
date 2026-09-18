import { describe, it, expect, vi } from "vitest";
import { AuditLogEvent, Collection, type Guild, type GuildBan } from "discord.js";
import { findRecentAuditLogEntry, resolveBanReason } from "../../src/utils/audit-log.js";

interface FakeEntry {
  id: string;
  targetId: string;
  reason: string | null;
  createdTimestamp: number;
}

function entry(targetId: string, reason: string | null, ageMs = 1000): FakeEntry {
  return { id: `entry-${targetId}-${ageMs}`, targetId, reason, createdTimestamp: Date.now() - ageMs };
}

function fakeGuild(entries: FakeEntry[]) {
  const fetchAuditLogs = vi.fn().mockResolvedValue({
    entries: new Collection(entries.map((e) => [e.id, e])),
  });
  return { guild: { fetchAuditLogs } as unknown as Guild, fetchAuditLogs };
}

function failingGuild() {
  const fetchAuditLogs = vi.fn().mockRejectedValue(new Error("Missing Permissions"));
  return { guild: { fetchAuditLogs } as unknown as Guild, fetchAuditLogs };
}

describe("findRecentAuditLogEntry", () => {
  it("returns the recent entry for the target", async () => {
    const { guild, fetchAuditLogs } = fakeGuild([entry("user-1", "spamming")]);

    const result = await findRecentAuditLogEntry(guild, AuditLogEvent.MemberKick, "user-1");

    expect(result?.reason).toBe("spamming");
    expect(fetchAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ type: AuditLogEvent.MemberKick }));
  });

  it("finds the target even when another action was logged more recently", async () => {
    const { guild } = fakeGuild([entry("user-2", "other", 500), entry("user-1", "spamming", 1500)]);

    const result = await findRecentAuditLogEntry(guild, AuditLogEvent.MemberKick, "user-1");

    expect(result?.reason).toBe("spamming");
  });

  it("ignores entries for other users", async () => {
    const { guild } = fakeGuild([entry("user-2", "other")]);

    expect(await findRecentAuditLogEntry(guild, AuditLogEvent.MemberKick, "user-1")).toBeNull();
  });

  it("ignores stale entries from an earlier action", async () => {
    const { guild } = fakeGuild([entry("user-1", "old kick", 60_000)]);

    expect(await findRecentAuditLogEntry(guild, AuditLogEvent.MemberKick, "user-1")).toBeNull();
  });

  it("returns null when the audit log can't be read", async () => {
    const { guild } = failingGuild();

    expect(await findRecentAuditLogEntry(guild, AuditLogEvent.MemberKick, "user-1")).toBeNull();
  });
});

describe("resolveBanReason", () => {
  function fakeBan(guild: Guild, fetchBan: () => Promise<unknown>, cachedReason?: string) {
    const fetch = vi.fn(fetchBan);
    const ban = {
      guild: Object.assign(guild, { bans: { fetch } }),
      user: { id: "user-1" },
      ...(cachedReason !== undefined ? { reason: cachedReason } : {}),
    } as unknown as GuildBan;
    return { ban, fetch };
  }

  it("fetches the ban to get the reason the gateway event omits", async () => {
    const { guild } = fakeGuild([]);
    const { ban, fetch } = fakeBan(guild, async () => ({ reason: "raiding" }));

    expect(await resolveBanReason(ban)).toBe("raiding");
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ force: true, cache: false }));
  });

  it("ignores a stale reason left in the cache by an earlier ban", async () => {
    const { guild } = fakeGuild([]);
    const { ban } = fakeBan(guild, async () => ({ reason: "new reason" }), "old reason");

    expect(await resolveBanReason(ban)).toBe("new reason");
  });

  it("returns null when the ban genuinely has no reason", async () => {
    const { guild, fetchAuditLogs } = fakeGuild([]);
    const { ban } = fakeBan(guild, async () => ({ reason: null }));

    expect(await resolveBanReason(ban)).toBeNull();
    expect(fetchAuditLogs).not.toHaveBeenCalled();
  });

  it("falls back to the audit log when the ban can't be fetched", async () => {
    const { guild } = fakeGuild([entry("user-1", "softban")]);
    const { ban } = fakeBan(guild, () => Promise.reject(new Error("Unknown Ban")));

    expect(await resolveBanReason(ban)).toBe("softban");
  });

  it("returns null when neither source is available", async () => {
    const { guild } = failingGuild();
    const { ban } = fakeBan(guild, () => Promise.reject(new Error("Missing Permissions")));

    expect(await resolveBanReason(ban)).toBeNull();
  });

  it("treats a blank reason as no reason", async () => {
    const { guild } = fakeGuild([]);
    const { ban } = fakeBan(guild, async () => ({ reason: "   " }));

    expect(await resolveBanReason(ban)).toBeNull();
  });
});
