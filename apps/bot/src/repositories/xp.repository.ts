import { eq, desc, sql } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { userXp } from "@dragonbot/db";

export interface XpRow {
  guildId: string;
  discordId: string;
  totalXp: number;
  level: number;
  messageCount: number;
  xpMessageCount: number;
  lastMessageAt: Date | null;
}

export class XpRepository {
  constructor(private db: DrizzleClient) {}

  /** Load all XP entries for startup hydration. */
  async findAll(): Promise<XpRow[]> {
    return this.db.select({
      guildId: userXp.guildId,
      discordId: userXp.discordId,
      totalXp: userXp.totalXp,
      level: userXp.level,
      messageCount: userXp.messageCount,
      xpMessageCount: userXp.xpMessageCount,
      lastMessageAt: userXp.lastMessageAt,
    }).from(userXp);
  }

  /** Load leaderboard for a guild from DB (used by web dashboard). */
  async findByGuild(guildId: string, limit = 100): Promise<XpRow[]> {
    return this.db.select({
      guildId: userXp.guildId,
      discordId: userXp.discordId,
      totalXp: userXp.totalXp,
      level: userXp.level,
      messageCount: userXp.messageCount,
      xpMessageCount: userXp.xpMessageCount,
      lastMessageAt: userXp.lastMessageAt,
    })
      .from(userXp)
      .where(eq(userXp.guildId, guildId))
      .orderBy(desc(userXp.totalXp))
      .limit(limit);
  }

  /** Batch upsert dirty entries in a single round-trip. */
  async batchUpsert(entries: {
    guildId: string;
    discordId: string;
    totalXp: number;
    level: number;
    messageCount: number;
    xpMessageCount: number;
    lastMessageAt: Date | null;
  }[]): Promise<void> {
    if (entries.length === 0) return;

    await this.db
      .insert(userXp)
      .values(entries.map((e) => ({
        guildId: e.guildId,
        discordId: e.discordId,
        totalXp: e.totalXp,
        level: e.level,
        messageCount: e.messageCount,
        xpMessageCount: e.xpMessageCount,
        lastMessageAt: e.lastMessageAt,
        updatedAt: new Date(),
      })))
      .onConflictDoUpdate({
        target: [userXp.guildId, userXp.discordId],
        set: {
          totalXp: sql`excluded.total_xp`,
          level: sql`excluded.level`,
          messageCount: sql`excluded.message_count`,
          xpMessageCount: sql`excluded.xp_message_count`,
          lastMessageAt: sql`excluded.last_message_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}
