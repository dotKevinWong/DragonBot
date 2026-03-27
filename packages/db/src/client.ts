import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DrizzleClient = ReturnType<typeof createBotClient>;

export function createBotClient(databaseUrl: string) {
  const client = postgres(databaseUrl);
  return drizzlePostgres(client, { schema });
}
