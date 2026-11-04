import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { XpService } from "../../src/services/xp.service.js";
import type { XpRepository, XpRow } from "../../src/repositories/xp.repository.js";

/**
 * Characterization tests for the XP read paths (getRank, getLeaderboard, getGuildSnapshot), the resets and
 * getStats. They pin the results, including the order of users tied on XP, so the per-guild index can't change them.
 */

const settings = {
  xpMin: 15,
  xpMax: 15,
  xpCooldownSeconds: 0,
  xpExcludedChannelIds: [] as string[],
  xpExcludedRoleIds: [] as string[],
};

function row(guildId: string, discordId: string, totalXp: number, extra: Partial<XpRow> = {}): XpRow {
  return {
    guildId,
    discordId,
    totalXp,
    level: Math.floor(totalXp / 100),
    messageCount: totalXp,
    xpMessageCount: Math.floor(totalXp / 2),
    lastMessageAt: null,
    ...extra,
  };
}

async function setup(rows: XpRow[] = []) {
  const repo = {
    findAll: vi.fn().mockResolvedValue(rows),
    batchUpsert: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new XpService(repo as unknown as XpRepository, logger as unknown as Logger);
  await service.hydrate();
  return { service, repo, logger };
}

/** A small seeded generator, so the randomized dataset is the same on every run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("XpService.getLeaderboard", () => {
  it("orders by XP descending, numbers ranks from 1, defaults to 10 and honours the limit", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row("g1", `u${i}`, i * 10));
    const { service } = await setup(rows);

    const top = service.getLeaderboard("g1");
    expect(top).toHaveLength(10);
    expect(top.map((e) => e.discordId)).toEqual(["u11", "u10", "u9", "u8", "u7", "u6", "u5", "u4", "u3", "u2"]);
    expect(top.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(service.getLeaderboard("g1", 3).map((e) => e.discordId)).toEqual(["u11", "u10", "u9"]);
    expect(service.getLeaderboard("g1", 9999)).toHaveLength(12);
    expect(service.getLeaderboard("g1", 0)).toEqual([]);
  });

  it("returns exactly the documented fields", async () => {
    const { service } = await setup([row("g1", "u1", 250, { messageCount: 40, xpMessageCount: 20, level: 2 })]);
    expect(service.getLeaderboard("g1")).toEqual([
      { discordId: "u1", totalXp: 250, level: 2, messageCount: 40, xpMessageCount: 20, rank: 1 },
    ]);
  });

  it("returns [] for an empty or unknown guild", async () => {
    const { service } = await setup([row("g1", "u1", 5)]);
    expect(service.getLeaderboard("g2")).toEqual([]);
  });

  it("keeps other guilds out, including a guild whose id starts with this one's", async () => {
    const { service } = await setup([
      row("g1", "a", 10),
      row("g10", "b", 999),
      row("g2", "c", 500),
      row("g1", "d", 20),
      row("1", "e", 1),
    ]);
    expect(service.getLeaderboard("g1").map((e) => e.discordId)).toEqual(["d", "a"]);
    expect(service.getLeaderboard("g10").map((e) => e.discordId)).toEqual(["b"]);
    expect(service.getLeaderboard("g").map((e) => e.discordId)).toEqual([]);
  });

  it("keeps hydrate order for tied users, then first-message order for new ones", async () => {
    const { service } = await setup([
      row("g1", "t2", 100),
      row("g2", "x", 100),
      row("g1", "t1", 100),
      row("g1", "t3", 100),
      row("g1", "low", 15),
    ]);
    // Two new users each earn 15 XP, tying with "low"
    service.processMessage("g1", "n2", settings);
    service.processMessage("g1", "n1", settings);

    expect(service.getLeaderboard("g1", 100).map((e) => [e.discordId, e.rank])).toEqual([
      ["t2", 1],
      ["t1", 2],
      ["t3", 3],
      ["low", 4],
      ["n2", 5],
      ["n1", 6],
    ]);
  });

  it("keeps a restored user's position when rehydrateGuild overwrites them, and appends new ones", async () => {
    const { service } = await setup([row("g1", "a", 50), row("g1", "b", 50), row("g1", "c", 50)]);
    service.rehydrateGuild("g1", [
      { discordId: "new", totalXp: 50, level: 0, messageCount: 1, xpMessageCount: 1, lastMessageAt: 0 },
      { discordId: "a", totalXp: 50, level: 0, messageCount: 1, xpMessageCount: 1, lastMessageAt: 0 },
    ]);
    expect(service.getLeaderboard("g1", 100).map((e) => e.discordId)).toEqual(["a", "b", "c", "new"]);
    expect(service.getRank("g1", "a")!.rank).toBe(1);
    expect(service.getRank("g1", "new")).toMatchObject({ rank: 4, totalUsers: 4 });
  });

  it("includes zero-XP users after a reset", async () => {
    const { service } = await setup([row("g1", "a", 300), row("g1", "b", 200)]);
    service.resetUser("g1", "a");
    expect(service.getLeaderboard("g1").map((e) => [e.discordId, e.totalXp])).toEqual([
      ["b", 200],
      ["a", 0],
    ]);
  });

  it("returns copies: changing a returned entry doesn't change the service", async () => {
    const { service } = await setup([row("g1", "a", 300)]);
    const [entry] = service.getLeaderboard("g1");
    entry!.totalXp = 1;
    expect(service.getLeaderboard("g1")[0]!.totalXp).toBe(300);
    expect(service.getRank("g1", "a")!.totalXp).toBe(300);
  });
});

describe("XpService.getRank", () => {
  it("returns null for an unknown user or guild", async () => {
    const { service } = await setup([row("g1", "a", 10)]);
    expect(service.getRank("g1", "nobody")).toBeNull();
    expect(service.getRank("g2", "a")).toBeNull();
  });

  it("returns the full rank info", async () => {
    const { service } = await setup([
      row("g1", "a", 300, { level: 1, messageCount: 33, xpMessageCount: 22 }),
      row("g1", "b", 400),
      row("g2", "c", 1000),
    ]);
    // Level 1 starts at 155 XP, and level 2 needs 20 + 100 + 100 = 220 more
    expect(service.getRank("g1", "a")).toEqual({
      totalXp: 300,
      level: 1,
      rank: 2,
      totalUsers: 2,
      messageCount: 33,
      xpMessageCount: 22,
      currentLevelXp: 145,
      requiredLevelXp: 220,
      progressBar: "▓▓▓▓▓▓▓░░░",
    });
  });

  it("ranks an earlier-inserted tied user higher, and counts zero-XP users", async () => {
    const { service } = await setup([row("g1", "z", 0), row("g1", "a", 70), row("g1", "b", 70), row("g1", "c", 90)]);
    expect(service.getRank("g1", "c")).toMatchObject({ rank: 1, totalUsers: 4 });
    expect(service.getRank("g1", "a")).toMatchObject({ rank: 2, totalUsers: 4 });
    expect(service.getRank("g1", "b")).toMatchObject({ rank: 3, totalUsers: 4 });
    expect(service.getRank("g1", "z")).toMatchObject({ rank: 4, totalUsers: 4 });
  });

  it("agrees with the leaderboard position for every user (seeded random data across guilds)", async () => {
    const rand = seeded(42);
    const rows: XpRow[] = [];
    for (let i = 0; i < 600; i++) {
      const guildId = `g${Math.floor(rand() * 5)}`;
      // Few distinct values, so there are many ties
      rows.push(row(guildId, `u${i}`, Math.floor(rand() * 8) * 25));
    }
    const { service } = await setup(rows);
    for (let i = 0; i < 40; i++) service.processMessage(`g${i % 5}`, `late${i}`, settings);
    service.resetAllInMemory("g3");

    for (let g = 0; g < 5; g++) {
      const board = service.getLeaderboard(`g${g}`, 100_000);
      for (const entry of board) {
        const rank = service.getRank(`g${g}`, entry.discordId)!;
        expect(rank.rank).toBe(entry.rank);
        expect(rank.totalUsers).toBe(board.length);
        expect(rank.totalXp).toBe(entry.totalXp);
      }
    }
  });
});

describe("XpService.getGuildSnapshot", () => {
  it("returns this guild's entries in insertion order, without dirty or version", async () => {
    const { service } = await setup([
      row("g1", "b", 10, { lastMessageAt: new Date(5000) }),
      row("g2", "x", 99),
      row("g1", "a", 30),
    ]);
    expect(service.getGuildSnapshot("g1")).toEqual([
      { discordId: "b", totalXp: 10, level: 0, messageCount: 10, xpMessageCount: 5, lastMessageAt: 5000 },
      { discordId: "a", totalXp: 30, level: 0, messageCount: 30, xpMessageCount: 15, lastMessageAt: 0 },
    ]);
    expect(service.getGuildSnapshot("g9")).toEqual([]);
  });
});

describe("XpService resets", () => {
  it("resetUser returns false and changes nothing for an unknown user", async () => {
    const { service } = await setup([row("g1", "a", 10)]);
    expect(service.resetUser("g1", "b")).toBe(false);
    expect(service.getStats()).toEqual({ totalEntries: 1, dirtyEntries: 0, isHydrated: true });
  });

  it("resetUser zeroes all five fields and marks the entry dirty", async () => {
    const { service, repo } = await setup([row("g1", "a", 500, { lastMessageAt: new Date(1000) })]);
    expect(service.resetUser("g1", "a")).toBe(true);
    expect(service.getGuildSnapshot("g1")).toEqual([
      { discordId: "a", totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: 0 },
    ]);
    expect(service.getStats().dirtyEntries).toBe(1);
    await service.flush();
    expect(repo.batchUpsert).toHaveBeenCalledWith([
      { guildId: "g1", discordId: "a", totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: null },
    ]);
  });

  it("resetAllInMemory zeroes only that guild (not a guild sharing its prefix) and returns the count", async () => {
    const { service, repo } = await setup([
      row("g1", "a", 500),
      row("g10", "b", 500),
      row("g1", "c", 100),
      row("g2", "d", 100),
    ]);
    expect(service.resetAllInMemory("g1")).toBe(2);
    expect(service.resetAllInMemory("g9")).toBe(0);
    expect(service.getLeaderboard("g1").map((e) => e.totalXp)).toEqual([0, 0]);
    expect(service.getLeaderboard("g10").map((e) => e.totalXp)).toEqual([500]);
    expect(service.getStats()).toEqual({ totalEntries: 4, dirtyEntries: 2, isHydrated: true });
    await service.flush();
    expect(repo.batchUpsert.mock.calls[0]![0].map((r: XpRow) => `${r.guildId}:${r.discordId}`)).toEqual(["g1:a", "g1:c"]);
  });
});

describe("XpService.getStats", () => {
  it("counts entries across all guilds and dirty entries through each change", async () => {
    const { service } = await setup([row("g1", "a", 1), row("g2", "b", 1)]);
    expect(service.getStats()).toEqual({ totalEntries: 2, dirtyEntries: 0, isHydrated: true });
    service.processMessage("g3", "c", settings);
    expect(service.getStats()).toEqual({ totalEntries: 3, dirtyEntries: 1, isHydrated: true });
    service.resetUser("g1", "a");
    expect(service.getStats().dirtyEntries).toBe(2);
    service.rehydrateGuild("g2", [
      { discordId: "b", totalXp: 5, level: 0, messageCount: 1, xpMessageCount: 1, lastMessageAt: 0 },
      { discordId: "e", totalXp: 5, level: 0, messageCount: 1, xpMessageCount: 1, lastMessageAt: 0 },
    ]);
    expect(service.getStats()).toEqual({ totalEntries: 4, dirtyEntries: 4, isHydrated: true });
    await service.flush();
    expect(service.getStats().dirtyEntries).toBe(0);
  });
});

describe("XpService.processMessage settings", () => {
  it("ignores the excluded channel and role lists (message-create applies them)", async () => {
    const { service } = await setup();
    const result = service.processMessage("g1", "u1", {
      ...settings,
      xpExcludedChannelIds: ["c1"],
      xpExcludedRoleIds: ["r1"],
    });
    expect(result).toEqual({ leveledUp: false, newLevel: 0, xpGained: 15 });
  });
});
