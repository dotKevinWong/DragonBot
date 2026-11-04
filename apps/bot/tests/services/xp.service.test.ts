import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { XpService } from "../../src/services/xp.service.js";
import type { XpRepository, XpRow } from "../../src/repositories/xp.repository.js";

const settings = {
  xpMin: 15,
  xpMax: 15,
  xpCooldownSeconds: 0,
};

/** A batchUpsert call still in flight, which the test settles by hand. */
interface PendingWrite {
  rows: Omit<XpRow, never>[];
  resolve: () => void;
  reject: (err: unknown) => void;
}

function setup(initialRows: XpRow[] = []) {
  const writes: PendingWrite[] = [];
  const repo = {
    findAll: vi.fn().mockResolvedValue(initialRows),
    batchUpsert: vi.fn((rows: XpRow[]) => {
      return new Promise<void>((resolve, reject) => {
        // Copy the rows, so a later mutation of the source objects can't change what the test sees was written
        writes.push({ rows: rows.map((r) => ({ ...r })), resolve, reject });
      });
    }),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const service = new XpService(repo as unknown as XpRepository, logger as unknown as Logger);
  return { service, repo, logger, writes };
}

/** Let pending microtasks run, so flushInternal reaches its next await. */
async function tick() {
  await new Promise((r) => setImmediate(r));
}

describe("XpService.processMessage before hydrate", () => {
  it("returns null and creates no entry until the service is hydrated", async () => {
    const { service } = setup();
    expect(service.processMessage("g1", "u1", settings)).toBeNull();
    expect(service.getStats()).toEqual({ totalEntries: 0, dirtyEntries: 0, isHydrated: false });
    expect(service.getRank("g1", "u1")).toBeNull();

    await service.hydrate();
    const result = service.processMessage("g1", "u1", settings);
    expect(result).toEqual({ leveledUp: false, newLevel: 0, xpGained: 15 });
  });

  it("does not post a false level-up or lose stored XP when a message arrives before hydrate", async () => {
    const stored: XpRow = {
      guildId: "g1",
      discordId: "u1",
      totalXp: 1000,
      level: 5,
      messageCount: 70,
      xpMessageCount: 60,
      lastMessageAt: null,
    };
    const { service } = setup([stored]);
    expect(service.processMessage("g1", "u1", { ...settings, xpMin: 200, xpMax: 200 })).toBeNull();
    await service.hydrate();
    const rank = service.getRank("g1", "u1");
    expect(rank).toMatchObject({ totalXp: 1000, level: 5, messageCount: 70, xpMessageCount: 60 });
  });
});

describe("XpService.flush dirty handling", () => {
  it("keeps an entry dirty when it changes while its chunk is being written, and writes it on the next flush", async () => {
    const { service, writes, logger } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);
    service.processMessage("g1", "u2", settings);

    const first = service.flush();
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.rows.find((r) => r.discordId === "u1")).toMatchObject({ totalXp: 15, messageCount: 1 });

    // u1 sends another message while the write is in flight
    service.processMessage("g1", "u1", settings);

    writes[0]!.resolve();
    await first;

    expect(logger.info).toHaveBeenCalledWith({ count: 2 }, "XP data flushed to database");
    expect(service.getStats().dirtyEntries).toBe(1);

    const second = service.flush();
    await tick();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.rows).toEqual([
      expect.objectContaining({ guildId: "g1", discordId: "u1", totalXp: 30, messageCount: 2, xpMessageCount: 2 }),
    ]);
    writes[1]!.resolve();
    await second;
    expect(service.getStats().dirtyEntries).toBe(0);
  });

  it("keeps a reset made during the flush dirty, so the reset is persisted", async () => {
    const { service, writes } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);

    const first = service.flush();
    await tick();
    expect(service.resetUser("g1", "u1")).toBe(true);
    writes[0]!.resolve();
    await first;
    expect(service.getStats().dirtyEntries).toBe(1);

    const second = service.flush();
    await tick();
    expect(writes[1]!.rows).toEqual([
      expect.objectContaining({ discordId: "u1", totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: null }),
    ]);
    writes[1]!.resolve();
    await second;
    expect(service.getStats().dirtyEntries).toBe(0);
  });

  it("keeps a guild-wide reset made during the flush dirty", async () => {
    const { service, writes } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);
    service.processMessage("g1", "u2", settings);

    const first = service.flush();
    await tick();
    expect(service.resetAllInMemory("g1")).toBe(2);
    writes[0]!.resolve();
    await first;
    expect(service.getStats().dirtyEntries).toBe(2);
  });

  it("keeps an entry restored by rehydrateGuild during the flush dirty, and writes it on the next flush", async () => {
    const { service, writes } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);

    const first = service.flush();
    await tick();
    expect(writes).toHaveLength(1);

    // A restore replaces the u1 entry while its write is in flight
    service.rehydrateGuild("g1", [
      { discordId: "u1", totalXp: 900, level: 5, messageCount: 60, xpMessageCount: 60, lastMessageAt: 1 },
    ]);

    writes[0]!.resolve();
    await first;
    expect(service.getStats().dirtyEntries).toBe(1);

    const second = service.flush();
    await tick();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.rows).toEqual([
      expect.objectContaining({ guildId: "g1", discordId: "u1", totalXp: 900, level: 5, messageCount: 60 }),
    ]);
    writes[1]!.resolve();
    await second;
    expect(service.getStats().dirtyEntries).toBe(0);
  });

  it("clears entries that did not change during the flush", async () => {
    const { service, writes } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);
    const p = service.flush();
    await tick();
    writes[0]!.resolve();
    await p;
    expect(service.getStats().dirtyEntries).toBe(0);
  });

  it("leaves a failed chunk's entries dirty and rejects", async () => {
    const { service, writes, logger } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);

    const p = service.flush();
    await tick();
    writes[0]!.reject(new Error("db down"));
    await expect(p).rejects.toThrow("db down");
    expect(service.getStats().dirtyEntries).toBe(1);
    expect(service.flushing).toBe(false);
    expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), "XP data flushed to database");
  });

  it("clears chunks written before a later chunk fails, and leaves the failed chunk dirty", async () => {
    const { service, writes } = setup();
    await service.hydrate();
    for (let i = 0; i < 501; i++) service.processMessage("g1", `u${i}`, settings);

    const p = service.flush();
    await tick();
    expect(writes[0]!.rows).toHaveLength(500);
    writes[0]!.resolve();
    await tick();
    expect(writes[1]!.rows).toHaveLength(1);
    writes[1]!.reject(new Error("db down"));
    await expect(p).rejects.toThrow("db down");
    expect(service.getStats().dirtyEntries).toBe(1);
  });

  it("skips a second flush while one is in flight", async () => {
    const { service, writes, logger } = setup();
    await service.hydrate();
    service.processMessage("g1", "u1", settings);
    const p = service.flush();
    await tick();
    await service.flush();
    expect(logger.warn).toHaveBeenCalledWith("Flush already in progress, skipping");
    expect(writes).toHaveLength(1);
    writes[0]!.resolve();
    await p;
  });
});
