import type { Client, GuildTextBasedChannel } from "discord.js";
import type { Logger } from "pino";

/**
 * Fetches a text channel named in a server's settings, but only if it belongs to that server.
 * Settings hold bare channel IDs and `client.channels.fetch` finds a channel in any server DragonBot is in,
 * so without this check one server's messages could land in another server's channel.
 * Returns null for a missing, DM or non-text channel. Fetch errors propagate, so each caller keeps its own handling.
 */
export async function fetchGuildTextChannel(
  client: Client,
  guildId: string,
  channelId: string,
  logger: Logger,
): Promise<GuildTextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.isDMBased() || !channel.isTextBased()) return null;

  if (channel.guildId !== guildId) {
    logger.warn(
      { guildId, channelId, channelGuildId: channel.guildId },
      "Configured channel is in another server, so nothing was sent",
    );
    return null;
  }

  return channel;
}
