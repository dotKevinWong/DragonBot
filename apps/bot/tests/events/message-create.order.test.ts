import { beforeEach, describe, expect, it, vi } from "vitest";
import { Collection, type Message } from "discord.js";
import type { GuildRow } from "@dragonbot/db";
import event from "../../src/events/message-create.js";
import { deleteLateMessage, handleHoneypotMessage } from "../../src/lib/honeypot-enforcer.js";
import { handleRepeatSpamMessage } from "../../src/lib/repeat-spam-enforcer.js";
import type { BotContext } from "../../src/types/context.js";

vi.mock("../../src/lib/honeypot-enforcer.js", () => ({
  handleHoneypotMessage: vi.fn(),
  deleteLateMessage: vi.fn(),
}));

vi.mock("../../src/lib/repeat-spam-enforcer.js", () => ({
  handleRepeatSpamMessage: vi.fn(),
}));

const honeypotCheck = vi.mocked(handleHoneypotMessage);
const lateCheck = vi.mocked(deleteLateMessage);
const repeatCheck = vi.mocked(handleRepeatSpamMessage);

function fakeMessage(): Message {
  return {
    id: "m1",
    content: "hello there everyone",
    author: { id: "u1", bot: false },
    channel: { id: "c1" },
    guild: { id: "g1", members: { fetch: vi.fn() } },
    member: { roles: { cache: new Collection() } },
    inGuild: () => true,
  } as unknown as Message;
}

/** The intro gate is off and XP is on, with no exclusions. */
function setup() {
  const settings = {
    guildId: "g1",
    isIntroGateEnabled: false,
    isXpEnabled: true,
    xpMin: 15,
    xpMax: 25,
    xpCooldownSeconds: 60,
    xpExcludedChannelIds: [],
    xpExcludedRoleIds: [],
    xpLevelupChannelId: null,
  } as unknown as GuildRow;
  const xp = { processMessage: vi.fn(() => null) };
  const guild = { getSettings: vi.fn(async () => settings) };
  const ctx = { logger: { info: vi.fn(), warn: vi.fn() }, services: { guild, xp } } as unknown as BotContext;
  return { settings, xp, ctx };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("messageCreate event: check order", () => {
  it("lets the channel trap handle a message first", async () => {
    const { xp, ctx } = setup();
    honeypotCheck.mockResolvedValue("handled");

    await event.execute(fakeMessage(), ctx);

    expect(lateCheck).not.toHaveBeenCalled();
    expect(repeatCheck).not.toHaveBeenCalled();
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("deletes a late message before the repeated-message check sees it", async () => {
    const { xp, ctx } = setup();
    honeypotCheck.mockResolvedValue("not_honeypot");
    lateCheck.mockResolvedValue(true);

    await event.execute(fakeMessage(), ctx);

    expect(repeatCheck).not.toHaveBeenCalled();
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("runs the repeated-message check before the intro gate and XP", async () => {
    const { settings, xp, ctx } = setup();
    honeypotCheck.mockResolvedValue("not_honeypot");
    lateCheck.mockResolvedValue(false);
    repeatCheck.mockResolvedValue("handled");
    const message = fakeMessage();

    await event.execute(message, ctx);

    expect(repeatCheck).toHaveBeenCalledWith(message, settings, ctx);
    expect(repeatCheck.mock.invocationCallOrder[0]).toBeGreaterThan(lateCheck.mock.invocationCallOrder[0]);
    expect(xp.processMessage).not.toHaveBeenCalled();
  });

  it("carries on to XP when nothing catches the message", async () => {
    const { xp, ctx } = setup();
    honeypotCheck.mockResolvedValue("not_honeypot");
    lateCheck.mockResolvedValue(false);
    repeatCheck.mockResolvedValue("not_caught");

    await event.execute(fakeMessage(), ctx);

    expect(xp.processMessage).toHaveBeenCalledTimes(1);
  });
});
