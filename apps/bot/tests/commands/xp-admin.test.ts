import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import type { BotCommand } from "../../src/types/commands.js";
import type { BotContext } from "../../src/types/context.js";
import { ErrorCode } from "../../src/types/errors.js";
import { XpService } from "../../src/services/xp.service.js";
import { XpArchiveService } from "../../src/services/xp-archive.service.js";
import type { XpArchiveRepository } from "../../src/repositories/xp-archive.repository.js";
import type { XpRepository } from "../../src/repositories/xp.repository.js";

// Pins every /xp-admin subcommand: replies, the order of XP flushes, snapshots and archive writes, and log lines.
// The XP service is real (over a fake XpRepository) so the reset-all and restore flows act on real in-memory data.

const ARCHIVE_ID = "0b6f8e2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

type Entry = { discordId: string; totalXp: number; level: number; messageCount: number; xpMessageCount: number; lastMessageAt: number };

interface Setup {
  sub: string;
  manageGuild?: boolean;
  admin?: boolean;
  xpScope?: boolean;
  guildId?: string | null;
  strings?: Record<string, string | null>;
  noArchive?: boolean;
  seed?: { guildId: string; discordId: string; totalXp: number }[];
  archive?: Record<string, unknown> | null;
  archives?: Record<string, unknown>[];
  guild?: unknown;
  createError?: Error;
  markRestoredError?: Error;
}

