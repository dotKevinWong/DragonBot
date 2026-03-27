import { eq } from "drizzle-orm";
import { syncFlags } from "@dragonbot/db";
import { db } from "./db";

/** Signal the bot to re-sync scheduled messages */
export async function markSchedulesDirty(): Promise<void> {
  await db
    .insert(syncFlags)
    .values({ key: "schedules", dirty: true })
    .onConflictDoUpdate({
      target: syncFlags.key,
      set: { dirty: true, updatedAt: new Date() },
    });
}
