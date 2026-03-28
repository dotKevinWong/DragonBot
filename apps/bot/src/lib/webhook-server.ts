import http from "node:http";
import crypto from "node:crypto";
import type { Logger } from "pino";
import type { GuildService } from "../services/guild.service.js";
import type { SchedulerManager } from "./scheduler.js";

const SNOWFLAKE_RE = /^[0-9]{17,20}$/;

interface WebhookServerOptions {
  port: number;
  secret: string;
  guildService: GuildService;
  logger: Logger;
  getScheduler: () => SchedulerManager | undefined;
}

/**
 * Minimal HTTP server for receiving webhook callbacks from the web dashboard.
 * Used to instantly invalidate caches when settings change via the web UI.
 */
export function startWebhookServer(options: WebhookServerOptions): http.Server {
  const { port, secret, guildService, logger, getScheduler } = options;
  const log = logger.child({ component: "webhook-server" });

  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Auth check (timing-safe comparison to prevent secret leakage)
    const authHeader = req.headers["authorization"] ?? "";
    const expected = `Bearer ${secret}`;
    const authValid =
      authHeader.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
    if (!authValid) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // POST /webhook/reload?guildId=xxx — reload a specific guild's settings
    if (req.method === "POST" && req.url?.startsWith("/webhook/reload")) {
      const url = new URL(req.url, `http://localhost:${port}`);
      const guildId = url.searchParams.get("guildId");

      // Validate guildId format before processing
      if (guildId && !SNOWFLAKE_RE.test(guildId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid guildId format" }));
        return;
      }

      try {
        if (guildId) {
          // Invalidate specific guild and re-fetch from DB
          guildService.invalidateCache(guildId);
          await guildService.getSettings(guildId);
          log.info({ guildId }, "Guild settings reloaded via webhook");
        } else {
          // Full re-hydrate
          await guildService.hydrateAll();
          log.info("All guild settings reloaded via webhook");
        }

        // Also reload schedules in case those changed
        const scheduler = getScheduler();
        if (scheduler) {
          await scheduler.reload();
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        log.error({ err, guildId }, "Webhook reload failed");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // 404 for everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, () => {
    log.info({ port }, "Webhook server listening");
  });

  return server;
}
