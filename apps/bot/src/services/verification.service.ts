import crypto from "node:crypto";
import type { VerificationRepository } from "../repositories/verification.repository.js";
import type { GuildRepository } from "../repositories/guild.repository.js";
import type { UserRepository } from "../repositories/user.repository.js";
import type { EmailService } from "../lib/email.js";
import { AppError, ErrorCode } from "../types/errors.js";

export class VerificationService {
  constructor(
    private verificationRepo: VerificationRepository,
    private guildRepo: GuildRepository,
    private userRepo: UserRepository,
    private emailService: EmailService,
  ) {}

  async initiateVerification(guildId: string, userId: string, email: string): Promise<void> {
    // Ensure user exists
    await this.userRepo.upsert(userId);

    // Check if already verified
    const user = await this.userRepo.findByDiscordId(userId);
    if (user?.isVerified) {
      throw new AppError(ErrorCode.ALREADY_VERIFIED, "You are already verified.");
    }

    // Get guild settings for guild name in email
    const guild = await this.guildRepo.findByGuildId(guildId);

    // Validate email domain — hardcoded to Drexel University
    const ALLOWED_DOMAINS = ["drexel.edu", "dragons.drexel.edu"];
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (!emailDomain || !ALLOWED_DOMAINS.includes(emailDomain)) {
      throw new AppError(
        ErrorCode.INVALID_EMAIL_DOMAIN,
        `Email must be from one of: ${ALLOWED_DOMAINS.join(", ")}`,
      );
    }

    // Delete any existing verification for this user+guild
    await this.verificationRepo.deleteByDiscordIdAndGuild(userId, guildId);

    // Generate 6-character alphanumeric code
    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await this.verificationRepo.create({
      discordId: userId,
      guildId,
      email,
      code,
      expiresAt,
    });

    // Send verification email
    const guildName = guild?.guildName ?? "Discord Server";
    await this.emailService.sendVerificationEmail(email, code, guildName);
  }

  async confirmVerification(
    guildId: string,
    userId: string,
    code: string,
  ): Promise<{ email: string }> {
    const verification = await this.verificationRepo.findByDiscordIdAndGuild(userId, guildId);

    if (!verification) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        "No pending verification found. Use `/verify email` first.",
      );
    }

    if (new Date() > verification.expiresAt) {
      await this.verificationRepo.deleteByDiscordIdAndGuild(userId, guildId);
      throw new AppError(
        ErrorCode.VERIFICATION_EXPIRED,
        "Your verification code has expired. Please request a new one.",
      );
    }

    if (verification.code !== code.toUpperCase()) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid verification code.");
    }

    // Mark user as verified
    await this.userRepo.upsert(userId);
    await this.userRepo.markVerified(userId, verification.email);

    // Clean up
    await this.verificationRepo.deleteByDiscordIdAndGuild(userId, guildId);

    return { email: verification.email };
  }
}
