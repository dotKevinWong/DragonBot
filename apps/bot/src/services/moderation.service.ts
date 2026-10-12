import { DiscordAPIError, RESTJSONErrorCodes, type Client } from "discord.js";
import type { GuildService } from "./guild.service.js";
import type { Logger } from "pino";

export class ModerationService {
  constructor(private guildService: GuildService) {}

  async syncBan(
    userId: string,
    sourceGuildId: string,
    client: Client,
    logger: Logger,
  ): Promise<number> {
    const banSyncGuilds = await this.guildService.getAllBanSyncGuilds();
    let bannedCount = 0;

    for (const guildConfig of banSyncGuilds) {
      if (guildConfig.guildId === sourceGuildId) continue;

      try {
        const guild = await client.guilds.fetch(guildConfig.guildId);
        await guild.members.ban(userId, { reason: `Ban sync from guild ${sourceGuildId}` });
        bannedCount++;
        logger.info({ userId, guildId: guildConfig.guildId }, "Ban synced to guild");
      } catch (err) {
        // The bot was removed from this guild (or it was deleted) — stop trying to sync to it
        if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownGuild) {
          await this.guildService.disableBanSync(guildConfig.guildId);
          logger.info(
            { userId, guildId: guildConfig.guildId },
            "Bot is no longer in guild — disabled ban sync for it",
          );
          continue;
        }
        logger.warn(
          { err, userId, guildId: guildConfig.guildId },
          "Failed to sync ban to guild",
        );
      }
    }

    return bannedCount;
  }
}
