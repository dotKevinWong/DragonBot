import type { SuggestionRepository } from "../repositories/suggestion.repository.js";
import type { GuildRepository } from "../repositories/guild.repository.js";
import { AppError, ErrorCode } from "../types/errors.js";

export class SuggestionService {
  constructor(
    private suggestionRepo: SuggestionRepository,
    private guildRepo: GuildRepository,
  ) {}

  async create(data: {
    guildId: string;
    discordId: string;
    discordUsername: string;
    suggestion: string;
  }) {
    const guild = await this.guildRepo.findByGuildId(data.guildId);
    if (guild && !guild.isSuggestionsEnabled) {
      throw new AppError(ErrorCode.SUGGESTIONS_DISABLED, "Suggestions are disabled in this server.");
    }
    return this.suggestionRepo.create(data);
  }

  async getByGuild(guildId: string) {
    return this.suggestionRepo.findByGuildId(guildId);
  }

  async updateStatus(id: string, status: string) {
    return this.suggestionRepo.updateStatus(id, status);
  }
}
