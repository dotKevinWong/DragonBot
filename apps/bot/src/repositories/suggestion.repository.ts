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
}
