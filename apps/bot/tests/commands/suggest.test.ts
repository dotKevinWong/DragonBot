import { describe, it, expect, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import command from "../../src/commands/suggest.js";
import type { BotContext } from "../../src/types/context.js";

/** u1 runs /suggest in server g1. g1's mod notes channel c1 resolves to a text channel in `channelGuildId`. */
function setup(channelGuildId: string) {
  const posted = { react: vi.fn(async () => undefined) };
  const send = vi.fn(async (_content: unknown) => posted);
  const fetch = vi.fn(async (_channelId: string) => ({
    id: "c1",
    guildId: channelGuildId,
    isDMBased: () => false,
    isTextBased: () => true,
    send,
  }));
  const interaction = {
    guildId: "g1",
    options: { getString: vi.fn(() => "Open the lab on Sundays") },
    user: { id: "u1", tag: "u1#0001" },
    editReply: vi.fn(async () => undefined),
    client: { channels: { fetch } },
  } as unknown as ChatInputCommandInteraction;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    logger,
    services: {
      suggestion: { create: vi.fn(async () => ({ id: 7 })) },
      guild: { getSettings: vi.fn(async (_guildId: string) => ({ modNotesChannelId: "c1" })) },
    },
  } as unknown as BotContext;
  return { interaction, ctx, send, logger };
}

describe("/suggest", () => {
  it("never posts a suggestion to a mod notes channel in another server", async () => {
    const { interaction, ctx, send, logger } = setup("g2");

    await command.execute(interaction, ctx);

    expect(send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", channelId: "c1", channelGuildId: "g2" }),
      expect.any(String),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("posts a suggestion to a mod notes channel in the same server", async () => {
    const { interaction, ctx, send, logger } = setup("g1");

    await command.execute(interaction, ctx);

    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
