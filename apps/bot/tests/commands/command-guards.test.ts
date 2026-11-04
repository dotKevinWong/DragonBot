import { describe, it, expect, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import type { BotCommand } from "../../src/types/commands.js";
import type { BotContext } from "../../src/types/context.js";
import { AppError, ErrorCode } from "../../src/types/errors.js";
import admin from "../../src/commands/admin.js";
import ask from "../../src/commands/ask.js";
import birthday from "../../src/commands/birthday.js";
import leaderboard from "../../src/commands/leaderboard.js";
import membercount from "../../src/commands/membercount.js";
import nextBirthdays from "../../src/commands/next-birthdays.js";
import offtopic from "../../src/commands/offtopic.js";
import rank from "../../src/commands/rank.js";
import schedule from "../../src/commands/schedule.js";
import suggest from "../../src/commands/suggest.js";
import verify from "../../src/commands/verify.js";
import whois from "../../src/commands/whois.js";
import xpAdmin from "../../src/commands/xp-admin.js";

// Pins the "server only" guard and the AppError catch shared by several commands.

const SERVER_ONLY = "This command can only be used in a server.";

/** A ctx whose every property read is recorded, so a test can check that the guard touches nothing. */
function recordingCtx() {
  const touched: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      touched.push(String(prop));
      return new Proxy(() => undefined, handler);
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as BotContext, touched };
}

function guardInteraction(guildId: string | null, guild: unknown) {
  const editReply = vi.fn(async (_arg: unknown) => undefined);
  const interaction = {
    guildId,
    guild,
    user: { id: "u1" },
    options: { getSubcommand: () => "list", getString: () => "x", getUser: () => null, getInteger: () => null },
    editReply,
    reply: vi.fn(),
    followUp: vi.fn(),
  } as unknown as ChatInputCommandInteraction;
  return { interaction, editReply };
}

function onlyReply(editReply: ReturnType<typeof vi.fn>) {
  expect(editReply).toHaveBeenCalledTimes(1);
  const arg = editReply.mock.calls[0]![0] as Record<string, unknown> & { embeds: { data: Record<string, unknown> }[] };
  expect(Object.keys(arg)).toEqual(["embeds"]);
  expect(arg.embeds).toHaveLength(1);
  return arg.embeds[0]!.data;
}

describe("server-only guard", () => {
  const byGuildId: [string, BotCommand][] = [
    ["admin", admin],
    ["ask", ask],
    ["leaderboard", leaderboard],
    ["next-birthdays", nextBirthdays],
    ["offtopic", offtopic],
    ["rank", rank],
    ["schedule", schedule],
    ["suggest", suggest],
    ["verify", verify],
    ["xp-admin", xpAdmin],
  ];

  it.each(byGuildId)("/%s refuses when there is no guildId and touches nothing", async (_name, command) => {
    const { interaction, editReply } = guardInteraction(null, { name: "cached" });
    const { ctx, touched } = recordingCtx();
    await command.execute(interaction, ctx);
    expect(onlyReply(editReply)).toEqual({ color: 0xff0000, description: SERVER_ONLY });
    expect(touched).toEqual([]);
  });

  it("/membercount refuses when the guild is not cached, even with a guildId", async () => {
    const { interaction, editReply } = guardInteraction("g1", null);
    const { ctx, touched } = recordingCtx();
    await membercount.execute(interaction, ctx);
    expect(onlyReply(editReply)).toEqual({ color: 0xff0000, description: SERVER_ONLY });
    expect(touched).toEqual([]);
  });

  it("/next-birthdays refuses when the guild is not cached, even with a guildId", async () => {
    const { interaction, editReply } = guardInteraction("g1", null);
    const { ctx, touched } = recordingCtx();
    await nextBirthdays.execute(interaction, ctx);
    expect(onlyReply(editReply)).toEqual({ color: 0xff0000, description: SERVER_ONLY });
    expect(touched).toEqual([]);
  });

  it("/membercount checks only the guild object, not guildId", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("stop here");
    });
    const { interaction, editReply } = guardInteraction(null, { members: { fetch } });
    const { ctx } = recordingCtx();
    await expect(membercount.execute(interaction, ctx)).rejects.toThrow("stop here");
    expect(editReply).not.toHaveBeenCalled();
  });
});

