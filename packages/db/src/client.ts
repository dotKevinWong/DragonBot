import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { Logger as DrizzleLogger } from "drizzle-orm/logger";
import postgres from "postgres";
import * as schema from "./schema";

export type DrizzleClient = ReturnType<typeof createBotClient>;

class NeonActivityLogger implements DrizzleLogger {
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

export function createBotClient(databaseUrl: string) {
  const client = postgres(databaseUrl);
  return drizzlePostgres(client, {
    schema,
    logger: new NeonActivityLogger(),
  });
}
