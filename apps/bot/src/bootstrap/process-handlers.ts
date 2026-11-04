import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { XpService } from "../services/xp.service.js";
import type { HoneypotService } from "../services/honeypot.service.js";

export interface ProcessHandlerDeps {
  logger: Logger;
  client: Client;
  xpService: XpService;
  honeypotService: HoneypotService;
}

/**
 * Registers graceful shutdown (SIGTERM/SIGINT) and the crash handlers (uncaughtException/unhandledRejection).
 * index.ts calls this after client.login() resolves, as before.
 */
export function installProcessHandlers(deps: ProcessHandlerDeps): void {
  const { logger, client, xpService, honeypotService } = deps;

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
      // Let in-flight honeypot actions finish: destroy() clears the REST token, which would strand a kick between
      // its ban and its unban
      await honeypotService.drain(5_000);
      // Disconnect from Discord to stop receiving new events
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

  // Shared by both crash handlers. The fatal fields differ ({ err } vs { reason }) and are passed through as given.
  // No shutdown guard or deadline here, as before.
  const flushAndExit = async (fields: Record<string, unknown>, message: string) => {
    logger.fatal(fields, message);
    try {
      await xpService.flush();
    } catch (flushErr) {
      logger.error({ err: flushErr }, "Failed to flush XP during crash");
    }
    process.exit(1);
  };

  process.on("uncaughtException", (err) => flushAndExit({ err }, "Uncaught exception — flushing XP before exit"));
  process.on("unhandledRejection", (reason) =>
    flushAndExit({ reason }, "Unhandled rejection — flushing XP before exit"),
  );
}
