import { eq, desc, inArray, sql } from "drizzle-orm";
import { userXp, discordUserCache } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { resolveDiscordUsersWithin, type ResolvedDiscordUser } from "@/lib/discord";
import type { LeaderboardPage } from "@/lib/validators";

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

/** A stored name newer than this is used as it is; an older one is looked up again (and still shown if that fails). */
const NAME_FRESH_MS = 24 * 60 * 60 * 1000;
/** The longest a leaderboard load waits on Discord for names it doesn't have. */
const LOOKUP_BUDGET_MS = 2500;

type StoredUser = ResolvedDiscordUser & { updatedAt: Date };

/** The stored names for these ids. Any failure (for example the table not pushed yet) gives none. */
async function readStoredUsers(ids: string[]): Promise<Map<string, StoredUser>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        discordId: discordUserCache.discordId,
        username: discordUserCache.username,
        displayName: discordUserCache.displayName,
        avatarUrl: discordUserCache.avatarUrl,
        updatedAt: discordUserCache.updatedAt,
      })
      .from(discordUserCache)
      .where(inArray(discordUserCache.discordId, ids));
    return new Map(rows.map((r) => [r.discordId, { username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl, updatedAt: r.updatedAt }]));
  } catch {
    return new Map();
  }
}

/** Saves names just resolved. Failures are ignored: the next load looks them up again. */
async function storeUsers(users: Map<string, ResolvedDiscordUser>): Promise<void> {
  if (users.size === 0) return;
  const now = new Date();
  try {
    await db
      .insert(discordUserCache)
      .values([...users].map(([discordId, u]) => ({ discordId, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, updatedAt: now })))
      .onConflictDoUpdate({
        target: discordUserCache.discordId,
        set: {
          username: sql`excluded.username`,
          displayName: sql`excluded.display_name`,
          avatarUrl: sql`excluded.avatar_url`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  } catch {
    // Not stored this time
  }
}

/**
 * One page of the guild's ranking by total XP (by default the top 100), each with the Discord display name and avatar.
 * Names come from discord_user_cache; only missing or day-old ones are looked up, top ranks first, for at most
 * LOOKUP_BUDGET_MS, and what resolves is stored. A user with no name falls back to a stale stored one, then to
 * their Discord ID and a null avatar.
 * Shared by /api/leaderboard/[guildId] (public) and /api/server/[guildId]/leaderboard (members);
 * each route keeps its own checks and response wrapper.
 */
export async function getLeaderboardEntries(
  guildId: string,
  page: LeaderboardPage = { offset: 0, limit: 100 },
): Promise<LeaderboardEntry[]> {
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
    .limit(page.limit)
    .offset(page.offset);

  const ids = entries.map((e) => e.discordId);
  const stored = await readStoredUsers(ids);
  const freshAfter = Date.now() - NAME_FRESH_MS;
  const toLookUp = ids.filter((id) => {
    const s = stored.get(id);
    return !s || s.updatedAt.getTime() < freshAfter;
  });
  const looked = await resolveDiscordUsersWithin(toLookUp, LOOKUP_BUDGET_MS);
  await storeUsers(looked);

  return entries.map((entry) => {
    const user = looked.get(entry.discordId) ?? stored.get(entry.discordId);
    return {
      ...entry,
      displayName: user?.displayName ?? entry.discordId,
      avatarUrl: user?.avatarUrl ?? null,
    };
  });
}
