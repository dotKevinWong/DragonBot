import { type Client, EmbedBuilder } from "discord.js";
import type { GuildService } from "./guild.service.js";
import type { Logger } from "pino";
import { fetchGuildTextChannel } from "../utils/guild-channel.js";

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
  constructor(private guildService: GuildService) {}

  async shouldLog(guildId: string, eventType: LogEventType): Promise<boolean> {
    const guild = await this.guildService.getSettings(guildId);
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
    const guild = await this.guildService.getSettings(guildId);
    if (!guild?.logChannelId) return;

    try {
      const channel = await fetchGuildTextChannel(client, guildId, guild.logChannelId, logger);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      logger.warn({ err, guildId, channelId: guild.logChannelId }, "Failed to send log embed");
    }
  }

  /**
   * Sends a honeypot notice whenever logging is on and a log channel is set, whatever the event toggles.
   * A server that logs bans but not deletions still has to hear that someone is stuck banned.
   */
  async sendNotice(guildId: string, description: string, client: Client, logger: Logger): Promise<void> {
    const guild = await this.guildService.getSettings(guildId);
    if (!guild?.isLoggingEnabled || !guild.logChannelId) return;

    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle("Honeypot")
      .setDescription(description)
      .setTimestamp();

    await this.sendLogEmbed(guildId, embed, client, logger);
  }
}