let command: BotCommand;
// The flush cooldown is module state, so each test loads a fresh command module (and the AppError class it checks)
let AppError: typeof import("../../src/types/errors.js").AppError;
beforeEach(async () => {
  vi.resetModules();
  command = (await import("../../src/commands/xp-admin.js")).default;
  AppError = (await import("../../src/types/errors.js")).AppError;
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(o: Setup) {
  const calls: string[] = [];
  const upserts: unknown[][] = [];
  let upsertError: Error | undefined;
  const failNextUpserts: Error[] = [];
  const xpRepo = {
    findAll: vi.fn(async () =>
      (o.seed ?? []).map((s) => ({
        guildId: s.guildId,
        discordId: s.discordId,
        totalXp: s.totalXp,
        level: 1,
        messageCount: 3,
        xpMessageCount: 2,
        lastMessageAt: new Date(1_000),
      })),
    ),
    batchUpsert: vi.fn(async (rows: unknown[]) => {
      calls.push(`batchUpsert:${rows.length}`);
      const err = failNextUpserts.shift() ?? upsertError;
      if (err) throw err;
      upserts.push(rows);
    }),
  };
  const xpLogger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const xp = new XpService(xpRepo as unknown as XpRepository, xpLogger as never);
  await xp.hydrate();
  // Spy on the XP service methods the command and archive flows call, recording the order
  for (const name of ["flush", "getGuildSnapshot", "resetAllInMemory", "rehydrateGuild"] as const) {
    const orig = (xp[name] as (...a: unknown[]) => unknown).bind(xp);
    vi.spyOn(xp, name).mockImplementation(((...args: unknown[]) => {
      calls.push(name);
      return orig(...args);
    }) as never);
  }

  const created: { guildId: string; archivedBy: string; reason: string | null; data: Entry[]; userCount: number; totalXpSum: number }[] = [];
  const archiveRepo = {
    create: vi.fn(async (guildId: string, archivedBy: string, reason: string | null, data: Entry[], userCount: number, totalXpSum: number) => {
      calls.push("create");
      if (o.createError) throw o.createError;
      created.push({ guildId, archivedBy, reason, data: JSON.parse(JSON.stringify(data)), userCount, totalXpSum });
      return { id: `arch-${created.length}-0000-0000`, guildId, archivedBy, reason, data, userCount, totalXpSum, restoredAt: null, createdAt: new Date() };
    }),
    findByIdAndGuild: vi.fn(async (_id: string, _guildId: string) => {
      calls.push("findByIdAndGuild");
      return o.archive === undefined ? null : o.archive;
    }),
    findByGuild: vi.fn(async (_guildId: string, _limit: number) => {
      calls.push("findByGuild");
      return o.archives ?? [];
    }),
    markRestored: vi.fn(async (_id: string) => {
      calls.push("markRestored");
      if (o.markRestoredError) throw o.markRestoredError;
    }),
  };

  const logLines: { bindings: Record<string, unknown>; level: string; obj?: unknown; msg?: unknown }[] = [];
  const childBindings: Record<string, unknown>[] = [];
  const makeLog = (bindings: Record<string, unknown>) => {
    const rec = (level: string) =>
      vi.fn((a: unknown, b?: unknown) => {
        if (typeof a === "string") logLines.push({ bindings, level, msg: a });
        else logLines.push({ bindings, level, obj: a, msg: b });
      });
    return { info: rec("info"), warn: rec("warn"), error: rec("error"), debug: rec("debug") };
  };
  const rootLog = {
    ...makeLog({}),
    child: vi.fn((b: Record<string, unknown>) => {
      childBindings.push(b);
      return makeLog(b);
    }),
  };

  const editReply = vi.fn(async (_arg: unknown) => {
    calls.push("editReply");
  });
  const interaction = {
    guildId: o.guildId === undefined ? "g1" : o.guildId,
    guild: o.guild === undefined ? null : o.guild,
    user: { id: "u1" },
    memberPermissions: {
      has: vi.fn((flag: string | bigint) => {
        if (flag === "ManageGuild") return o.manageGuild ?? true;
        if (flag === PermissionFlagsBits.Administrator) return o.admin ?? false;
        throw new Error(`unexpected flag ${String(flag)}`);
      }),
    },
    options: {
      getSubcommand: () => o.sub,
      getString: vi.fn((name: string) => (o.strings && name in o.strings ? o.strings[name] : null)),
      getUser: vi.fn(() => ({ id: "t1", displayName: "Target" })),
    },
    editReply,
  } as unknown as ChatInputCommandInteraction;

  const guildAdmin = { hasPermission: vi.fn(async () => o.xpScope ?? false) };
  const guild = { getSettings: vi.fn(async () => null) };
  const xpArchive = new XpArchiveService(xp, o.noArchive ? undefined : (archiveRepo as unknown as XpArchiveRepository));
  const ctx = {
    logger: rootLog,
    services: { xp, guildAdmin, guild, xpArchive },
  } as unknown as BotContext;

  const replies = () =>
    editReply.mock.calls.map((c) => {
      const e = (c[0] as { embeds: { data: { description: string; color: number } }[] }).embeds[0]!.data;
      return { text: e.description, color: e.color };
    });
  const reply = () => {
    expect(editReply).toHaveBeenCalledTimes(1);
    return replies()[0]!;
  };
  return {
    interaction, ctx, xp, xpRepo, xpLogger, archiveRepo, calls, created, upserts, logLines, childBindings, rootLog, editReply,
    reply,
    run: () => command.execute(interaction, ctx),
    failUpsertOnce: (e: Error) => failNextUpserts.push(e),
    failAllUpserts: (e: Error) => {
      upsertError = e;
    },
  };
}

const RED = 0xff0000;
const GREEN = 0x43b581;
const YELLOW = 0xffcc00;
const SEED = [
  { guildId: "g1", discordId: "a", totalXp: 1500 },
  { guildId: "g1", discordId: "b", totalXp: 250 },
  { guildId: "g2", discordId: "c", totalXp: 99 },
];

describe("/xp-admin permission gate", () => {
  it("refuses outside a server", async () => {
    const s = await setup({ sub: "flush", guildId: null });
    await s.run();
    expect(s.reply()).toEqual({ text: "This command can only be used in a server.", color: RED });
  });

  it("refuses without Manage Server or the xp scope", async () => {
    const s = await setup({ sub: "flush", manageGuild: false, xpScope: false });
    await s.run();
    expect(s.ctx.services.guildAdmin.hasPermission).toHaveBeenCalledWith("g1", "u1", "xp");
    expect(s.reply()).toEqual({ text: "You need the `xp` permission or Manage Server to use this.", color: RED });
  });

  it("lets an xp-scope holder through", async () => {
    const s = await setup({ sub: "flush", manageGuild: false, xpScope: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "XP data flushed to database.", color: GREEN });
  });
});

describe("/xp-admin flush", () => {
  it("refuses while a flush is running", async () => {
    const s = await setup({ sub: "flush" });
    vi.spyOn(s.xp, "flushing", "get").mockReturnValue(true);
    await s.run();
    expect(s.reply()).toEqual({ text: "A flush is already in progress.", color: RED });
    expect(s.calls).not.toContain("flush");
  });

  it("has a 5-minute process-wide cooldown, consumed even when the flush throws", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000_000);
    const s1 = await setup({ sub: "flush", seed: SEED });
    s1.xp.resetUser("g1", "a");
    s1.failAllUpserts(new Error("db down"));
    await s1.run();
    expect(s1.reply()).toEqual({ text: "Something went wrong.", color: RED });

    vi.setSystemTime(10_000_000 + 60_500);
    const s2 = await setup({ sub: "flush", guildId: "g9" });
    await s2.run();
    expect(s2.reply()).toEqual({ text: "Flush is on cooldown. Try again in 240s.", color: RED });

    vi.setSystemTime(10_000_000 + 5 * 60 * 1000);
    const s3 = await setup({ sub: "flush" });
    await s3.run();
    expect(s3.reply()).toEqual({ text: "XP data flushed to database.", color: GREEN });
  });
});

