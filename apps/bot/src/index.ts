import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBotClient } from "@dragonbot/db";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname2, "../../../.env") });
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { createClient } from "./client.js";
import { buildServices } from "./bootstrap/services.js";
import { runStartup } from "./bootstrap/startup.js";
import { installProcessHandlers } from "./bootstrap/process-handlers.js";
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

  // 3-5. External services, repositories, services (bootstrap/services.ts)
  const { ai, services, youtubeRepo } = buildServices(config, logger, db);

  // 6. Context
  const ctx: BotContext = {
    logger,
    ai,
    config,
    services,
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

  // 9. Ready event: hydration, scheduler, webhook server, 4-hour timer, startup checks (bootstrap/startup.ts).
  // Registered before login; a rejection reaches the unhandledRejection handler.
  client.once("clientReady", (c) => runStartup(c, { client, ctx, youtubeRepo }));

  // 10. Login
  await client.login(config.DISCORD_API_TOKEN);

  // 11. Graceful shutdown + crash handlers (bootstrap/process-handlers.ts), after login as before
  installProcessHandlers({ logger, client, xpService: services.xp, honeypotService: services.honeypot });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
