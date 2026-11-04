import { describe, it, expect, vi } from "vitest";
import { GuildService } from "../../src/services/guild.service.js";
import type { GuildRepository } from "../../src/repositories/guild.repository.js";

const rowA = { guildId: "g1", guildName: "Before", honeypotWarningChannelId: null, honeypotWarningMessageId: null };
const rowB = { guildId: "g1", guildName: "After", honeypotWarningChannelId: "c1", honeypotWarningMessageId: "m1" };
const otherRow = { guildId: "g2", guildName: "Other", honeypotWarningChannelId: null, honeypotWarningMessageId: null };

type Row = typeof rowA | typeof rowB | typeof otherRow;

function setup() {
  const repo = {
    findByGuildId: vi.fn(),
    findAll: vi.fn(),
    upsert: vi.fn().mockResolvedValue(rowB),
    updateSettings: vi.fn().mockResolvedValue(null),
  };
  const service = new GuildService(repo as unknown as GuildRepository);
  return { service, repo };
}

/** A database read still in flight, which the test answers by hand. */
function pendingRead<T>() {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

/** Every write that drops a server's cached row. */
const WRITES: Record<string, (service: GuildService) => unknown> = {
  setHoneypotWarning: (service) => service.setHoneypotWarning("g1", { channelId: "c1", messageId: "m1" }),
  updateSettings: (service) => service.updateSettings("g1", { guildName: "After" }),
  ensureGuild: (service) => service.ensureGuild("g1", "After"),
  disableBanSync: (service) => service.disableBanSync("g1"),
  invalidateCache: (service) => service.invalidateCache("g1"),
};

describe("GuildService", () => {
  it("getSettingsFresh reads the database even when the guild is cached", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValueOnce(rowA).mockResolvedValueOnce(rowB);
    expect(await service.getSettings("g1")).toEqual(rowA);

    expect(await service.getSettingsFresh("g1")).toEqual(rowB);
    expect(await service.getSettings("g1")).toEqual(rowB); // cache refreshed
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
  });

  it("getSettingsFresh drops the cached row when the guild is gone", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValueOnce(rowA).mockResolvedValue(null);
    await service.getSettings("g1");

    expect(await service.getSettingsFresh("g1")).toBeNull();
    expect(await service.getSettings("g1")).toBeNull();
    expect(repo.findByGuildId).toHaveBeenCalledTimes(3);
  });

  it("setHoneypotWarning writes both columns and drops the cached row", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValueOnce(rowA).mockResolvedValueOnce(rowB);
    await service.getSettings("g1");

    await service.setHoneypotWarning("g1", { channelId: "c1", messageId: "m1" });
    expect(repo.updateSettings).toHaveBeenCalledWith("g1", { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "m1" });
    expect(await service.getSettings("g1")).toEqual(rowB); // the stale cached row is gone

    await service.setHoneypotWarning("g1", null);
    expect(repo.updateSettings).toHaveBeenLastCalledWith("g1", { honeypotWarningChannelId: null, honeypotWarningMessageId: null });
  });

  it("doesn't cache a row read across a write", async () => {
    for (const [name, write] of Object.entries(WRITES)) {
      const { service, repo } = setup();
      const read = pendingRead<Row>();
      // The pending read took its snapshot before the write. Every read after it sees the written row.
      repo.findByGuildId.mockReturnValueOnce(read.promise).mockResolvedValue(rowB);

      const reading = service.getSettings("g1"); // a cache miss
      await write(service);
      read.answer(rowA);

      expect(await reading, name).toEqual(rowA); // its caller still gets what it read
      const reads = repo.findByGuildId.mock.calls.length;
      expect(await service.getSettings("g1"), name).toEqual(rowB); // not cached, so read from the database again
      expect(await service.getSettings("g1"), name).toEqual(rowB); // that read began after the write, so it is cached
      expect(repo.findByGuildId.mock.calls.length, name).toBe(reads + 1);
    }
  });

  it("doesn't cache a fresh row read across a write", async () => {
    const { service, repo } = setup();
    const read = pendingRead<Row>();
    repo.findByGuildId.mockReturnValueOnce(read.promise).mockResolvedValue(rowB);

    const reading = service.getSettingsFresh("g1");
    await service.setHoneypotWarning("g1", { channelId: "c1", messageId: "m1" });
    read.answer(rowA);

    expect(await reading).toEqual(rowA);
    expect(await service.getSettings("g1")).toEqual(rowB); // read from the database again
    expect(await service.getSettings("g1")).toEqual(rowB); // and cached
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
  });

  it("hydrateAll keeps a row written during its read out of the cache", async () => {
    const { service, repo } = setup();
    const read = pendingRead<Row[]>();
    repo.findAll.mockReturnValueOnce(read.promise);
    repo.findByGuildId.mockImplementation(async (guildId: string) => (guildId === "g1" ? rowB : otherRow));
    // Written before the read began, as the birthday check does just before a sync: that row is still cached.
    await service.updateSettings("g2", { guildName: "Other" });

    const hydrating = service.hydrateAll();
    await service.updateSettings("g1", { guildName: "After" });
    read.answer([rowA, otherRow]);

    expect(await hydrating).toBe(2);
    repo.findByGuildId.mockClear();
    expect(await service.getSettings("g1")).toEqual(rowB); // read from the database
    expect(await service.getSettings("g2")).toEqual(otherRow); // from the cache
    expect(repo.findByGuildId.mock.calls).toEqual([["g1"]]);
  });

  it("reads a missing guild from the database on every call (no negative cache)", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValue(null);
    expect(await service.getSettings("g1")).toBeNull();
    expect(await service.getSettings("g1")).toBeNull();
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
    expect(service.getAllCached()).toEqual([]);
  });

  it("passes a failed read to the caller and retries the database on the next call", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockRejectedValueOnce(new Error("db down")).mockResolvedValue(rowA);
    await expect(service.getSettings("g1")).rejects.toThrow("db down");
    expect(await service.getSettings("g1")).toEqual(rowA);
    expect(await service.getSettings("g1")).toEqual(rowA);
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
  });

  it("serves getSettings from the row getSettingsFresh cached", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValue(rowB);
    await service.getSettingsFresh("g1");
    expect(await service.getSettings("g1")).toEqual(rowB);
    expect(repo.findByGuildId).toHaveBeenCalledTimes(1);
  });
});

