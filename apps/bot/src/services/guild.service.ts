import type { GuildRepository } from "../repositories/guild.repository.js";
import type { guilds, GuildRow } from "@dragonbot/db";
import { TTLCache } from "../utils/cache.js";

export class GuildService {
  private cache = new TTLCache<Awaited<ReturnType<GuildRepository["findByGuildId"]>>>(86400); // 24h (invalidated on write, TTL is safety net only)

  /**
   * Write marks. Each write that drops a server's cached row takes the next number and notes it against that server,
   * so a read can tell whether a write to the server happened while it was reading. Such a read may hold the row
   * from before the write, so it must not put that row back in the cache after the write dropped it.
   */
  private writeCount = 0;
  private lastWriteByGuild = new Map<string, number>();

  constructor(private repo: GuildRepository) {}

  /** Drops a server's cached row after a write to it, and records the write mark. */
  private noteWrite(guildId: string): void {
    this.lastWriteByGuild.set(guildId, ++this.writeCount);
    this.cache.invalidate(guildId);
  }

  /** Whether a write to the server happened after the read that saw `readStart` began. */
  private writtenSince(guildId: string, readStart: number): boolean {
    return (this.lastWriteByGuild.get(guildId) ?? 0) > readStart;
  }

  /**
   * Load ALL guild settings into cache at startup. After this, getSettings() never hits DB. A row written while the
   * read was in flight stays out of the cache, and the next read of it goes to the database.
   */
  async hydrateAll(): Promise<number> {
    const readStart = this.writeCount;
    const allGuilds = await this.repo.findAll();
    for (const guild of allGuilds) {
      if (!this.writtenSince(guild.guildId, readStart)) this.cache.set(guild.guildId, guild);
    }
    return allGuilds.length;
  }

  async getSettings(guildId: string) {
    const cached = this.cache.get(guildId);
    if (cached !== undefined) return cached;

    // Fallback to DB only if not hydrated yet (e.g., during startup race)
    const readStart = this.writeCount;
    const settings = await this.repo.findByGuildId(guildId);
    // Returned either way, but cached only when no write to this server happened during the read.
    if (settings && !this.writtenSince(guildId, readStart)) {
      this.cache.set(guildId, settings);
    }
    return settings;
  }

  /**
   * Read settings from the DB even when cached (the cache can be stale), and refresh the cache with the result,
   * unless a write to this server happened during the read.
   */
  async getSettingsFresh(guildId: string): Promise<GuildRow | null> {
    const readStart = this.writeCount;
    const settings = await this.repo.findByGuildId(guildId);
    if (!settings) {
      this.cache.invalidate(guildId);
    } else if (!this.writtenSince(guildId, readStart)) {
      this.cache.set(guildId, settings);
    }
    return settings;
  }

  async ensureGuild(guildId: string, guildName: string) {
    const result = await this.repo.upsert(guildId, guildName);
    this.noteWrite(guildId);
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
    this.noteWrite(guildId);
    return result;
  }

  /** Return all cached guild settings (for iterating in birthday checker, etc.). */
  getAllCached() {
    return this.cache.values();
  }

  async getAllBanSyncGuilds() {
    return this.repo.findAllWithBanSync();
  }

  /** Turn off ban sync for a guild the bot can no longer reach. No-op if the guild has no row. */
  async disableBanSync(guildId: string) {
    const result = await this.repo.updateSettings(guildId, { isBanSyncEnabled: false });
    this.noteWrite(guildId);
    return result;
  }

  /** Record where the bot's honeypot warning lives (bot-managed columns), or clear it with null. */
  async setHoneypotWarning(guildId: string, warning: { channelId: string; messageId: string } | null): Promise<void> {
    await this.repo.updateSettings(guildId, {
      honeypotWarningChannelId: warning?.channelId ?? null,
      honeypotWarningMessageId: warning?.messageId ?? null,
    });
    this.noteWrite(guildId);
  }

  /**
   * Manually invalidate cache for a guild (e.g., after web dashboard changes). Counts as a write: the dashboard has
   * written the row, so a read already in flight may hold the old one.
   */
  invalidateCache(guildId: string): void {
    this.noteWrite(guildId);
  }
}
