import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export function createServerlessClient(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzleNeon(sql, { schema });
}
