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
}
