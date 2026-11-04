import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedBuilder, Message } from "discord.js";
import type { BotContext } from "../../src/types/context.js";

/**
 * Characterization of the whole messageCreate pipeline: the order of its steps, its early returns, which member
 * lookup each step makes, the exact log lines and the exact embeds. Discord and the services are fakes.
 */

const handleHoneypotMessage = vi.fn(async (..._args: unknown[]) => "not-handled");
const deleteLateMessage = vi.fn(async (..._args: unknown[]) => false);
vi.mock("../../src/lib/honeypot-enforcer.js", () => ({
  handleHoneypotMessage: (...args: unknown[]) => handleHoneypotMessage(...args),
  deleteLateMessage: (...args: unknown[]) => deleteLateMessage(...args),
}));

const validateIntroduction = vi.fn((_content: string, _options: unknown) => ({ valid: true, reason: "" }));
vi.mock("../../src/utils/intro-validator.js", () => ({
  validateIntroduction: (content: string, options: unknown) => validateIntroduction(content, options),
}));

const { default: event } = await import("../../src/events/message-create.js");

interface Options {
  channelId?: string;
  content?: string;
  bot?: boolean;
  inGuild?: boolean;
  messageMember?: "same" | null;
  memberRoles?: string[];
  memberFetchError?: Error;
  dmError?: Error;
  channelFetchError?: Error;
  levelUpChannelText?: boolean;
  settings?: Record<string, unknown> | null;
  xpResult?: { leveledUp: boolean; newLevel: number } | null;
}

