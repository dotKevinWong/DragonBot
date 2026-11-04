import type { DrizzleClient } from "@dragonbot/db";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import { EmailService } from "../lib/email.js";
import { AIService } from "../lib/openai.js";
import { GuildRepository } from "../repositories/guild.repository.js";
import { UserRepository } from "../repositories/user.repository.js";
import { VerificationRepository } from "../repositories/verification.repository.js";
import { SuggestionRepository } from "../repositories/suggestion.repository.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import { GuildAdminRepository } from "../repositories/guild-admin.repository.js";
import { GuildService } from "../services/guild.service.js";
import { UserService } from "../services/user.service.js";
import { VerificationService } from "../services/verification.service.js";
import { AuthService } from "../services/auth.service.js";
import { SuggestionService } from "../services/suggestion.service.js";
import { ModerationService } from "../services/moderation.service.js";
import { LoggingService } from "../services/logging.service.js";
import { GuildAdminService } from "../services/guild-admin.service.js";
import { ScheduledMessageRepository } from "../repositories/scheduled-message.repository.js";
import { ScheduledMessageService } from "../services/scheduled-message.service.js";
import { XpRepository } from "../repositories/xp.repository.js";
import { XpService } from "../services/xp.service.js";
import { XpArchiveService } from "../services/xp-archive.service.js";
import { BirthdayRepository } from "../repositories/birthday.repository.js";
import { XpArchiveRepository } from "../repositories/xp-archive.repository.js";
import { BirthdayService } from "../services/birthday.service.js";
import { YouTubeRepository } from "../repositories/youtube.repository.js";
import { YouTubeService } from "../services/youtube.service.js";
import { HoneypotService } from "../services/honeypot.service.js";
import { RepeatSpamService } from "../services/repeat-spam.service.js";
import type { BotContext } from "../types/context.js";

export interface BuiltServices {
  ai: AIService;
  services: BotContext["services"];
  /** Not on BotContext: only the YouTube checker, created in clientReady, writes through it. */
  youtubeRepo: YouTubeRepository;
}

/**
 * Builds the external clients, repositories and services. Construction order and arguments are unchanged from
 * when this lived in index.ts main(); no constructor has side effects.
 */
export function buildServices(config: AppConfig, logger: Logger, db: DrizzleClient): BuiltServices {
  // External services
  const email = new EmailService(config.RESEND_API_KEY, config.RESEND_FROM_EMAIL);
  const ai = new AIService(config.OPENAI_API_KEY, config.OPENAI_MODEL);

  // Repositories
  const guildRepo = new GuildRepository(db);
  const userRepo = new UserRepository(db);
  const verificationRepo = new VerificationRepository(db);
  const suggestionRepo = new SuggestionRepository(db);
  const authRepo = new AuthRepository(db);
  const guildAdminRepo = new GuildAdminRepository(db);

  // Services
  const guildService = new GuildService(guildRepo);
  const userService = new UserService(userRepo);
  const verificationService = new VerificationService(verificationRepo, guildRepo, userRepo, email);
  const authService = new AuthService(authRepo);
  const suggestionService = new SuggestionService(suggestionRepo, guildRepo);
  const moderationService = new ModerationService(guildService);
  const loggingService = new LoggingService(guildService);
  const guildAdminService = new GuildAdminService(guildAdminRepo);
  const scheduledMessageRepo = new ScheduledMessageRepository(db);
  const scheduledMessageService = new ScheduledMessageService(scheduledMessageRepo);
  const xpRepo = new XpRepository(db);
  const xpService = new XpService(xpRepo, logger);
  const birthdayRepo = new BirthdayRepository(db);
  const birthdayService = new BirthdayService(birthdayRepo);
  const youtubeRepo = new YouTubeRepository(db);
  const youtubeService = new YouTubeService();
  const honeypotService = new HoneypotService();
  const repeatSpamService = new RepeatSpamService();
  const xpArchiveRepo = new XpArchiveRepository(db);
  const xpArchiveService = new XpArchiveService(xpService, xpArchiveRepo);

  return {
    ai,
    services: {
      user: userService,
      guild: guildService,
      verification: verificationService,
      auth: authService,
      suggestion: suggestionService,
      moderation: moderationService,
      logging: loggingService,
      guildAdmin: guildAdminService,
      scheduledMessage: scheduledMessageService,
      xp: xpService,
      xpArchive: xpArchiveService,
      birthday: birthdayService,
      youtube: youtubeService,
      honeypot: honeypotService,
      repeatSpam: repeatSpamService,
    },
    youtubeRepo,
  };
}
