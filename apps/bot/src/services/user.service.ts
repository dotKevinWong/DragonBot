import type { UserRepository } from "../repositories/user.repository.js";
import type { users } from "@dragonbot/db";
import { AppError, ErrorCode } from "../types/errors.js";

export class UserService {
  constructor(private repo: UserRepository) {}

  async getOrCreate(discordId: string) {
    return this.repo.upsert(discordId);
  }

  async getProfile(discordId: string) {
    const user = await this.repo.findByDiscordId(discordId);
    if (!user) {
      throw new AppError(ErrorCode.PROFILE_NOT_FOUND, "User profile not found.");
    }
    if (user.isProfileDisabled) {
      throw new AppError(ErrorCode.PROFILE_DISABLED, "This user's profile is disabled.");
    }
    return user;
  }

  async isVerified(discordId: string): Promise<boolean> {
    const user = await this.repo.findByDiscordId(discordId);
    return user?.isVerified ?? false;
  }

  async markVerified(discordId: string, email: string) {
    // Ensure user exists
    await this.repo.upsert(discordId);
    return this.repo.markVerified(discordId, email);
  }

  async markBanned(discordId: string, banGuildId: string) {
    await this.repo.upsert(discordId);
    return this.repo.markBanned(discordId, banGuildId);
  }

  async updateProfile(discordId: string, profile: Partial<typeof users.$inferInsert>) {
    await this.repo.upsert(discordId);
    return this.repo.updateProfile(discordId, profile);
  }
}
