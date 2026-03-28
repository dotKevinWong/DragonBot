import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { guilds } from "@dragonbot/db";

export class GuildRepository {
  constructor(private db: DrizzleClient) {}

  async findByGuildId(guildId: string) {
    const rows = await this.db
      .select()
      .from(guilds)
      .where(eq(guilds.guildId, guildId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(guildId: string, guildName: string) {
    const rows = await this.db
      .insert(guilds)
      .values({ guildId, guildName })
      .onConflictDoUpdate({
        target: guilds.guildId,
        set: { guildName, updatedAt: new Date() },
      })
      .returning();
    return rows[0]!;
  }

  async updateSettings(guildId: string, settings: Partial<typeof guilds.$inferInsert>) {
    const rows = await this.db
      .update(guilds)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(guilds.guildId, guildId))
      .returning();
    return rows[0] ?? null;
  }

  async findAll() {
    return this.db.select().from(guilds);
  }

  async findAllWithBanSync() {
    return this.db
      .select()
      .from(guilds)
      .where(eq(guilds.isBanSyncEnabled, true));
  }
}
