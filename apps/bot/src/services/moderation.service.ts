import type { Client } from "discord.js";
import type { GuildRepository } from "../repositories/guild.repository.js";
import type { UserRepository } from "../repositories/user.repository.js";
import type { Logger } from "pino";

export class ModerationService {
  constructor(
    private guildRepo: GuildRepository,
    private userRepo: UserRepository,
  ) {}

  async syncBan(
    userId: string,
    sourceGuildId: string,
    client: Client,
    logger: Logger,
  ): Promise<number> {
    await this.userRepo.markBanned(userId, sourceGuildId);

    const banSyncGuilds = await this.guildRepo.findAllWithBanSync();
    let bannedCount = 0;

    for (const guildConfig of banSyncGuilds) {
      if (guildConfig.guildId === sourceGuildId) continue;

      try {
        const guild = await client.guilds.fetch(guildConfig.guildId);
        await guild.members.ban(userId, { reason: `Ban sync from guild ${sourceGuildId}` });
        bannedCount++;
        logger.info({ userId, guildId: guildConfig.guildId }, "Ban synced to guild");
      } catch (err) {
        logger.warn(
          { err, userId, guildId: guildConfig.guildId },
          "Failed to sync ban to guild",
        );
      }
    }

    return bannedCount;
  }
}
