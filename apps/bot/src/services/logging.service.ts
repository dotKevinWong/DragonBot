import { type Client, type TextChannel, EmbedBuilder } from "discord.js";
import type { GuildRepository } from "../repositories/guild.repository.js";
import type { Logger } from "pino";

export type LogEventType =
  | "member_join"
  | "member_leave"
  | "message_delete"
  | "message_edit"
  | "role_change"
  | "nickname_change"
  | "voice_activity"
  | "kick"
  | "ban";

export class LoggingService {
  constructor(private guildRepo: GuildRepository) {}

  async shouldLog(guildId: string, eventType: LogEventType): Promise<boolean> {
    const guild = await this.guildRepo.findByGuildId(guildId);
    if (!guild) return false;
    if (!guild.isLoggingEnabled) return false;
    if (!guild.logChannelId) return false;
    return guild.logEvents.includes(eventType);
  }

  async sendLogEmbed(
    guildId: string,
    embed: EmbedBuilder,
    client: Client,
    logger: Logger,
  ): Promise<void> {
    const guild = await this.guildRepo.findByGuildId(guildId);
    if (!guild?.logChannelId) return;

    try {
      const channel = await client.channels.fetch(guild.logChannelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({ embeds: [embed] });
      }
    } catch (err) {
      logger.warn({ err, guildId, channelId: guild.logChannelId }, "Failed to send log embed");
    }
  }
}
