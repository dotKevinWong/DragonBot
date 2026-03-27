import type { GuildRepository } from "../repositories/guild.repository.js";
import type { guilds } from "@dragonbot/db";

export class GuildService {
  constructor(private repo: GuildRepository) {}

  async getSettings(guildId: string) {
    return this.repo.findByGuildId(guildId);
  }

  async ensureGuild(guildId: string, guildName: string) {
    return this.repo.upsert(guildId, guildName);
  }

  async updateSettings(guildId: string, settings: Partial<typeof guilds.$inferInsert>) {
    // Ensure guild exists first
    const guild = await this.repo.findByGuildId(guildId);
    if (!guild) {
      await this.repo.upsert(guildId, "Unknown");
    }
    return this.repo.updateSettings(guildId, settings);
  }

  async getAllBanSyncGuilds() {
    return this.repo.findAllWithBanSync();
  }
}
