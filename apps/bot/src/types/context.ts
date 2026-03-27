import type { DrizzleClient } from "@dragonbot/db";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";
import type { EmailService } from "../lib/email.js";
import type { AIService } from "../lib/openai.js";
import type { UserService } from "../services/user.service.js";
import type { GuildService } from "../services/guild.service.js";
import type { VerificationService } from "../services/verification.service.js";
import type { AuthService } from "../services/auth.service.js";
import type { SuggestionService } from "../services/suggestion.service.js";
import type { ModerationService } from "../services/moderation.service.js";
import type { LoggingService } from "../services/logging.service.js";
import type { GuildAdminService } from "../services/guild-admin.service.js";
import type { ScheduledMessageService } from "../services/scheduled-message.service.js";
import type { SchedulerManager } from "../lib/scheduler.js";

export interface BotContext {
  db: DrizzleClient;
  logger: Logger;
  email: EmailService;
  ai: AIService;
  config: AppConfig;
  services: {
    user: UserService;
    guild: GuildService;
    verification: VerificationService;
    auth: AuthService;
    suggestion: SuggestionService;
    moderation: ModerationService;
    logging: LoggingService;
    guildAdmin: GuildAdminService;
    scheduledMessage: ScheduledMessageService;
  };
  scheduler?: SchedulerManager;
}
