import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { users } from "@dragonbot/db";

export class UserRepository {
  constructor(private db: DrizzleClient) {}

  async findByDiscordId(discordId: string) {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.discordId, discordId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(discordId: string) {
    const rows = await this.db
      .insert(users)
      .values({ discordId })
      .onConflictDoUpdate({
        target: users.discordId,
        set: { updatedAt: new Date() },
      })
      .returning();
    return rows[0]!;
  }

  async markVerified(discordId: string, email: string) {
    const rows = await this.db
      .update(users)
      .set({
        isVerified: true,
        email,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.discordId, discordId))
      .returning();
    return rows[0] ?? null;
  }

  async markBanned(discordId: string, banGuildId: string) {
    const rows = await this.db
      .update(users)
      .set({
        isBanned: true,
        banGuildId,
        bannedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.discordId, discordId))
      .returning();
    return rows[0] ?? null;
  }

  async updateProfile(discordId: string, profile: Partial<typeof users.$inferInsert>) {
    const rows = await this.db
      .update(users)
      .set({ ...profile, updatedAt: new Date() })
      .where(eq(users.discordId, discordId))
      .returning();
    return rows[0] ?? null;
  }
}