describe("AppError catch", () => {
  type Case = {
    name: string;
    command: BotCommand;
    sub?: string;
    /** Service path that throws */
    throwAt: (services: Record<string, Record<string, unknown>>, err: Error) => void;
    /** Whether the command logs through a child logger */
    child: boolean;
    msg: string;
    extra?: Record<string, unknown>;
  };
  const cases: Case[] = [
    {
      name: "whois",
      command: whois,
      throwAt: (s, e) => (s.user!.getProfile = vi.fn(async () => { throw e; })),
      child: false,
      msg: "Error in /whois",
    },
    {
      name: "birthday",
      command: birthday,
      sub: "remove",
      throwAt: (s, e) => (s.birthday!.removeBirthday = vi.fn(async () => { throw e; })),
      child: true,
      msg: "Unhandled error in /birthday",
    },
    {
      name: "verify",
      command: verify,
      sub: "email",
      throwAt: (s, e) => (s.verification!.initiateVerification = vi.fn(async () => { throw e; })),
      child: true,
      msg: "Unhandled error in /verify",
    },
    {
      name: "suggest",
      command: suggest,
      throwAt: (s, e) => (s.suggestion!.create = vi.fn(async () => { throw e; })),
      child: false,
      msg: "Error in /suggest",
    },
    {
      name: "xp-admin",
      command: xpAdmin,
      sub: "status",
      throwAt: (s, e) => (s.guild!.getSettings = vi.fn(async () => { throw e; })),
      child: false,
      msg: "Error in /xp-admin",
      extra: { sub: "status" },
    },
  ];

  function setup(c: Case, err: Error) {
    const editReply = vi.fn(async (_arg: unknown) => undefined);
    const interaction = {
      guildId: "g1",
      guild: null,
      user: { id: "u1", tag: "u1#0001" },
      memberPermissions: { has: () => true },
      options: {
        getSubcommand: () => c.sub,
        getString: () => "someone@example.edu",
        getUser: () => null,
      },
      editReply,
    } as unknown as ChatInputCommandInteraction;
    const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn(() => childLog) };
    const services: Record<string, Record<string, unknown>> = {
      user: {},
      birthday: {},
      verification: {},
      suggestion: {},
      guild: {},
      xp: {},
    };
    c.throwAt(services, err);
    const ctx = { logger, services } as unknown as BotContext;
    return { interaction, ctx, editReply, log: c.child ? childLog : logger, other: c.child ? logger : childLog };
  }

  describe.each(cases)("/$name", (c) => {
    it("shows an AppError's message and logs nothing", async () => {
      const s = setup(c, new AppError(ErrorCode.VALIDATION_ERROR, "Nope, not like that."));
      await c.command.execute(s.interaction, s.ctx);
      expect(onlyReply(s.editReply)).toEqual({ color: 0xff0000, description: "Nope, not like that." });
      expect(s.log.error).not.toHaveBeenCalled();
      expect(s.other.error).not.toHaveBeenCalled();
    });

    it("logs any other error, then replies 'Something went wrong.'", async () => {
      const boom = new Error("boom");
      const s = setup(c, boom);
      await c.command.execute(s.interaction, s.ctx);
      expect(onlyReply(s.editReply)).toEqual({ color: 0xff0000, description: "Something went wrong." });
      expect(s.log.error).toHaveBeenCalledTimes(1);
      expect(s.log.error).toHaveBeenCalledWith({ err: boom, ...c.extra }, c.msg);
      expect(s.other.error).not.toHaveBeenCalled();
    });
  });
});