/** A database read still in flight that can fail. */
function pendingReadOrFailure<T>() {
  let answer!: (value: T) => void;
  let fail!: (err: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { promise, answer, fail };
}

describe("GuildService.getSettings in-flight sharing", () => {
  it("shares one database read among concurrent misses for a server, then serves it from the cache", async () => {
    const { service, repo } = setup();
    const read = pendingRead<Row>();
    repo.findByGuildId.mockReturnValueOnce(read.promise);

    const readers = [service.getSettings("g1"), service.getSettings("g1"), service.getSettings("g1")];
    expect(repo.findByGuildId).toHaveBeenCalledTimes(1);
    read.answer(rowA);

    expect(await Promise.all(readers)).toEqual([rowA, rowA, rowA]);
    expect(await service.getSettings("g1")).toEqual(rowA);
    expect(repo.findByGuildId).toHaveBeenCalledTimes(1);
  });

  it("calls the database before getSettings returns, so the read starts in call order", () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockReturnValue(pendingRead<Row>().promise);
    void service.getSettings("g1");
    expect(repo.findByGuildId).toHaveBeenCalledWith("g1");
  });

  it("never joins a read that began before a write", async () => {
    for (const [name, write] of Object.entries(WRITES)) {
      const { service, repo } = setup();
      const before = pendingRead<Row>();
      repo.findByGuildId.mockReturnValueOnce(before.promise).mockResolvedValue(rowB);

      const early = service.getSettings("g1");
      await write(service);
      const late = service.getSettings("g1");
      const lateCalls = repo.findByGuildId.mock.calls.length;
      expect(await late, name).toEqual(rowB);
      before.answer(rowA);

      expect(await early, name).toEqual(rowA); // its caller still gets what it read
      expect(await service.getSettings("g1"), name).toEqual(rowB); // the old row never reached the cache
      expect(repo.findByGuildId.mock.calls.length, name).toBe(lateCalls);
    }
  });

  it("keeps a newer read shared when an older one finishes after it began", async () => {
    const { service, repo } = setup();
    const old = pendingRead<Row>();
    const fresh = pendingRead<Row>();
    repo.findByGuildId.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);

    const a = service.getSettings("g1");
    service.invalidateCache("g1");
    const b = service.getSettings("g1");
    old.answer(rowA);
    expect(await a).toEqual(rowA);

    const c = service.getSettings("g1"); // joins b's read
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
    fresh.answer(rowB);
    expect(await b).toEqual(rowB);
    expect(await c).toEqual(rowB);
  });

  it("gives every joiner the same failure, then starts a fresh read", async () => {
    const { service, repo } = setup();
    const read = pendingReadOrFailure<Row>();
    repo.findByGuildId.mockReturnValueOnce(read.promise).mockResolvedValue(rowA);

    const readers = [service.getSettings("g1"), service.getSettings("g1")];
    const err = new Error("db down");
    read.fail(err);
    for (const reader of readers) await expect(reader).rejects.toBe(err);

    expect(await service.getSettings("g1")).toEqual(rowA);
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
  });

  it("lets getSettingsFresh and updateSettings read the database themselves during a shared read", async () => {
    const { service, repo } = setup();
    const read = pendingRead<Row>();
    repo.findByGuildId.mockReturnValueOnce(read.promise).mockResolvedValue(rowB);

    const reading = service.getSettings("g1");
    expect(await service.getSettingsFresh("g1")).toEqual(rowB);
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
    read.answer(rowA);
    expect(await reading).toEqual(rowA);
  });

  it("doesn't let a miss during a full reload join a read that began before it", async () => {
    const { service, repo } = setup();
    const before = pendingRead<Row>();
    const all = pendingRead<Row[]>();
    repo.findByGuildId.mockReturnValueOnce(before.promise).mockResolvedValue(rowB);
    repo.findAll.mockReturnValueOnce(all.promise);

    const early = service.getSettings("g1");
    const hydrating = service.hydrateAll();
    const late = service.getSettings("g1");
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
    expect(await late).toEqual(rowB);

    before.answer(rowA);
    expect(await early).toEqual(rowA);
    all.answer([rowB, otherRow]);
    expect(await hydrating).toBe(2);
    expect(await service.getSettings("g2")).toEqual(otherRow);
  });

  it("doesn't share a read between servers", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockImplementation(async (guildId: string) => (guildId === "g1" ? rowA : otherRow));
    expect(await Promise.all([service.getSettings("g1"), service.getSettings("g2")])).toEqual([rowA, otherRow]);
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
  });

  it("shares a missing server's null among concurrent callers but doesn't cache it", async () => {
    const { service, repo } = setup();
    const read = pendingRead<Row | null>();
    repo.findByGuildId.mockReturnValueOnce(read.promise).mockResolvedValue(null);

    const readers = [service.getSettings("g1"), service.getSettings("g1")];
    read.answer(null);
    expect(await Promise.all(readers)).toEqual([null, null]);
    expect(await service.getSettings("g1")).toBeNull();
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
    expect(service.getAllCached()).toEqual([]);
  });
});

