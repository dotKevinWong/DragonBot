import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guilds, guildAdmins } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  checkGuildPermission,
  isGuildMember,
  getGuildIconUrl,
  createDiscordLookupMemo,
  mapWithConcurrency,
} from "@/lib/discord";

interface GuildInfo {
  guildId: string;
  guildName: string | null;
  iconUrl: string | null;
  isAdmin: boolean;
}

const MAX_DISCORD_CHECKS = 20; // Limit Discord API calls to prevent rate limiting
/** Guild checks in flight at once: the bot token's rate limit is shared with the running bot. */
const DISCORD_CHECK_CONCURRENCY = 4;

export async function GET(request: Request) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  // Each guild and member is fetched from Discord at most once in this request (failures are retried)
  const discordMemo = createDiscordLookupMemo();

  // Get all guilds the bot knows about
  const allGuilds = await db.select({
    guildId: guilds.guildId,
    guildName: guilds.guildName,
  }).from(guilds);

  // Get guilds where user is a custom admin (guaranteed access, no Discord API needed)
  const customAdminGuilds = await db.select({
    guildId: guildAdmins.guildId,
  }).from(guildAdmins).where(eq(guildAdmins.discordId, discordId));

  const customAdminGuildIds = new Set(customAdminGuilds.map((g) => g.guildId));

  const accessible: GuildInfo[] = [];
  const checkedGuildIds = new Set<string>();

  // First: add all custom admin guilds (no Discord API calls)
  for (const guild of allGuilds) {
    if (customAdminGuildIds.has(guild.guildId)) {
      accessible.push({ ...guild, iconUrl: null, isAdmin: true });
      checkedGuildIds.add(guild.guildId);
    }
  }

  // Then: check Discord permissions for remaining guilds (limited to prevent rate exhaustion).
  // Every guild without a guild_admins row uses one check whatever its outcome, so the first
  // MAX_DISCORD_CHECKS of them, in allGuilds order, are checked.
  const toCheck = allGuilds
    .filter((guild) => !checkedGuildIds.has(guild.guildId))
    .slice(0, MAX_DISCORD_CHECKS);

  // A few checks at a time; results are kept by index, so the order is allGuilds order whatever finishes first.
  const checked = await mapWithConcurrency(toCheck, DISCORD_CHECK_CONCURRENCY, async (guild): Promise<GuildInfo | null> => {
    const hasAdmin = await checkGuildPermission(guild.guildId, discordId, undefined, discordMemo);
    if (hasAdmin) return { ...guild, iconUrl: null, isAdmin: true };
    // Not an admin — check if they're a member (for leaderboard access)
    const isMember = await isGuildMember(guild.guildId, discordId, discordMemo);
    if (isMember) return { ...guild, iconUrl: null, isAdmin: false };
    return null;
  });
  for (const info of checked) {
    if (info) accessible.push(info);
  }

  // Fetch icons in parallel for accessible guilds (batch, not sequential)
  const withIcons = await Promise.all(
    accessible.map(async (guild) => {
      const iconUrl = await getGuildIconUrl(guild.guildId, discordMemo);
      return { ...guild, iconUrl };
    }),
  );

  return NextResponse.json(withIcons);
}