function setup(options: Options = {}) {
  const member = {
    roles: { cache: new Map((options.memberRoles ?? []).map((id) => [id, {}])), add: vi.fn(async () => undefined) },
  };
  const levelUpChannel = {
    isTextBased: () => options.levelUpChannelText ?? true,
    send: vi.fn(async (_payload: { embeds: EmbedBuilder[] }) => undefined),
  };
  const membersFetch = vi.fn(async (_id: string) => {
    if (options.memberFetchError) throw options.memberFetchError;
    return member;
  });
  const channelsFetch = vi.fn(async (_id: string) => {
    if (options.channelFetchError) throw options.channelFetchError;
    return levelUpChannel;
  });
  const message = {
    content: options.content ?? "hello there",
    author: {
      id: "u1",
      bot: options.bot ?? false,
      displayName: "User One",
      send: vi.fn(async (_payload: { embeds: EmbedBuilder[] }) => {
        if (options.dmError) throw options.dmError;
      }),
    },
    inGuild: () => options.inGuild ?? true,
    guild: { id: "g1", name: "Guild One", members: { fetch: membersFetch }, channels: { fetch: channelsFetch } },
    channel: { id: options.channelId ?? "intro" },
    member: options.messageMember === null ? null : member,
    delete: vi.fn(async () => undefined),
  } as unknown as Message;
  const settings =
    options.settings === null
      ? null
      : {
          isIntroGateEnabled: true,
          introChannelId: "intro",
          introRoleId: "intro-role",
          introMinChars: 10,
          introMinWords: 2,
          introMinSubstantiveWords: 1,
          introUniqueWordRatio: 0.5,
          introMaxRepeatedCharPct: 50,
          isXpEnabled: true,
          xpExcludedChannelIds: [] as string[],
          xpExcludedRoleIds: [] as string[],
          xpMin: 15,
          xpMax: 25,
          xpCooldownSeconds: 60,
          xpLevelupChannelId: null as string | null,
          ...options.settings,
        };
  const xp = {
    processMessage: vi.fn((..._args: unknown[]) =>
      options.xpResult === undefined ? { leveledUp: true, newLevel: 2 } : options.xpResult,
    ),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const getSettings = vi.fn(async (_id: string) => settings);
  const ctx = { logger, services: { guild: { getSettings }, xp } } as unknown as BotContext;
  return { message, member, membersFetch, channelsFetch, levelUpChannel, xp, logger, getSettings, settings, ctx };
}

function json(embed: EmbedBuilder) {
  const out = embed.toJSON();
  expect(out.timestamp === undefined || typeof out.timestamp === "string").toBe(true);
  delete out.timestamp;
  return out;
}

beforeEach(() => {
  validateIntroduction.mockReset();
  validateIntroduction.mockReturnValue({ valid: true, reason: "" });
  handleHoneypotMessage.mockReset();
  handleHoneypotMessage.mockResolvedValue("not-handled");
  deleteLateMessage.mockReset();
  deleteLateMessage.mockResolvedValue(false);
});

describe("messageCreate pipeline", () => {
  it("ignores bots, DMs and unknown servers before anything else", async () => {
    const bot = setup({ bot: true });
    await event.execute(bot.message, bot.ctx);
    expect(bot.getSettings).not.toHaveBeenCalled();

    const dm = setup({ inGuild: false });
    await event.execute(dm.message, dm.ctx);
    expect(dm.getSettings).not.toHaveBeenCalled();

    const unknown = setup({ settings: null });
    await event.execute(unknown.message, unknown.ctx);
    expect(unknown.getSettings).toHaveBeenCalledWith("g1");
    expect(handleHoneypotMessage).not.toHaveBeenCalled();
  });

  it("stops after the honeypot handles the message", async () => {
    handleHoneypotMessage.mockResolvedValue("handled");
    const { message, settings, ctx, xp } = setup();

    await event.execute(message, ctx);

    expect(handleHoneypotMessage).toHaveBeenCalledWith(message, settings, ctx);
    expect(deleteLateMessage).not.toHaveBeenCalled();
    expect(validateIntroduction).not.toHaveBeenCalled();
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("stops after deleting a late message", async () => {
    deleteLateMessage.mockResolvedValue(true);
    const { message, ctx, xp } = setup();

    await event.execute(message, ctx);

    expect(deleteLateMessage).toHaveBeenCalledWith(message, ctx);
    expect(validateIntroduction).not.toHaveBeenCalled();
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("validates an intro with the server's limits and fetches the member even when the message has one", async () => {
    const { message, member, membersFetch, logger, ctx } = setup();

    await event.execute(message, ctx);

    expect(validateIntroduction).toHaveBeenCalledWith("hello there", {
      minChars: 10,
      minWords: 2,
      minSubstantiveWords: 1,
      uniqueWordRatio: 0.5,
      maxRepeatedCharPct: 50,
    });
    expect(membersFetch).toHaveBeenCalledWith("u1");
    expect(member.roles.add).toHaveBeenCalledWith("intro-role");
    expect(logger.info).toHaveBeenCalledWith({ guildId: "g1", userId: "u1" }, "Intro role assigned");
  });

  it("doesn't re-add an intro role the member already holds", async () => {
    const { message, member, logger, ctx } = setup({ memberRoles: ["intro-role"] });

    await event.execute(message, ctx);

    expect(member.roles.add).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("warns when the intro role can't be assigned, and still gives XP", async () => {
    const err = new Error("Unknown Member");
    const { message, logger, xp, ctx } = setup({ memberFetchError: err });

    await event.execute(message, ctx);

    expect(logger.warn).toHaveBeenCalledWith({ err }, "Failed to assign intro role");
    // XP uses message.member, so the failed fetch doesn't stop it.
    expect(xp.processMessage).toHaveBeenCalledTimes(1);
  });

  it("skips the intro gate when any of its settings is missing", async () => {
    for (const missing of [
      { isIntroGateEnabled: false },
      { introChannelId: null },
      { introRoleId: null },
    ]) {
      const { message, ctx } = setup({ settings: missing });
      await event.execute(message, ctx);
    }
    expect(validateIntroduction).not.toHaveBeenCalled();
  });

  it("DMs the rejection with the exact embed, truncating long messages", async () => {
    validateIntroduction.mockReturnValue({ valid: false, reason: "Too short." });
    const long = setup({ content: "a".repeat(1001) });
    await event.execute(long.message, long.ctx);

    const empty = setup({ content: "" });
    await event.execute(empty.message, empty.ctx);

    const embeds = [long, empty].map((s) => json(vi.mocked(s.message.author.send).mock.calls[0][0].embeds[0]));
    expect(embeds).toMatchSnapshot();
    expect(vi.mocked(long.message.author.send).mock.calls[0][0].embeds[0].toJSON().timestamp).toEqual(expect.any(String));
  });

  it("warns when the rejection DM fails", async () => {
    validateIntroduction.mockReturnValue({ valid: false, reason: "Too short." });
    const err = new Error("Cannot send messages to this user");
    const { message, logger, xp, ctx } = setup({ dmError: err });

    await event.execute(message, ctx);

    expect(logger.warn).toHaveBeenCalledWith({ err, userId: "u1" }, "Failed to DM user about rejected intro");
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("deletes before it DMs", async () => {
    validateIntroduction.mockReturnValue({ valid: false, reason: "Too short." });
    const { message, ctx } = setup();

    await event.execute(message, ctx);

    expect(vi.mocked(message.delete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(message.author.send).mock.invocationCallOrder[0],
    );
  });

  it("gives no XP in an excluded channel, without looking up the member", async () => {
    const { message, membersFetch, xp, ctx } = setup({
      channelId: "general",
      messageMember: null,
      settings: { xpExcludedChannelIds: ["general"] },
    });

    await event.execute(message, ctx);

    expect(membersFetch).not.toHaveBeenCalled();
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("gives no XP to a member with an excluded role", async () => {
    const { message, xp, ctx } = setup({ channelId: "general", memberRoles: ["muted"], settings: { xpExcludedRoleIds: ["muted"] } });

    await event.execute(message, ctx);

    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("uses message.member for XP without fetching, and fetches only when it's missing", async () => {
    const cached = setup({ channelId: "general" });
    await event.execute(cached.message, cached.ctx);
    expect(cached.membersFetch).not.toHaveBeenCalled();

    const uncached = setup({ channelId: "general", messageMember: null });
    await event.execute(uncached.message, uncached.ctx);
    expect(uncached.membersFetch).toHaveBeenCalledWith("u1");
    expect(uncached.xp.processMessage).toHaveBeenCalledTimes(1);
  });

  it("silently skips XP when the member can't be fetched", async () => {
    const { message, logger, xp, ctx } = setup({
      channelId: "general",
      messageMember: null,
      memberFetchError: new Error("Unknown Member"),
    });

    await event.execute(message, ctx);

    expect(xp.processMessage).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("passes the server's XP rates to processMessage", async () => {
    // Exclusions are applied here, before processMessage, which never read them.
    const { message, xp, ctx } = setup({ channelId: "general" });

    await event.execute(message, ctx);

    expect(xp.processMessage).toHaveBeenCalledWith("g1", "u1", {
      xpMin: 15,
      xpMax: 25,
      xpCooldownSeconds: 60,
    });
  });

  it("gives no XP when XP is off", async () => {
    const { message, xp, ctx } = setup({ channelId: "general", settings: { isXpEnabled: false } });

    await event.execute(message, ctx);

    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("posts the exact level-up embed in the message's channel by default", async () => {
    const { message, channelsFetch, levelUpChannel, ctx } = setup({ channelId: "general" });

    await event.execute(message, ctx);

    expect(channelsFetch).toHaveBeenCalledWith("general");
    expect(levelUpChannel.send).toHaveBeenCalledTimes(1);
    expect(json(levelUpChannel.send.mock.calls[0][0].embeds[0])).toMatchSnapshot();
  });

  it("posts level-ups in the configured channel, even an empty-string one", async () => {
    const set = setup({ channelId: "general", settings: { xpLevelupChannelId: "levels" } });
    await event.execute(set.message, set.ctx);
    expect(set.channelsFetch).toHaveBeenCalledWith("levels");

    // ?? not ||: an empty string is kept.
    const blank = setup({ channelId: "general", settings: { xpLevelupChannelId: "" } });
    await event.execute(blank.message, blank.ctx);
    expect(blank.channelsFetch).toHaveBeenCalledWith("");
  });

  it("posts no level-up without one, or to a channel that isn't text", async () => {
    const none = setup({ channelId: "general", xpResult: null });
    await event.execute(none.message, none.ctx);
    expect(none.channelsFetch).not.toHaveBeenCalled();

    const noLevel = setup({ channelId: "general", xpResult: { leveledUp: false, newLevel: 1 } });
    await event.execute(noLevel.message, noLevel.ctx);
    expect(noLevel.channelsFetch).not.toHaveBeenCalled();

    const voice = setup({ channelId: "general", levelUpChannelText: false });
    await event.execute(voice.message, voice.ctx);
    expect(voice.levelUpChannel.send).not.toHaveBeenCalled();
  });

  it("warns when the level-up can't be posted", async () => {
    const err = new Error("Missing Access");
    const { message, logger, ctx } = setup({ channelId: "general", channelFetchError: err });

    await event.execute(message, ctx);

    expect(logger.warn).toHaveBeenCalledWith({ err }, "Failed to send level-up message");
  });
});
