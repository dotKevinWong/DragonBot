import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guilds, guildAdmins } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission, isGuildMember, getGuildIconUrl } from "@/lib/discord";

interface GuildInfo {
  guildId: string;
  guildName: string | null;
  iconUrl: string | null;
  isAdmin: boolean;
}

const MAX_DISCORD_CHECKS = 20; // Limit Discord API calls to prevent rate limiting

export async function GET(request: Request) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

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

  // Then: check Discord permissions for remaining guilds (limited to prevent rate exhaustion)
  let discordChecks = 0;
  for (const guild of allGuilds) {
    if (checkedGuildIds.has(guild.guildId)) continue;
    if (discordChecks >= MAX_DISCORD_CHECKS) break;

    discordChecks++;
    const hasAdmin = await checkGuildPermission(guild.guildId, discordId);
    if (hasAdmin) {
      accessible.push({ ...guild, iconUrl: null, isAdmin: true });
      checkedGuildIds.add(guild.guildId);
    } else {
      // Not an admin — check if they're a member (for leaderboard access)
      const isMember = await isGuildMember(guild.guildId, discordId);
      if (isMember) {
        accessible.push({ ...guild, iconUrl: null, isAdmin: false });
        checkedGuildIds.add(guild.guildId);
      }
    }
  }

  // Fetch icons in parallel for accessible guilds (batch, not sequential)
  const withIcons = await Promise.all(
    accessible.map(async (guild) => {
      const iconUrl = await getGuildIconUrl(guild.guildId);
      return { ...guild, iconUrl };
    }),
  );

  return NextResponse.json(withIcons);
}
