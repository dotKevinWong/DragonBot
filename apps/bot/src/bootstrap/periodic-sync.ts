import type { Logger } from "pino";
import type { GuildService } from "../services/guild.service.js";
import type { XpService } from "../services/xp.service.js";
import type { SchedulerManager } from "../lib/scheduler.js";
import type { BirthdayChecker } from "../lib/birthday-checker.js";
import type { YouTubeChecker } from "../lib/youtube-checker.js";
import type { HoneypotWarningSync } from "../lib/honeypot-warning.js";

export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export interface PeriodicSyncDeps {
  xpService: XpService;
  guildService: GuildService;
  scheduler: SchedulerManager;
  birthdayChecker: BirthdayChecker;
  youtubeChecker: YouTubeChecker;
  honeypotWarning: HoneypotWarningSync;
  logger: Logger;
}

/** Starts the 4-hour combined sync timer: flush XP + reload schedules in one DB connection window. Unref'd. */
export function startPeriodicSync(deps: PeriodicSyncDeps): ReturnType<typeof setInterval> {
  const { xpService, guildService, scheduler, birthdayChecker, youtubeChecker, honeypotWarning, logger } = deps;
  const syncTimer = setInterval(async () => {
    try {
      await xpService.flush();
      await guildService.hydrateAll();
      await scheduler.reload();
      await birthdayChecker.check();
      await youtubeChecker.check();
      logger.info("Periodic sync complete (XP flush + guild settings + schedule reload + birthday check + YouTube check)");
    } catch (err) {
      logger.error({ err }, "Periodic sync failed");
    }
    // After the birthday check: it lists servers from the settings cache, and this sync's writes drop entries from it.
    // Caught on its own, so a failed earlier step doesn't skip it.
    try {
      await honeypotWarning.syncAll();
    } catch (err) {
      logger.error({ err }, "Periodic honeypot warning sync failed");
    }
  }, FOUR_HOURS_MS);
  if (syncTimer.unref) syncTimer.unref();
  return syncTimer;
}
