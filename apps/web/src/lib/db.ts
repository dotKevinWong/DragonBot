import { createServerlessClient } from "@dragonbot/db/serverless";
import { env } from "./env";

let _db: ReturnType<typeof createServerlessClient> | null = null;

export function getDb() {
  if (!_db) {
    _db = createServerlessClient(env.DATABASE_URL);
  }
  return _db;
}

// Proxy for backward compatibility — lazily creates the db on first access
export const db = new Proxy({} as ReturnType<typeof createServerlessClient>, {
  get(_, prop) {
    const instance = getDb();
    const value = instance[prop as keyof typeof instance];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
