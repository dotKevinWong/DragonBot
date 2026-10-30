import { describe, it, expect, vi } from "vitest";
import { EmbedBuilder, type Client } from "discord.js";
import type { Logger } from "pino";
import { LoggingService } from "../../src/services/logging.service.js";
import type { GuildService } from "../../src/services/guild.service.js";

/** Server g1's settings are `settings`. Its log channel resolves to a text channel in `channelGuildId`. */
function setup(settings: Record<string, unknown> | null, sendError?: Error, channelGuildId = "g1") {
  const guildService = { getSettings: vi.fn().mockResolvedValue(settings) };
  const send = sendError ? vi.fn().mockRejectedValue(sendError) : vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue({ guildId: channelGuildId, isDMBased: () => false, isTextBased: () => true, send });
  const client = { channels: { fetch } } as unknown as Client;
  const logger = { warn: vi.fn() } as unknown as Logger;
  const service = new LoggingService(guildService as unknown as GuildService);
  return { service, send, fetch, client, logger };
}

describe("LoggingService.sendNotice", () => {
  it("sends a notice whenever logging is on with a log channel, whatever the event toggles", async () => {
    const { service, send, fetch, client, logger } = setup({ isLoggingEnabled: true, logChannelId: "log1", logEvents: [] });

    await service.sendNotice("g1", "Couldn't pin the warning in <#c1>.", client, logger);

    expect(fetch).toHaveBeenCalledWith("log1");
    expect(send).toHaveBeenCalledTimes(1);
    const embed = (send.mock.calls[0][0] as { embeds: EmbedBuilder[] }).embeds[0].toJSON();
    expect(embed.title).toBe("Honeypot");
    expect(embed.color).toBe(0xf0b232);
    expect(embed.description).toBe("Couldn't pin the warning in <#c1>.");
    expect(embed.timestamp).toBeDefined();
  });

  it("sends no notice when logging is off or no log channel is set", async () => {
    const withEveryToggle = ["message_delete", "kick", "ban"];
    const cases = [
      { isLoggingEnabled: false, logChannelId: "log1", logEvents: withEveryToggle },
      { isLoggingEnabled: true, logChannelId: null, logEvents: withEveryToggle },
      null, // no settings row for the server
    ];

    for (const settings of cases) {
      const { service, send, fetch, client, logger } = setup(settings);

      await service.sendNotice("g1", "Couldn't pin the warning in <#c1>.", client, logger);

      expect(send).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("does not throw when the log channel can't take the notice", async () => {
    const { service, client, logger } = setup(
      { isLoggingEnabled: true, logChannelId: "log1", logEvents: [] },
      new Error("Missing Access"),
    );

    await expect(service.sendNotice("g1", "Couldn't pin the warning in <#c1>.", client, logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("LoggingService.sendLogEmbed", () => {
  it("never sends to a log channel in another server", async () => {
    // A dashboard manager of g1 set g1's log channel to a channel ID from g2.
    const { service, send, client, logger } = setup({ isLoggingEnabled: true, logChannelId: "log1" }, undefined, "g2");

    await service.sendLogEmbed("g1", new EmbedBuilder().setTitle("Message Deleted"), client, logger);

    expect(send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", channelId: "log1", channelGuildId: "g2" }),
      expect.any(String),
    );
  });

  it("sends to a log channel in the same server", async () => {
    const { service, send, client, logger } = setup({ isLoggingEnabled: true, logChannelId: "log1" });

    await service.sendLogEmbed("g1", new EmbedBuilder().setTitle("Message Deleted"), client, logger);

    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