describe("/xp-admin reset and status", () => {
  it("resets a user with data", async () => {
    const s = await setup({ sub: "reset", seed: [{ guildId: "g1", discordId: "t1", totalXp: 10 }] });
    await s.run();
    expect(s.reply()).toEqual({ text: "XP reset for **Target**.", color: GREEN });
  });

  it("reports a user without data", async () => {
    const s = await setup({ sub: "reset" });
    await s.run();
    expect(s.reply()).toEqual({ text: "Target has no XP data to reset.", color: RED });
  });

  it("shows defaults when the guild has no settings row", async () => {
    const s = await setup({ sub: "status", seed: SEED });
    await s.run();
    expect(s.reply()).toEqual({
      text:
        "**XP System Status**\nEnabled: ❌\nXP Range: 15–25\nCooldown: 60s\nLevel-up Channel: Same channel\n" +
        "Excluded Channels: 0\nExcluded Roles: 0\n\n**Cache Stats**\nTotal entries: 3\nDirty (pending flush): 0\n" +
        "Users in this guild: 2\n\n*Configure XP settings via the web dashboard.*",
      color: YELLOW,
    });
  });
});

describe("/xp-admin reset-all", () => {
  const strings = { confirm: "CONFIRM", reason: "new term" };

  it("needs Administrator", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: false });
    await s.run();
    expect(s.reply()).toEqual({ text: "This command requires **Administrator** permission.", color: RED });
    expect(s.calls).toEqual(["editReply"]);
  });

  it("needs CONFIRM exactly", async () => {
    const s = await setup({ sub: "reset-all", strings: { confirm: "confirm" }, admin: true });
    await s.run();
    expect(s.reply()).toEqual({
      text: "You must type `CONFIRM` to reset all XP. This action archives current data before resetting.",
      color: RED,
    });
    expect(s.calls).toEqual(["editReply"]);
  });

  it("aborts when the first flush throws, before any snapshot or archive", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, seed: SEED });
    s.xp.resetUser("g1", "a"); // make an entry dirty so flush writes
    s.failUpsertOnce(new Error("db down"));
    await s.run();
    expect(s.reply()).toEqual({
      text: "Failed to flush XP data before reset. Reset aborted to prevent data loss.",
      color: RED,
    });
    expect(s.calls).toEqual(["flush", "batchUpsert:1", "editReply"]);
    expect(s.logLines.map((l) => [l.level, l.msg])).toEqual([
      ["info", "Flushing XP before archive..."],
      ["error", "Flush failed before reset — aborting"],
    ]);
    expect(s.logLines[1]!.bindings).toEqual({ command: "xp-admin", sub: "reset-all", guildId: "g1" });
  });

  it("reports an empty server", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, seed: [{ guildId: "g2", discordId: "c", totalXp: 5 }] });
    await s.run();
    expect(s.reply()).toEqual({ text: "No XP data found for this server.", color: RED });
    expect(s.calls).toEqual(["flush", "getGuildSnapshot", "editReply"]);
  });

  it("reports an empty server as empty even with no archive system", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, noArchive: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "No XP data found for this server.", color: RED });
  });

  it("checks for the archive system after flushing and snapshotting", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, noArchive: true, seed: SEED });
    await s.run();
    expect(s.reply()).toEqual({ text: "Archive system not available.", color: RED });
    expect(s.calls).toEqual(["flush", "getGuildSnapshot", "editReply"]);
    expect(s.xp.getRank("g1", "a")!.totalXp).toBe(1500);
  });

  it("archives, zeroes and flushes, in that order", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, seed: SEED });
    await s.run();
    expect(s.calls).toEqual(["flush", "getGuildSnapshot", "create", "resetAllInMemory", "flush", "batchUpsert:2", "editReply"]);
    expect(s.created).toEqual([
      {
        guildId: "g1",
        archivedBy: "u1",
        reason: "new term",
        data: [
          { discordId: "a", totalXp: 1500, level: 1, messageCount: 3, xpMessageCount: 2, lastMessageAt: 1000 },
          { discordId: "b", totalXp: 250, level: 1, messageCount: 3, xpMessageCount: 2, lastMessageAt: 1000 },
        ],
        userCount: 2,
        totalXpSum: 1750,
      },
    ]);
    expect(s.upserts[0]).toEqual([
      { guildId: "g1", discordId: "a", totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: null },
      { guildId: "g1", discordId: "b", totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: null },
    ]);
    expect(s.xp.getRank("g2", "c")!.totalXp).toBe(99);
    expect(s.reply()).toEqual({
      text:
        "**XP Reset Complete**\n\nArchived **2** users with **1,750** total XP.\nArchive ID: `arch-1-0000-0000`\n" +
        "Reason: new term\n\nUse `/xp-admin restore` with the archive ID to undo.",
      color: GREEN,
    });
    expect(s.childBindings).toEqual([{ command: "xp-admin", sub: "reset-all", guildId: "g1" }]);
    expect(s.logLines.map((l) => [l.level, l.obj, l.msg])).toEqual([
      ["info", undefined, "Flushing XP before archive..."],
      ["info", { archiveId: "arch-1-0000-0000", users: 2, totalXp: 1750 }, "XP archived"],
    ]);
  });

  it("stores a null reason and leaves the Reason line out", async () => {
    const s = await setup({ sub: "reset-all", strings: { confirm: "CONFIRM" }, admin: true, seed: SEED });
    await s.run();
    expect(s.created[0]!.reason).toBeNull();
    expect(s.reply().text).toBe(
      "**XP Reset Complete**\n\nArchived **2** users with **1,750** total XP.\nArchive ID: `arch-1-0000-0000`\n" +
        "\nUse `/xp-admin restore` with the archive ID to undo.",
    );
  });

  it("still reports success when the flush after the reset throws", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, seed: SEED });
    s.failUpsertOnce(new Error("db down"));
    await s.run();
    expect(s.reply().text).toContain("**XP Reset Complete**");
    const err = s.logLines.find((l) => l.level === "error")!;
    expect(err.msg).toBe("Flush after reset failed — data archived but DB may be stale");
    expect((err.obj as { err: Error }).err.message).toBe("db down");
  });

  it("does nothing on the second flush when another flush is running (latent, kept)", async () => {
    const s = await setup({ sub: "reset-all", strings, admin: true, seed: SEED });
    // Simulate a periodic flush starting while the reset runs: the command's own flush is then skipped
    const zeroAll = s.xp.resetAllInMemory as unknown as { getMockImplementation: () => (g: string) => number };
    const orig = zeroAll.getMockImplementation();
    vi.mocked(s.xp.resetAllInMemory).mockImplementation((g: string) => {
      (s.xp as unknown as { isFlushing: boolean }).isFlushing = true;
      return orig(g);
    });
    await s.run();
    expect(s.upserts).toEqual([]);
    expect(s.xpLogger.warn).toHaveBeenCalledWith("Flush already in progress, skipping");
    expect(s.xp.getStats().dirtyEntries).toBe(2);
    expect(s.reply().text).toContain("**XP Reset Complete**");
  });

  it("sends an archive write AppError to the user, and other errors to the generic reply", async () => {
    const a = await setup({ sub: "reset-all", strings, admin: true, seed: SEED, createError: new AppError(ErrorCode.VALIDATION_ERROR, "Archive write failed") });
    await a.run();
    expect(a.reply()).toEqual({ text: "Archive write failed", color: RED });
    expect(a.calls).not.toContain("resetAllInMemory");
    expect(a.rootLog.error).not.toHaveBeenCalled();

    const b = await setup({ sub: "reset-all", strings, admin: true, seed: SEED, createError: new Error("insert failed") });
    await b.run();
    expect(b.reply()).toEqual({ text: "Something went wrong.", color: RED });
    expect(b.rootLog.error).toHaveBeenCalledWith({ err: expect.any(Error), sub: "reset-all" }, "Error in /xp-admin");
  });
});

