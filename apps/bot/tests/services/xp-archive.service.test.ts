import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";
import { XpArchiveService } from "../../src/services/xp-archive.service.js";
import type { XpService } from "../../src/services/xp.service.js";
import type { XpArchiveRepository } from "../../src/repositories/xp-archive.repository.js";

// The tagged results of XpArchiveService. The full reset-all and restore flows (order of flushes and writes, replies,
// log lines) are pinned through the command in tests/commands/xp-admin.test.ts.

const ID = "0b6f8e2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const entry = { discordId: "a", totalXp: 10, level: 1, messageCount: 2, xpMessageCount: 1, lastMessageAt: 5 };

function setup(opts: { snapshot?: unknown[]; data?: unknown; found?: boolean; noRepo?: boolean; flushError?: Error } = {}) {
  const xp = {
    flush: vi.fn(async () => {
      if (opts.flushError) throw opts.flushError;
    }),
    getGuildSnapshot: vi.fn(() => opts.snapshot ?? []),
    resetAllInMemory: vi.fn(() => 0),
    rehydrateGuild: vi.fn((_g: string, e: unknown[]) => e.length),
  };
  const repo = {
    create: vi.fn(async () => ({ id: "new-archive" })),
    findByIdAndGuild: vi.fn(async () => (opts.found === false ? null : { id: ID, data: "data" in opts ? opts.data : [entry], totalXpSum: 777 })),
    findByGuild: vi.fn(async () => [{ id: "x" }]),
    markRestored: vi.fn(async () => undefined),
  };
  const log = { info: vi.fn(), error: vi.fn() } as unknown as Logger;
  const service = new XpArchiveService(xp as unknown as XpService, opts.noRepo ? undefined : (repo as unknown as XpArchiveRepository));
  return { service, xp, repo, log };
}

describe("XpArchiveService.resetAll", () => {
  it("reports a failed first flush", async () => {
    const s = setup({ flushError: new Error("x") });
    expect(await s.service.resetAll("g1", "u1", null, s.log)).toEqual({ kind: "flush-failed" });
    expect(s.xp.getGuildSnapshot).not.toHaveBeenCalled();
  });

  it("reports an empty server before checking the archive system", async () => {
    expect(await setup({ noRepo: true }).service.resetAll("g1", "u1", null, setup().log)).toEqual({ kind: "empty" });
  });

  it("reports a missing archive system after snapshotting", async () => {
    const s = setup({ noRepo: true, snapshot: [entry] });
    expect(await s.service.resetAll("g1", "u1", null, s.log)).toEqual({ kind: "unavailable" });
    expect(s.xp.flush).toHaveBeenCalledTimes(1);
    expect(s.xp.resetAllInMemory).not.toHaveBeenCalled();
  });

  it("returns the archive ID, user count and XP total", async () => {
    const s = setup({ snapshot: [entry, { ...entry, discordId: "b", totalXp: 5 }] });
    expect(await s.service.resetAll("g1", "u1", "why", s.log)).toEqual({ kind: "ok", archiveId: "new-archive", userCount: 2, totalXpSum: 15 });
    expect(s.repo.create).toHaveBeenCalledWith("g1", "u1", "why", expect.any(Array), 2, 15);
  });
});

describe("XpArchiveService.restore", () => {
  it.each([
    ["no archive system", { noRepo: true }, ID, "unavailable"],
    ["a malformed ID", {}, "not-a-uuid", "invalid-id"],
    ["a missing archive", { found: false }, ID, "not-found"],
    ["non-array data", { data: { a: 1 } }, ID, "not-array"],
    ["null data", { data: null }, ID, "not-array"],
    ["a null item", { data: [entry, null] }, ID, "invalid-entry"],
    ["an array item", { data: [[]] }, ID, "invalid-entry"],
    ["a numeric discordId", { data: [{ ...entry, discordId: 1 }] }, ID, "invalid-entry"],
  ] as const)("reports %s and writes nothing", async (_label, opts, id, kind) => {
    const s = setup(opts as Parameters<typeof setup>[0]);
    expect(await s.service.restore("g1", "u1", id, s.log)).toEqual({ kind });
    expect(s.xp.flush).not.toHaveBeenCalled();
    expect(s.repo.create).not.toHaveBeenCalled();
    expect(s.repo.markRestored).not.toHaveBeenCalled();
  });

  it("returns the restored count and the archive's stored XP total", async () => {
    const s = setup({ data: [entry, { ...entry, discordId: "b", totalXp: Number.NaN }] });
    expect(await s.service.restore("g1", "u1", ID, s.log)).toEqual({ kind: "ok", restored: 2, archiveTotalXpSum: 777 });
    expect(s.repo.create).not.toHaveBeenCalled(); // empty current snapshot: no auto-archive
    expect(s.repo.markRestored).toHaveBeenCalledWith(ID);
  });

  it("lets a failing first flush propagate", async () => {
    const s = setup({ flushError: new Error("db down") });
    await expect(s.service.restore("g1", "u1", ID, s.log)).rejects.toThrow("db down");
    expect(s.xp.rehydrateGuild).not.toHaveBeenCalled();
  });
});

describe("XpArchiveService.listRecent and available", () => {
  it("reads the 10 newest archives", async () => {
    const s = setup();
    expect(s.service.available).toBe(true);
    expect(await s.service.listRecent("g1")).toEqual([{ id: "x" }]);
    expect(s.repo.findByGuild).toHaveBeenCalledWith("g1", 10);
  });

  it("returns null without an archive system", async () => {
    const s = setup({ noRepo: true });
    expect(s.service.available).toBe(false);
    expect(await s.service.listRecent("g1")).toBeNull();
  });
});
