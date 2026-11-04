import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "discord.js";
import type { BotContext } from "../../src/types/context.js";

vi.mock("../../src/lib/honeypot-enforcer.js", () => ({
  handleHoneypotMessage: vi.fn(async () => "not-handled"),
  deleteLateMessage: vi.fn(async () => false),
}));

const validateIntroduction = vi.fn((_content: string, _options: unknown) => ({ valid: true, reason: "" }));
vi.mock("../../src/utils/intro-validator.js", () => ({
  validateIntroduction: (content: string, options: unknown) => validateIntroduction(content, options),
}));

const { default: event } = await import("../../src/events/message-create.js");

const INTRO_CHANNEL = "intro";
const GENERAL_CHANNEL = "general";

/**
 * u1 posts `content` in `channelId` of g1. Intro gating and XP are both on, and processMessage
 * reports a level-up. Discord and the services are fakes.
 */
function setup(options: { channelId?: string; deleteError?: Error } = {}) {
  const member = { roles: { cache: new Map<string, unknown>(), add: vi.fn(async () => undefined) } };
  const levelUpChannel = { isTextBased: () => true, send: vi.fn(async () => undefined) };
  const message = {
    content: "hello there",
    author: { id: "u1", bot: false, displayName: "User One", send: vi.fn(async () => undefined) },
    inGuild: () => true,
    guild: {
      id: "g1",
      name: "Guild One",
      members: { fetch: vi.fn(async () => member) },
      channels: { fetch: vi.fn(async () => levelUpChannel) },
    },
    channel: { id: options.channelId ?? INTRO_CHANNEL },
    member,
    delete: vi.fn(async () => {
      if (options.deleteError) throw options.deleteError;
    }),
  } as unknown as Message;
  const settings = {
    isIntroGateEnabled: true,
    introChannelId: INTRO_CHANNEL,
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
    xpLevelupChannelId: null,
  };
  const xp = { processMessage: vi.fn(() => ({ leveledUp: true, newLevel: 2 })) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const ctx = {
    logger,
    services: { guild: { getSettings: vi.fn(async () => settings) }, xp },
  } as unknown as BotContext;
  return { message, member, levelUpChannel, xp, logger, ctx };
}

beforeEach(() => {
  validateIntroduction.mockReset();
  validateIntroduction.mockReturnValue({ valid: true, reason: "" });
});

describe("messageCreate event", () => {
  it("gives no XP and posts no level-up for a rejected intro", async () => {
    validateIntroduction.mockReturnValue({ valid: false, reason: "Too short." });
    const { message, levelUpChannel, xp, ctx } = setup();

    await event.execute(message, ctx);

    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(message.author.send).toHaveBeenCalledTimes(1);
    expect(xp.processMessage).not.toHaveBeenCalled();
    expect(levelUpChannel.send).not.toHaveBeenCalled();
  });

  it("gives no XP for a rejected intro even if deleting it fails", async () => {
    // The intro was rejected either way; a message that is still visible because the delete
    // failed is still a rejected intro, so it earns nothing.
    validateIntroduction.mockReturnValue({ valid: false, reason: "Too short." });
    const { message, levelUpChannel, xp, logger, ctx } = setup({ deleteError: new Error("Missing Permissions") });

    await event.execute(message, ctx);

    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "Failed to delete rejected intro message");
    expect(message.author.send).toHaveBeenCalledTimes(1);
    expect(xp.processMessage).not.toHaveBeenCalled();
    expect(levelUpChannel.send).not.toHaveBeenCalled();
  });

  it("still gives XP for an accepted intro", async () => {
    const { message, member, levelUpChannel, xp, ctx } = setup();

    await event.execute(message, ctx);

    expect(member.roles.add).toHaveBeenCalledWith("intro-role");
    expect(message.delete).not.toHaveBeenCalled();
    expect(xp.processMessage).toHaveBeenCalledTimes(1);
    expect(levelUpChannel.send).toHaveBeenCalledTimes(1);
  });

  it("gives XP outside the intro channel without validating", async () => {
    validateIntroduction.mockReturnValue({ valid: false, reason: "Too short." });
    const { message, levelUpChannel, xp, ctx } = setup({ channelId: GENERAL_CHANNEL });

    await event.execute(message, ctx);

    expect(validateIntroduction).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
    expect(xp.processMessage).toHaveBeenCalledWith("g1", "u1", expect.objectContaining({ xpMin: 15, xpMax: 25 }));
    expect(levelUpChannel.send).toHaveBeenCalledTimes(1);
  });
});