describe("/xp-admin restore", () => {
  const goodData: Entry[] = [
    { discordId: "a", totalXp: 4000, level: 9, messageCount: 50, xpMessageCount: 40, lastMessageAt: 5_000 },
    { discordId: "z", totalXp: 10, level: 0, messageCount: 1, xpMessageCount: 1, lastMessageAt: 0 },
  ];
  const archive = (data: unknown) => ({ id: ARCHIVE_ID, guildId: "g1", archivedBy: "u9", reason: null, data, userCount: 2, totalXpSum: 123456, restoredAt: null, createdAt: new Date() });
  const strings = { confirm: "CONFIRM", archive_id: `  ${ARCHIVE_ID}  ` };

  it("needs Administrator", async () => {
    const s = await setup({ sub: "restore", strings, admin: false, noArchive: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "This command requires **Administrator** permission.", color: RED });
  });

  it("checks the archive system before CONFIRM", async () => {
    const s = await setup({ sub: "restore", strings: { confirm: "nope", archive_id: "x" }, admin: true, noArchive: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "Archive system not available.", color: RED });
  });

  it("needs CONFIRM exactly", async () => {
    const s = await setup({ sub: "restore", strings: { confirm: "nope", archive_id: "x" }, admin: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "You must type `CONFIRM` to restore. This will **overwrite** current XP data.", color: RED });
    expect(s.calls).toEqual(["editReply"]);
  });

  it("rejects a malformed archive ID without a DB read", async () => {
    const s = await setup({ sub: "restore", strings: { confirm: "CONFIRM", archive_id: "abc" }, admin: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "Invalid archive ID format.", color: RED });
    expect(s.calls).toEqual(["editReply"]);
  });

  it("accepts an upper-case ID and reports a missing archive", async () => {
    const s = await setup({ sub: "restore", strings: { confirm: "CONFIRM", archive_id: ARCHIVE_ID.toUpperCase() }, admin: true });
    await s.run();
    expect(s.archiveRepo.findByIdAndGuild).toHaveBeenCalledWith(ARCHIVE_ID.toUpperCase(), "g1");
    expect(s.reply()).toEqual({ text: "Archive not found.", color: RED });
  });

  it("reports archive data that is not an array", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, archive: archive({ a: 1 }) });
    await s.run();
    expect(s.reply()).toEqual({ text: "Archive data is corrupted (not an array).", color: RED });
    expect(s.calls).toEqual(["findByIdAndGuild", "editReply"]);
  });

  it.each([
    ["null item", null],
    ["array item", []],
    ["string id missing", { totalXp: 1, level: 1, messageCount: 1, xpMessageCount: 1, lastMessageAt: 1 }],
    ["totalXp string", { discordId: "x", totalXp: "1", level: 1, messageCount: 1, xpMessageCount: 1, lastMessageAt: 1 }],
    ["level missing", { discordId: "x", totalXp: 1, messageCount: 1, xpMessageCount: 1, lastMessageAt: 1 }],
    ["messageCount null", { discordId: "x", totalXp: 1, level: 1, messageCount: null, xpMessageCount: 1, lastMessageAt: 1 }],
    ["xpMessageCount bool", { discordId: "x", totalXp: 1, level: 1, messageCount: 1, xpMessageCount: true, lastMessageAt: 1 }],
    ["lastMessageAt string", { discordId: "x", totalXp: 1, level: 1, messageCount: 1, xpMessageCount: 1, lastMessageAt: "1" }],
  ])("reports an invalid entry (%s) once, with nothing restored", async (_label, bad) => {
    const s = await setup({ sub: "restore", strings, admin: true, seed: SEED, archive: archive([goodData[0], bad, goodData[1], bad]) });
    await s.run();
    expect(s.reply()).toEqual({ text: "Archive data is corrupted (invalid entry format).", color: RED });
    expect(s.calls).toEqual(["findByIdAndGuild", "editReply"]);
  });

  it("accepts NaN numbers (typeof check only)", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, archive: archive([{ ...goodData[0], totalXp: Number.NaN }]) });
    await s.run();
    expect(s.reply().text).toContain("**XP Restored**");
  });

  it("auto-archives, rehydrates, flushes and marks restored, in that order", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, seed: SEED, archive: archive(goodData) });
    s.xp.resetUser("g1", "b"); // dirty entry: the first flush writes it
    await s.run();
    expect(s.calls).toEqual([
      "findByIdAndGuild",
      "flush",
      "batchUpsert:1",
      "getGuildSnapshot",
      "create",
      "rehydrateGuild",
      "flush",
      "batchUpsert:2",
      "markRestored",
      "editReply",
    ]);
    expect(s.created).toEqual([
      {
        guildId: "g1",
        archivedBy: "u1",
        reason: `Auto-archive before restore of ${ARCHIVE_ID.slice(0, 8)}`,
        data: [
          { discordId: "a", totalXp: 1500, level: 1, messageCount: 3, xpMessageCount: 2, lastMessageAt: 1000 },
          { discordId: "b", totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: 0 },
        ],
        userCount: 2,
        totalXpSum: 1500,
      },
    ]);
    expect(s.archiveRepo.markRestored).toHaveBeenCalledWith(ARCHIVE_ID);
    expect(s.xp.getRank("g1", "a")!.totalXp).toBe(4000);
    expect(s.xp.getRank("g1", "b")!.totalXp).toBe(0);
    expect(s.xp.getRank("g1", "z")!.totalXp).toBe(10);
    expect(s.reply()).toEqual({
      text: `**XP Restored**\n\nRestored **2** users with **123,456** total XP from archive \`${ARCHIVE_ID.slice(0, 8)}...\`.`,
      color: GREEN,
    });
    expect(s.childBindings).toEqual([{ command: "xp-admin", sub: "restore", guildId: "g1", archiveId: ARCHIVE_ID }]);
    expect(s.logLines.map((l) => [l.level, l.obj, l.msg])).toEqual([
      ["info", { users: 2 }, "Auto-archived current XP before restore"],
      ["info", { restored: 2, archiveId: ARCHIVE_ID }, "XP restored from archive"],
    ]);
  });

  it("skips the auto-archive when the server has no XP, and restores an empty archive as 0 users", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, archive: archive([]) });
    await s.run();
    expect(s.calls).toEqual(["findByIdAndGuild", "flush", "getGuildSnapshot", "rehydrateGuild", "flush", "markRestored", "editReply"]);
    expect(s.reply().text).toBe(`**XP Restored**\n\nRestored **0** users with **123,456** total XP from archive \`${ARCHIVE_ID.slice(0, 8)}...\`.`);
  });

  it("does not catch a failing first flush: generic reply, nothing restored", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, seed: SEED, archive: archive(goodData) });
    s.xp.resetUser("g1", "b");
    s.failUpsertOnce(new Error("db down"));
    await s.run();
    expect(s.reply()).toEqual({ text: "Something went wrong.", color: RED });
    expect(s.calls).toEqual(["findByIdAndGuild", "flush", "batchUpsert:1", "editReply"]);
    expect(s.rootLog.error).toHaveBeenCalledWith({ err: expect.any(Error), sub: "restore" }, "Error in /xp-admin");
  });

  it("shows an AppError from the first flush", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, seed: SEED, archive: archive(goodData) });
    s.xp.resetUser("g1", "b");
    s.failUpsertOnce(new AppError(ErrorCode.VALIDATION_ERROR, "DB unavailable"));
    await s.run();
    expect(s.reply()).toEqual({ text: "DB unavailable", color: RED });
    expect(s.rootLog.error).not.toHaveBeenCalled();
  });

  it("still marks restored when the second flush throws", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, archive: archive(goodData) });
    s.failUpsertOnce(new Error("db down"));
    await s.run();
    expect(s.calls).toEqual(["findByIdAndGuild", "flush", "getGuildSnapshot", "rehydrateGuild", "flush", "batchUpsert:2", "markRestored", "editReply"]);
    const err = s.logLines.find((l) => l.level === "error")!;
    expect(err.msg).toBe("Flush after restore failed — data is in memory but may not be persisted");
    expect(err.bindings).toEqual({ command: "xp-admin", sub: "restore", guildId: "g1", archiveId: ARCHIVE_ID });
    expect(s.reply().text).toContain("**XP Restored**");
  });

  it("leaves memory rehydrated when markRestored throws, and replies generically", async () => {
    const s = await setup({ sub: "restore", strings, admin: true, archive: archive(goodData), markRestoredError: new Error("update failed") });
    await s.run();
    expect(s.xp.getRank("g1", "a")!.totalXp).toBe(4000);
    expect(s.reply()).toEqual({ text: "Something went wrong.", color: RED });
  });
});

