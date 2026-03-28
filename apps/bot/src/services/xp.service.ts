import type { Logger } from "pino";
import type { XpRepository } from "../repositories/xp.repository.js";
import { levelFromXp, randomXp, xpProgress, progressBar } from "../utils/xp.js";

export interface XpEntry {
  totalXp: number;
  level: number;
  messageCount: number;      // all messages sent
  xpMessageCount: number;    // messages that earned XP (passed cooldown)
  lastMessageAt: number;     // epoch ms for fast cooldown checks
  dirty: boolean;
}

export interface XpProcessResult {
  leveledUp: boolean;
  newLevel: number;
  xpGained: number;
}

export interface XpRankInfo {
  totalXp: number;
  level: number;
  rank: number;
  totalUsers: number;
  messageCount: number;
  xpMessageCount: number;
  currentLevelXp: number;
  requiredLevelXp: number;
  progressBar: string;
}

export interface LeaderboardEntry {
  discordId: string;
  totalXp: number;
  level: number;
  messageCount: number;
  xpMessageCount: number;
  rank: number;
}

interface GuildXpSettings {
  xpMin: number;
  xpMax: number;
  xpCooldownSeconds: number;
  xpExcludedChannelIds: string[];
  xpExcludedRoleIds: string[];
}

export class XpService {
  private xpMap = new Map<string, XpEntry>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isHydrated = false;

  constructor(
    private repo: XpRepository,
    private logger: Logger,
  ) {}

  /** Load all XP data from DB into memory. Call once at startup. */
  async hydrate(): Promise<void> {
    const rows = await this.repo.findAll();
    for (const row of rows) {
      const key = `${row.guildId}:${row.discordId}`;
      this.xpMap.set(key, {
        totalXp: row.totalXp,
        level: row.level,
        messageCount: row.messageCount,
        xpMessageCount: row.xpMessageCount,
        lastMessageAt: row.lastMessageAt ? row.lastMessageAt.getTime() : 0,
        dirty: false,
      });
    }
    this.isHydrated = true;
    this.logger.info({ entries: rows.length }, "XP data hydrated from database");
  }

  /**
   * Process a message for XP. Entirely in-memory — no DB activity.
   * Returns result if XP was granted (including level-up info), or null if on cooldown.
   */
  processMessage(
    guildId: string,
    discordId: string,
    settings: GuildXpSettings,
  ): XpProcessResult | null {
    const key = `${guildId}:${discordId}`;
    const now = Date.now();

    let entry = this.xpMap.get(key);
    if (!entry) {
      entry = { totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: 0, dirty: false };
      this.xpMap.set(key, entry);
    }

    // Always count the message, regardless of cooldown
    entry.messageCount++;
    entry.dirty = true;

    // Cooldown check — only gates XP, not message counting
    const cooldownMs = settings.xpCooldownSeconds * 1000;
    if (now - entry.lastMessageAt < cooldownMs) {
      return null;
    }

    // Grant XP
    const xpGained = randomXp(settings.xpMin, settings.xpMax);
    const previousLevel = entry.level;
    entry.totalXp += xpGained;
    entry.xpMessageCount++;
    entry.lastMessageAt = now;

    // Check for level-up
    const newLevel = levelFromXp(entry.totalXp);
    entry.level = newLevel;

    return {
      leveledUp: newLevel > previousLevel,
      newLevel,
      xpGained,
    };
  }

  /** Get a user's rank info within a guild. Reads from memory only. */
  getRank(guildId: string, discordId: string): XpRankInfo | null {
    const key = `${guildId}:${discordId}`;
    const entry = this.xpMap.get(key);

    if (!entry) return null;

    // Collect all users in this guild and sort by XP
    const guildEntries = this.getGuildEntries(guildId);
    guildEntries.sort((a, b) => b.totalXp - a.totalXp);

    const rank = guildEntries.findIndex((e) => e.discordId === discordId) + 1;
    const progress = xpProgress(entry.totalXp, entry.level);

    return {
      totalXp: entry.totalXp,
      level: entry.level,
      rank,
      totalUsers: guildEntries.length,
      messageCount: entry.messageCount,
      xpMessageCount: entry.xpMessageCount,
      currentLevelXp: progress.current,
      requiredLevelXp: progress.required,
      progressBar: progressBar(progress.current, progress.required),
    };
  }

