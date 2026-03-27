import { eq } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { suggestions } from "@dragonbot/db";

export class SuggestionRepository {
  constructor(private db: DrizzleClient) {}

  async create(data: {
    guildId: string;
    discordId: string;
    discordUsername: string;
    suggestion: string;
  }) {
    const rows = await this.db.insert(suggestions).values(data).returning();
    return rows[0]!;
  }

  async findByGuildId(guildId: string) {
    return this.db
      .select()
      .from(suggestions)
      .where(eq(suggestions.guildId, guildId));
  }

  async updateStatus(id: string, status: string) {
    const rows = await this.db
      .update(suggestions)
      .set({ status })
      .where(eq(suggestions.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
