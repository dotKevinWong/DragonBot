import { and, eq, lt } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { authTokens } from "@dragonbot/db";

export class AuthRepository {
  constructor(private db: DrizzleClient) {}

  async create(data: {
    discordId: string;
    token: string;
    commandInteractionId?: string;
    expiresAt: Date;
  }) {
    const rows = await this.db.insert(authTokens).values(data).returning();
    return rows[0]!;
  }

  async findByToken(token: string) {
    const rows = await this.db
      .select()
      .from(authTokens)
      .where(eq(authTokens.token, token))
      .limit(1);
    return rows[0] ?? null;
  }

  async markUsed(id: string) {
    await this.db
      .update(authTokens)
      .set({ used: true })
      .where(eq(authTokens.id, id));
  }

  async deleteExpired() {
    await this.db
      .delete(authTokens)
      .where(
        and(
          lt(authTokens.expiresAt, new Date()),
          eq(authTokens.used, false),
        ),
      );
  }
}
