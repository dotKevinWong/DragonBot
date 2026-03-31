import { eq, desc, and } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { xpArchives } from "@dragonbot/db";

export interface XpArchiveRow {
  id: string;
  guildId: string;
  archivedBy: string;
  reason: string | null;
  data: unknown;
  userCount: number;
  totalXpSum: number;
  restoredAt: Date | null;
  createdAt: Date;
}

export interface XpArchiveSnapshotEntry {
  discordId: string;
  totalXp: number;
  level: number;
  messageCount: number;
  xpMessageCount: number;
  lastMessageAt: number; // epoch ms
}

export class XpArchiveRepository {
  constructor(private db: DrizzleClient) {}

  async create(
    guildId: string,
    archivedBy: string,
    reason: string | null,
    data: XpArchiveSnapshotEntry[],
    userCount: number,
    totalXpSum: number,
  ): Promise<XpArchiveRow> {
    const rows = await this.db
      .insert(xpArchives)
      .values({
        guildId,
        archivedBy,
        reason,
        data: JSON.parse(JSON.stringify(data)),
        userCount,
        totalXpSum,
      })
      .returning();
    return rows[0] as XpArchiveRow;
  }

  async findByIdAndGuild(id: string, guildId: string): Promise<XpArchiveRow | null> {
    const rows = await this.db
      .select()
      .from(xpArchives)
      .where(and(eq(xpArchives.id, id), eq(xpArchives.guildId, guildId)))
      .limit(1);
    return (rows[0] as XpArchiveRow) ?? null;
  }

  async findByGuild(guildId: string, limit = 10): Promise<XpArchiveRow[]> {
    return this.db
      .select()
      .from(xpArchives)
      .where(eq(xpArchives.guildId, guildId))
      .orderBy(desc(xpArchives.createdAt))
      .limit(limit) as Promise<XpArchiveRow[]>;
  }

  async markRestored(id: string): Promise<void> {
    await this.db
      .update(xpArchives)
      .set({ restoredAt: new Date() })
      .where(eq(xpArchives.id, id));
  }
}
