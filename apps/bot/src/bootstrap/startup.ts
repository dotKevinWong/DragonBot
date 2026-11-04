import type { Client } from "discord.js";
import type { Logger } from "pino";
import { SchedulerManager } from "../lib/scheduler.js";
import { BirthdayChecker } from "../lib/birthday-checker.js";
import { YouTubeChecker } from "../lib/youtube-checker.js";
import { HoneypotWarningSync } from "../lib/honeypot-warning.js";
import { startWebhookServer } from "../lib/webhook-server.js";
import type { YouTubeRepository } from "../repositories/youtube.repository.js";
import type { ScheduledMessageService } from "../services/scheduled-message.service.js";
import type { BirthdayService } from "../services/birthday.service.js";
import type { YouTubeService } from "../services/youtube.service.js";
import type { GuildService } from "../services/guild.service.js";
import type { HoneypotService } from "../services/honeypot.service.js";
import type { LoggingService } from "../services/logging.service.js";
import type { BotContext } from "../types/context.js";
import { startPeriodicSync } from "./periodic-sync.js";

export interface StartupDeps {
  /** The client the workers are built with (the ready event's client is used only for the "Bot is online" log). */
  client: Client;
  ctx: BotContext;
  youtubeRepo: YouTubeRepository;
}

/** Constructors and starters runStartup uses, injectable so tests can record the order. */
export interface StartupFactories {
  createScheduler(client: Client, scheduledMessageService: ScheduledMessageService, logger: Logger): SchedulerManager;
  createBirthdayChecker(
    client: Client,
    birthdayService: BirthdayService,
    guildService: GuildService,
    logger: Logger,
  ): BirthdayChecker;
  createYouTubeChecker(
    client: Client,
    youtubeService: YouTubeService,
    youtubeRepo: YouTubeRepository,
    guildService: GuildService,
    logger: Logger,
  ): YouTubeChecker;
  createHoneypotWarning(
    client: Client,
    guildService: GuildService,
    honeypotService: HoneypotService,
    loggingService: LoggingService,
    logger: Logger,
  ): HoneypotWarningSync;
  startWebhookServer: typeof startWebhookServer;
  startPeriodicSync: typeof startPeriodicSync;
}

export const defaultStartupFactories: StartupFactories = {
  createScheduler: (client, scheduledMessageService, logger) =>
    new SchedulerManager(client, scheduledMessageService, logger),
  createBirthdayChecker: (client, birthdayService, guildService, logger) =>
    new BirthdayChecker(client, birthdayService, guildService, logger),
  createYouTubeChecker: (client, youtubeService, youtubeRepo, guildService, logger) =>
    new YouTubeChecker(client, youtubeService, youtubeRepo, guildService, logger),
  createHoneypotWarning: (client, guildService, honeypotService, loggingService, logger) =>
    new HoneypotWarningSync(client, guildService, honeypotService, loggingService, logger),
  startWebhookServer,
  startPeriodicSync,
};

/**
 * The clientReady startup sequence. The order is load-bearing (see AGENTS.md "Startup Sequence"): hydrate settings,
 * hydrate XP, load schedules, build the workers, start the webhook server and the 4-hour timer, then run the slow
 * birthday and YouTube checks, and the honeypot warning sync last. A rejection from any step except the final sync
 * propagates to the caller (in production, the unhandledRejection handler).
 */
export async function runStartup(
  readyClient: Client<true>,
  deps: StartupDeps,
  factories: StartupFactories = defaultStartupFactories,
): Promise<void> {
  const { client, ctx, youtubeRepo } = deps;
  const { logger, config } = ctx;
  const {
    guild: guildService,
    xp: xpService,
    scheduledMessage: scheduledMessageService,
    birthday: birthdayService,
    youtube: youtubeService,
    honeypot: honeypotService,
    logging: loggingService,
  } = ctx.services;

  logger.info({ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size }, "Bot is online");

  // Hydrate guild settings into memory (eliminates DB reads during normal operation)
  const guildCount = await guildService.hydrateAll();
  logger.info({ guildCount }, "Guild settings hydrated");

  // Hydrate XP data into memory
  await xpService.hydrate();

  // Start scheduled message cron jobs
  const scheduler = factories.createScheduler(client, scheduledMessageService, logger);
  await scheduler.loadAll();
  ctx.scheduler = scheduler;

  // Birthday checker — runs on startup (catch-up, below) and via 4-hour sync timer
  const birthdayChecker = factories.createBirthdayChecker(client, birthdayService, guildService, logger);

  // YouTube checker — runs on startup (below) and via 4-hour sync timer. Each run announces every
  // video newer than the last one seen, so restarts and the long interval don't drop uploads.
  const youtubeChecker = factories.createYouTubeChecker(client, youtubeService, youtubeRepo, guildService, logger);

  // Honeypot warning sync — runs on startup (below), via the 4-hour sync timer, after dashboard saves, on /admin reload
  // and when the warning is deleted
  const honeypotWarning = factories.createHoneypotWarning(
    client,
    guildService,
    honeypotService,
    loggingService,
    logger,
  );
  ctx.honeypotWarning = honeypotWarning;

  // Start webhook server for instant cache invalidation from web dashboard. Before the slow startup checks below,
  // so dashboard reload pings sent during them are not refused.
  if (config.BOT_WEBHOOK_SECRET) {
    factories.startWebhookServer({
      port: config.BOT_WEBHOOK_PORT,
      secret: config.BOT_WEBHOOK_SECRET,
      guildService,
      logger,
      getScheduler: () => ctx.scheduler,
      // A dashboard save for one server resets that server's repost budget, so an admin can retry its warning.
      onGuildReload: (guildId) =>
        guildId ? honeypotWarning.sync(guildId, { resetBudget: true }) : honeypotWarning.syncAll(),
    });
  }

  // Start 4-hour combined sync timer
  factories.startPeriodicSync({
    xpService,
    guildService,
    scheduler,
    birthdayChecker,
    youtubeChecker,
    honeypotWarning,
    logger,
  });

  // Startup birthday catch-up and YouTube check. After the webhook server and the timer, which they can take minutes
  // to finish.
  await birthdayChecker.check();
  logger.info("Birthday checker initialized");

  await youtubeChecker.check();
  logger.info("YouTube checker initialized");

  // Last, so a slow sync can't hold back the webhook server or the timer. Caught here too, so it can't crash the bot.
  try {
    await honeypotWarning.syncAll();
  } catch (err) {
    logger.error({ err }, "Startup honeypot warning sync failed");
  }
}
