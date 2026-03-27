import { eq, and } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { guildAdmins } from "@dragonbot/db";

export class GuildAdminRepository {
  constructor(private db: DrizzleClient) {}

  async findByGuildAndUser(guildId: string, discordId: string) {
    const rows = await this.db
      .select()
      .from(guildAdmins)
      .where(and(eq(guildAdmins.guildId, guildId), eq(guildAdmins.discordId, discordId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAllByGuild(guildId: string) {
    return this.db
      .select()
      .from(guildAdmins)
      .where(eq(guildAdmins.guildId, guildId));
  }

  async upsert(guildId: string, discordId: string, permissions: string[], addedBy: string) {
    const rows = await this.db
      .insert(guildAdmins)
      .values({ guildId, discordId, permissions, addedBy })
      .onConflictDoUpdate({
        target: [guildAdmins.guildId, guildAdmins.discordId],
        set: { permissions, updatedAt: new Date() },
      })
      .returning();
    return rows[0]!;
  }

  async remove(guildId: string, discordId: string) {
    const rows = await this.db
      .delete(guildAdmins)
      .where(and(eq(guildAdmins.guildId, guildId), eq(guildAdmins.discordId, discordId)))
      .returning();
    return rows.length > 0;
  }
}
