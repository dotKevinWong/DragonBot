import { eq, desc } from "drizzle-orm";
import { userXp } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { resolveDiscordUsers } from "@/lib/discord";

/** One leaderboard row as both leaderboard routes return it (key order is part of the response). */
export interface LeaderboardEntry {
  discordId: string;
  totalXp: number;
  level: number;
  messageCount: number;
  xpMessageCount: number;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * The guild's top 100 by total XP, each with the Discord display name and avatar.
 * An unresolved user falls back to their Discord ID and a null avatar.
 * Shared by /api/leaderboard/[guildId] (public) and /api/server/[guildId]/leaderboard (members);
 * each route keeps its own checks and response wrapper.
 */
export async function getLeaderboardEntries(guildId: string): Promise<LeaderboardEntry[]> {
  const entries = await db
    .select({
      discordId: userXp.discordId,
      totalXp: userXp.totalXp,
      level: userXp.level,
      messageCount: userXp.messageCount,
      xpMessageCount: userXp.xpMessageCount,
    })
    .from(userXp)
    .where(eq(userXp.guildId, guildId))
    .orderBy(desc(userXp.totalXp))
    .limit(100);

  const userMap = await resolveDiscordUsers(entries.map((e) => e.discordId));
  return entries.map((entry) => {
    const user = userMap.get(entry.discordId);
    return {
      ...entry,
      displayName: user?.displayName ?? entry.discordId,
      avatarUrl: user?.avatarUrl ?? null,
    };
  });
}
