import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBotClient } from "@dragonbot/db";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname2, "../../../.env") });
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { createClient } from "./client.js";
import { EmailService } from "./lib/email.js";
import { AIService } from "./lib/openai.js";
import { GuildRepository } from "./repositories/guild.repository.js";
import { UserRepository } from "./repositories/user.repository.js";
import { VerificationRepository } from "./repositories/verification.repository.js";
import { SuggestionRepository } from "./repositories/suggestion.repository.js";
import { AuthRepository } from "./repositories/auth.repository.js";
import { GuildAdminRepository } from "./repositories/guild-admin.repository.js";
import { GuildService } from "./services/guild.service.js";
import { UserService } from "./services/user.service.js";
import { VerificationService } from "./services/verification.service.js";
import { AuthService } from "./services/auth.service.js";
import { SuggestionService } from "./services/suggestion.service.js";
import { ModerationService } from "./services/moderation.service.js";
import { LoggingService } from "./services/logging.service.js";
import { GuildAdminService } from "./services/guild-admin.service.js";
import { ScheduledMessageRepository } from "./repositories/scheduled-message.repository.js";
import { ScheduledMessageService } from "./services/scheduled-message.service.js";
import { XpRepository } from "./repositories/xp.repository.js";
import { XpService } from "./services/xp.service.js";
import { SchedulerManager } from "./lib/scheduler.js";
import { startWebhookServer } from "./lib/webhook-server.js";
import {
  loadCommands,
  registerCommands,
  loadEvents,
  bindInteractionHandler,
} from "./loader.js";
import type { BotContext } from "./types/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. Config + Logger
  const config = loadConfig();
  const logger = createLogger();

  // 2. Database
  const db = createBotClient(config.DATABASE_URL);

  // 3. External services
  const email = new EmailService(config.RESEND_API_KEY, config.RESEND_FROM_EMAIL);
  const ai = new AIService(config.OPENAI_API_KEY, config.OPENAI_MODEL);

  // 4. Repositories
  const guildRepo = new GuildRepository(db);
  const userRepo = new UserRepository(db);
  const verificationRepo = new VerificationRepository(db);
  const suggestionRepo = new SuggestionRepository(db);
  const authRepo = new AuthRepository(db);
  const guildAdminRepo = new GuildAdminRepository(db);

  // 5. Services
  const guildService = new GuildService(guildRepo);
  const userService = new UserService(userRepo);
  const verificationService = new VerificationService(verificationRepo, guildRepo, userRepo, email);
  const authService = new AuthService(authRepo, config.JWT_SECRET);
  const suggestionService = new SuggestionService(suggestionRepo, guildRepo);
  const moderationService = new ModerationService(guildRepo, userRepo);
  const loggingService = new LoggingService(guildService);
  const guildAdminService = new GuildAdminService(guildAdminRepo);
  const scheduledMessageRepo = new ScheduledMessageRepository(db);
  const scheduledMessageService = new ScheduledMessageService(scheduledMessageRepo);
  const xpRepo = new XpRepository(db);
  const xpService = new XpService(xpRepo, logger);

  // 6. Context
  const ctx: BotContext = {
    db,
    logger,
    email,
    ai,
    config,
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
    },
  };

  // 7. Discord client
  const client = createClient();

  // 8. Load commands + events
  const commandsDir = path.join(__dirname, "commands");
  const eventsDir = path.join(__dirname, "events");

  const commands = await loadCommands(commandsDir, logger);
  await registerCommands(commands, config.BOT_CLIENT_ID, config.DISCORD_API_TOKEN, logger);
  await loadEvents(eventsDir, client, ctx, logger);
  bindInteractionHandler(client, commands, ctx);

  // 9. Ready event + scheduler + XP hydration
  client.once("clientReady", async (c) => {
    logger.info({ user: c.user.tag, guilds: c.guilds.cache.size }, "Bot is online");

    // Hydrate guild settings into memory (eliminates DB reads during normal operation)
    const guildCount = await guildService.hydrateAll();
    logger.info({ guildCount }, "Guild settings hydrated");

    // Hydrate XP data into memory
    await xpService.hydrate();

    // Start scheduled message cron jobs
    const scheduler = new SchedulerManager(client, scheduledMessageService, logger);
    await scheduler.loadAll();
    ctx.scheduler = scheduler;

    // Start webhook server for instant cache invalidation from web dashboard
    if (config.BOT_WEBHOOK_SECRET) {
      startWebhookServer({
        port: config.BOT_WEBHOOK_PORT,
        secret: config.BOT_WEBHOOK_SECRET,
        guildService,
        logger,
        getScheduler: () => ctx.scheduler,
      });
    }

    // Start 4-hour combined sync timer: flush XP + reload schedules in one DB connection window
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const syncTimer = setInterval(async () => {
      try {
        await xpService.flush();
        await guildService.hydrateAll();
        await scheduler.reload();
        logger.info("Periodic sync complete (XP flush + guild settings + schedule reload)");
      } catch (err) {
        logger.error({ err }, "Periodic sync failed");
      }
    }, FOUR_HOURS_MS);
    if (syncTimer.unref) syncTimer.unref();
  });

  // 10. Login
  await client.login(config.DISCORD_API_TOKEN);

  // 11. Graceful shutdown + crash handlers
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Shutting down...");

    // Keep event loop alive with a ref'd timer as a hard deadline
    const deadline = setTimeout(() => {
      logger.warn("Shutdown timed out — exiting without flush");
      process.exit(1);
    }, 8000);

    try {
      // Disconnect from Discord first to stop receiving new events
      client.destroy();
      // Flush XP to database
      await xpService.flush();
      logger.info("XP data flushed to database");
    } catch (err) {
      logger.error({ err }, "Failed to flush XP during shutdown");
    } finally {
      clearTimeout(deadline);
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });

  process.on("uncaughtException", async (err) => {
    logger.fatal({ err }, "Uncaught exception — flushing XP before exit");
    try {
      await xpService.flush();
    } catch (flushErr) {
      logger.error({ err: flushErr }, "Failed to flush XP during crash");
    }
    process.exit(1);
  });

  process.on("unhandledRejection", async (reason) => {
    logger.fatal({ reason }, "Unhandled rejection — flushing XP before exit");
    try {
      await xpService.flush();
    } catch (flushErr) {
      logger.error({ err: flushErr }, "Failed to flush XP during crash");
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
