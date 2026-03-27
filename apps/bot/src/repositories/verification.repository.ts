import { and, eq } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { verifications } from "@dragonbot/db";

export class VerificationRepository {
  constructor(private db: DrizzleClient) {}

  async create(data: {
    discordId: string;
    guildId: string;
    email: string;
    code: string;
    expiresAt: Date;
  }) {
    const rows = await this.db.insert(verifications).values(data).returning();
    return rows[0]!;
  }

  async findByDiscordIdAndGuild(discordId: string, guildId: string) {
    const rows = await this.db
      .select()
      .from(verifications)
      .where(
        and(
          eq(verifications.discordId, discordId),
          eq(verifications.guildId, guildId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteByDiscordIdAndGuild(discordId: string, guildId: string) {
    await this.db
      .delete(verifications)
      .where(
        and(
          eq(verifications.discordId, discordId),
          eq(verifications.guildId, guildId),
        ),
      );
  }
}