  /** Get the top N users by XP for a guild. Reads from memory only. */
  getLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
    const guildEntries = this.getGuildEntries(guildId);
    guildEntries.sort((a, b) => b.totalXp - a.totalXp);

    return guildEntries.slice(0, limit).map((e, i) => ({
      discordId: e.discordId,
      totalXp: e.totalXp,
      level: e.level,
      messageCount: e.messageCount,
      xpMessageCount: e.xpMessageCount,
      rank: i + 1,
    }));
  }

  /** Reset a user's XP in a guild. */
  resetUser(guildId: string, discordId: string): boolean {
    const key = `${guildId}:${discordId}`;
    const entry = this.xpMap.get(key);
    if (!entry) return false;

    entry.totalXp = 0;
    entry.level = 0;
    entry.messageCount = 0;
    entry.xpMessageCount = 0;
    entry.lastMessageAt = 0;
    entry.dirty = true;
    return true;
  }

  /** Batch-upsert all dirty entries to DB, then mark them clean. */
  async flush(): Promise<void> {
    const dirtyEntries: { guildId: string; discordId: string; entry: XpEntry }[] = [];

    for (const [key, entry] of this.xpMap) {
      if (entry.dirty) {
        const [guildId, discordId] = key.split(":");
        dirtyEntries.push({ guildId: guildId!, discordId: discordId!, entry });
      }
    }

    if (dirtyEntries.length === 0) {
      this.logger.debug("XP flush skipped — no dirty entries");
      return;
    }

    // Batch in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < dirtyEntries.length; i += chunkSize) {
      const chunk = dirtyEntries.slice(i, i + chunkSize);
      await this.repo.batchUpsert(
        chunk.map((e) => ({
          guildId: e.guildId,
          discordId: e.discordId,
          totalXp: e.entry.totalXp,
          level: e.entry.level,
          messageCount: e.entry.messageCount,
          xpMessageCount: e.entry.xpMessageCount,
          lastMessageAt: e.entry.lastMessageAt > 0 ? new Date(e.entry.lastMessageAt) : null,
        })),
      );
    }

    // Mark all as clean
    for (const { entry } of dirtyEntries) {
      entry.dirty = false;
    }

    this.logger.info({ count: dirtyEntries.length }, "XP data flushed to database");
  }

  /** Start the periodic flush timer. */
  startFlushTimer(intervalMs: number): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.logger.error({ err }, "Periodic XP flush failed");
      });
    }, intervalMs);
    // Don't keep the process alive just for the flush timer
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
    this.logger.info({ intervalMs }, "XP flush timer started");
  }

  /** Stop the periodic flush timer. */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Debug stats. */
  getStats(): { totalEntries: number; dirtyEntries: number; isHydrated: boolean } {
    let dirtyCount = 0;
    for (const entry of this.xpMap.values()) {
      if (entry.dirty) dirtyCount++;
    }
    return {
      totalEntries: this.xpMap.size,
      dirtyEntries: dirtyCount,
      isHydrated: this.isHydrated,
    };
  }

  /** Extract all entries for a guild with their discordIds. */
  private getGuildEntries(guildId: string): (XpEntry & { discordId: string })[] {
    const prefix = `${guildId}:`;
    const entries: (XpEntry & { discordId: string })[] = [];
    for (const [key, entry] of this.xpMap) {
      if (key.startsWith(prefix)) {
        entries.push({ ...entry, discordId: key.slice(prefix.length) });
      }
    }
    return entries;
  }
}
