import type { GuildRepository } from "../repositories/guild.repository.js";
import type { guilds } from "@dragonbot/db";
import { TTLCache } from "../utils/cache.js";

export class GuildService {
  private cache = new TTLCache<Awaited<ReturnType<GuildRepository["findByGuildId"]>>>(86400); // 24h (invalidated on write, TTL is safety net only)

  constructor(private repo: GuildRepository) {}

  /** Load ALL guild settings into cache at startup. After this, getSettings() never hits DB. */
  async hydrateAll(): Promise<number> {
    const allGuilds = await this.repo.findAll();
    for (const guild of allGuilds) {
      this.cache.set(guild.guildId, guild);
    }
    return allGuilds.length;
  }

  async getSettings(guildId: string) {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;

    // Fallback to DB only if not hydrated yet (e.g., during startup race)
    const settings = await this.repo.findByGuildId(guildId);
    if (settings) {
      this.cache.set(guildId, settings);
    }
    return settings;
  }

  async ensureGuild(guildId: string, guildName: string) {
    const result = await this.repo.upsert(guildId, guildName);
    this.cache.invalidate(guildId);
    return result;
  }

  async updateSettings(guildId: string, settings: Partial<typeof guilds.$inferInsert>) {
    // Ensure guild exists first
    const guild = await this.repo.findByGuildId(guildId);
    if (!guild) {
      await this.repo.upsert(guildId, "Unknown");
    }
    const result = await this.repo.updateSettings(guildId, settings);
    // Invalidate cache after update so next read gets fresh data
    this.cache.invalidate(guildId);
    return result;
  }

  async getAllBanSyncGuilds() {
    return this.repo.findAllWithBanSync();
  }

  /** Manually invalidate cache for a guild (e.g., after web dashboard changes) */
  invalidateCache(guildId: string): void {
    this.cache.invalidate(guildId);
  }
}
