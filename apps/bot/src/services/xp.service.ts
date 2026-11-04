import type { Logger } from "pino";
import type { XpRepository } from "../repositories/xp.repository.js";
import type { XpArchiveSnapshotEntry } from "../repositories/xp-archive.repository.js";
import { levelFromXp, randomXp, xpProgress, progressBar } from "../utils/xp.js";

interface XpEntry {
  totalXp: number;
  level: number;
  messageCount: number;      // all messages sent
  xpMessageCount: number;    // messages that earned XP (passed cooldown)
  lastMessageAt: number;     // epoch ms for fast cooldown checks
  dirty: boolean;
  /** Bumped on every in-place change, so a flush only marks an entry clean if it didn't change while being written. */
  version: number;
}

interface XpProcessResult {
  leveledUp: boolean;
  newLevel: number;
  xpGained: number;
}

interface XpRankInfo {
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
}

export class XpService {
  /** Every entry, keyed `guildId:discordId`. Flushes, stats and per-message lookups use this. */
  private xpMap = new Map<string, XpEntry>();
  /**
   * The same entry objects grouped by guild, then by discordId, so guild reads don't scan every guild. Each inner map
   * gets its keys in the same order as xpMap, so users tied on XP keep the same order. Kept in step by setEntry, the
   * only place entries are added or replaced; nothing removes entries.
   */
  private byGuild = new Map<string, Map<string, XpEntry>>();
  private isHydrated = false;
  private isFlushing = false;

  constructor(
    private repo: XpRepository,
    private logger: Logger,
  ) {}

  /** Load all XP data from DB into memory. Call once at startup. */
  async hydrate(): Promise<void> {
    const rows = await this.repo.findAll();
    for (const row of rows) {
      this.setEntry(row.guildId, row.discordId, {
        totalXp: row.totalXp,
        level: row.level,
        messageCount: row.messageCount,
        xpMessageCount: row.xpMessageCount,
        lastMessageAt: row.lastMessageAt ? row.lastMessageAt.getTime() : 0,
        dirty: false,
        version: 0,
      });
    }
    this.isHydrated = true;
    this.logger.info({ entries: rows.length }, "XP data hydrated from database");
  }

  /**
   * Process a message for XP. Entirely in-memory — no DB activity.
   * Returns result if XP was granted (including level-up info), or null if on cooldown.
   * Also returns null, without counting the message, until hydrate() has run: hydrate would overwrite the entry,
   * and a zeroed entry could post a false level-up.
   */
  processMessage(
    guildId: string,
    discordId: string,
    settings: GuildXpSettings,
  ): XpProcessResult | null {
    if (!this.isHydrated) return null;

    const key = `${guildId}:${discordId}`;
    const now = Date.now();

    let entry = this.xpMap.get(key);
    if (!entry) {
      entry = { totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, lastMessageAt: 0, dirty: false, version: 0 };
      this.setEntry(guildId, discordId, entry);
    }

    // Always count the message, regardless of cooldown
    entry.messageCount++;
    entry.dirty = true;
    entry.version++;

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

    // The position a stable sort by XP (descending) would give: everyone with more XP, plus everyone tied who comes
    // first in insertion order
    const guildEntries = this.byGuild.get(guildId)!;
    let rank = 1;
    let beforeTarget = true;
    for (const [id, other] of guildEntries) {
      if (id === discordId) {
        beforeTarget = false;
      } else if (other.totalXp > entry.totalXp || (beforeTarget && other.totalXp === entry.totalXp)) {
        rank++;
      }
    }
    const progress = xpProgress(entry.totalXp, entry.level);

    return {
      totalXp: entry.totalXp,
      level: entry.level,
      rank,
      totalUsers: guildEntries.size,
      messageCount: entry.messageCount,
      xpMessageCount: entry.xpMessageCount,
      currentLevelXp: progress.current,
      requiredLevelXp: progress.required,
      progressBar: progressBar(progress.current, progress.required),
    };
  }

  /** Get the top N users by XP for a guild. Reads from memory only. */
  getLeaderboard(guildId: string, limit = 10): LeaderboardEntry[] {
    const guildEntries = [...(this.byGuild.get(guildId) ?? [])];
    // A stable sort, so users tied on XP stay in insertion order
    guildEntries.sort(([, a], [, b]) => b.totalXp - a.totalXp);

    return guildEntries.slice(0, limit).map(([discordId, e], i) => ({
      discordId,
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

    this.zero(entry);
    return true;
  }

  /** Whether a flush is currently in progress (prevents concurrent flushes). */
  get flushing(): boolean {
    return this.isFlushing;
  }

  /** Batch-upsert all dirty entries to DB, then mark clean each written entry that didn't change during the write. */
  async flush(): Promise<void> {
    if (this.isFlushing) {
      this.logger.warn("Flush already in progress, skipping");
      return;
    }
    this.isFlushing = true;
    try {
      await this.flushInternal();
    } finally {
      this.isFlushing = false;
    }
  }

  private async flushInternal(): Promise<void> {
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
      // Read each entry's values and version in the same synchronous step, since earlier chunks' awaits let it change
      const versions = chunk.map((e) => e.entry.version);
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

      // Mark this chunk clean, except entries changed while it was being written: they stay dirty for the next flush
      chunk.forEach(({ entry }, j) => {
        if (entry.version === versions[j]) entry.dirty = false;
      });
    }

    this.logger.info({ count: dirtyEntries.length }, "XP data flushed to database");
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

  /** Get a snapshot of all guild entries for archiving. */
  getGuildSnapshot(guildId: string): XpArchiveSnapshotEntry[] {
    return [...(this.byGuild.get(guildId) ?? [])].map(([discordId, e]) => ({
      discordId,
      totalXp: e.totalXp,
      level: e.level,
      messageCount: e.messageCount,
      xpMessageCount: e.xpMessageCount,
      lastMessageAt: e.lastMessageAt,
    }));
  }

  /** Zero all XP entries for a guild in memory. Mark dirty for flush. */
  resetAllInMemory(guildId: string): number {
    let count = 0;
    for (const entry of this.byGuild.get(guildId)?.values() ?? []) {
      this.zero(entry);
      count++;
    }
    return count;
  }

  /** Restore archived entries into memory. Marks dirty for flush. */
  rehydrateGuild(guildId: string, entries: XpArchiveSnapshotEntry[]): number {
    for (const e of entries) {
      this.setEntry(guildId, e.discordId, {
        totalXp: e.totalXp,
        level: e.level,
        messageCount: e.messageCount,
        xpMessageCount: e.xpMessageCount,
        lastMessageAt: e.lastMessageAt,
        dirty: true,
        // A new object, so a flush still holding the replaced one can't mark this one clean
        version: 0,
      });
    }
    return entries.length;
  }

  /** Add or replace an entry in both maps. A replaced key keeps its place in both, as Map.set does. */
  private setEntry(guildId: string, discordId: string, entry: XpEntry): void {
    this.xpMap.set(`${guildId}:${discordId}`, entry);
    let guildEntries = this.byGuild.get(guildId);
    if (!guildEntries) {
      guildEntries = new Map();
      this.byGuild.set(guildId, guildEntries);
    }
    guildEntries.set(discordId, entry);
  }

  /** Zero an entry's XP and counts, and mark it dirty for the next flush. */
  private zero(entry: XpEntry): void {
    entry.totalXp = 0;
    entry.level = 0;
    entry.messageCount = 0;
    entry.xpMessageCount = 0;
    entry.lastMessageAt = 0;
    entry.dirty = true;
    entry.version++;
  }
}
