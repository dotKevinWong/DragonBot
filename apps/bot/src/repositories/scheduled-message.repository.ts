import { eq, and, asc } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { scheduledMessages } from "@dragonbot/db";

export class ScheduledMessageRepository {
  constructor(private db: DrizzleClient) {}

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAllByGuild(guildId: string) {
    return this.db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.guildId, guildId))
      .orderBy(asc(scheduledMessages.createdAt));
  }

  async findAllEnabled() {
    return this.db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.isEnabled, true));
  }

  async create(data: {
    guildId: string;
    channelId: string;
    message: string;
    cronExpression: string;
    timezone?: string;
    isEmbed?: boolean;
    embedColor?: string | null;
    embedTitle?: string | null;
    createdBy: string;
  }) {
    const rows = await this.db
      .insert(scheduledMessages)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async update(id: string, data: Partial<typeof scheduledMessages.$inferInsert>) {
    const rows = await this.db
      .update(scheduledMessages)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scheduledMessages.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: string) {
    const rows = await this.db
      .delete(scheduledMessages)
      .where(eq(scheduledMessages.id, id))
      .returning();
    return rows.length > 0;
  }

  async updateLastRun(id: string, lastRunAt: Date, nextRunAt: Date | null) {
    await this.db
      .update(scheduledMessages)
      .set({ lastRunAt, nextRunAt, updatedAt: new Date() })
      .where(eq(scheduledMessages.id, id));
  }
}
