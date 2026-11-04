import type { Logger as DrizzleLogger } from "drizzle-orm/logger";

/** Logs every Drizzle query as one JSON line. Shared by the bot and serverless clients. */
export class NeonActivityLogger implements DrizzleLogger {
  logQuery(query: string): void {
    const timestamp = new Date().toISOString();
    const command = query.split(/\s+/)[0]?.toUpperCase() ?? "UNKNOWN";
    console.log(JSON.stringify({
      level: "info",
      msg: "DB query executed",
      source: "neon",
      timestamp,
      command,
      query: query.length > 200 ? `${query.slice(0, 200)}…` : query,
    }));
  }
}