describe("/xp-admin archives", () => {
  const rows = [
    { id: "aaaaaaaa-1111-4111-8111-111111111111", archivedBy: "u1", userCount: 3, totalXpSum: 12345, restoredAt: new Date(), createdAt: new Date("2026-03-04T12:00:00Z") },
    { id: "bbbbbbbb-2222-4222-8222-222222222222", archivedBy: "u2", userCount: 0, totalXpSum: 0, restoredAt: null, createdAt: new Date("2026-01-02T12:00:00Z") },
  ];

  it("reports a missing archive system", async () => {
    const s = await setup({ sub: "archives", noArchive: true });
    await s.run();
    expect(s.reply()).toEqual({ text: "Archive system not available.", color: RED });
  });

  it("reports no archives", async () => {
    const s = await setup({ sub: "archives" });
    await s.run();
    expect(s.archiveRepo.findByGuild).toHaveBeenCalledWith("g1", 10);
    expect(s.reply()).toEqual({ text: "No XP archives found for this server.", color: YELLOW });
  });

  it("checks the guild object only after reading archives", async () => {
    const s = await setup({ sub: "archives", archives: rows, guild: null });
    await s.run();
    expect(s.calls).toEqual(["findByGuild", "editReply"]);
    expect(s.reply()).toEqual({ text: "Guild not available.", color: RED });
  });

  it("lists archives with archiver names when known", async () => {
    const fetch = vi.fn(async () => new Map([["u1", { displayName: "Alice" }]]));
    const s = await setup({ sub: "archives", archives: rows, guild: { members: { fetch } } });
    await s.run();
    expect(fetch).toHaveBeenCalledWith({ user: ["u1", "u2"] });
    const date1 = new Date("2026-03-04T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const date2 = new Date("2026-01-02T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    expect(s.reply()).toEqual({
      text:
        "**XP Archives**\n\n" +
        `\`aaaaaaaa...\` — ${date1} — 3 users, 12,345 XP — <@u1> (Alice) ✅ restored\n` +
        `\`bbbbbbbb...\` — ${date2} — 0 users, 0 XP — <@u2>`,
      color: YELLOW,
    });
  });
});

describe("/xp-admin reply shape", () => {
  // The other tests compare only description and colour; this pins the whole editReply payload once per embed helper
  const fullReply = (s: Awaited<ReturnType<typeof setup>>) => {
    expect(s.editReply).toHaveBeenCalledTimes(1);
    const arg = s.editReply.mock.calls[0]![0] as { embeds: { toJSON(): unknown }[] };
    return { ...arg, embeds: arg.embeds.map((e) => e.toJSON()) };
  };

  it("sends a single error embed and nothing else", async () => {
    const s = await setup({ sub: "flush", guildId: null });
    await s.run();
    expect(fullReply(s)).toEqual({ embeds: [{ description: "This command can only be used in a server.", color: RED }] });
  });

  it("sends a single success embed and nothing else", async () => {
    const s = await setup({ sub: "flush" });
    await s.run();
    expect(fullReply(s)).toEqual({ embeds: [{ description: "XP data flushed to database.", color: GREEN }] });
  });

  it("sends a single info embed and nothing else", async () => {
    const s = await setup({ sub: "archives" });
    await s.run();
    expect(fullReply(s)).toEqual({ embeds: [{ description: "No XP archives found for this server.", color: YELLOW }] });
  });
});
