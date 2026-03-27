import type { UserRepository } from "../repositories/user.repository.js";
import type { users } from "@dragonbot/db";
import { AppError, ErrorCode } from "../types/errors.js";
import { TTLCache } from "../utils/cache.js";

export class UserService {
  // Cache verification status — checked frequently by /ask and event handlers
  private verifiedCache = new TTLCache<boolean>(86400); // 24h (invalidated on markVerified, TTL is safety net only)

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
    const cached = this.verifiedCache.get(discordId);
    if (cached !== undefined) return cached;

    const user = await this.repo.findByDiscordId(discordId);
    const verified = user?.isVerified ?? false;
    this.verifiedCache.set(discordId, verified);
    return verified;
  }

  async markVerified(discordId: string, email: string) {
    // Ensure user exists
    await this.repo.upsert(discordId);
    const result = await this.repo.markVerified(discordId, email);
    // Update cache immediately
    this.verifiedCache.set(discordId, true);
    return result;
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
