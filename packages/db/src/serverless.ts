import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { Logger as DrizzleLogger } from "drizzle-orm/logger";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

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

export function createServerlessClient(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzleNeon(sql, {
    schema,
    logger: new NeonActivityLogger(),
  });
}
