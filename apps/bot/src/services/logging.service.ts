import { type Client, EmbedBuilder } from "discord.js";
import type { GuildService } from "./guild.service.js";
import type { Logger } from "pino";
import { fetchGuildTextChannel } from "../utils/guild-channel.js";
import type { LogEventType } from "@dragonbot/db";

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
    await this.sendToLogChannel(guildId, guild.logChannelId, embed, client, logger);
  }

  /**
   * Sends a honeypot embed whenever logging is on and a log channel is set, whatever the event toggles.
   * A server that logs bans but not deletions still has to hear that someone is stuck banned.
   */
  async sendHoneypotEmbed(guildId: string, embed: EmbedBuilder, client: Client, logger: Logger): Promise<void> {
    const guild = await this.guildService.getSettings(guildId);
    if (!guild?.isLoggingEnabled || !guild.logChannelId) return;
    await this.sendToLogChannel(guildId, guild.logChannelId, embed, client, logger);
  }

  /** Sends a honeypot notice, under the same rule as sendHoneypotEmbed. */
  async sendNotice(guildId: string, description: string, client: Client, logger: Logger): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle("Honeypot")
      .setDescription(description)
      .setTimestamp();

    await this.sendHoneypotEmbed(guildId, embed, client, logger);
  }

  /** Never throws: a failed send is logged at warn. */
  private async sendToLogChannel(
    guildId: string,
    logChannelId: string,
    embed: EmbedBuilder,
    client: Client,
    logger: Logger,
  ): Promise<void> {
    try {
      const channel = await fetchGuildTextChannel(client, guildId, logChannelId, logger);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      logger.warn({ err, guildId, channelId: logChannelId }, "Failed to send log embed");
    }
  }
}
