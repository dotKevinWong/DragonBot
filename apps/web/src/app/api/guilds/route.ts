import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guilds, guildAdmins } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getDiscordIdFromRequest } from "@/lib/auth";
import { checkGuildPermission, getGuildIconUrl } from "@/lib/discord";

interface GuildInfo {
  guildId: string;
  guildName: string | null;
  iconUrl: string | null;
}

export async function GET(request: Request) {
  const discordId = getDiscordIdFromRequest(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  // Get all guilds the bot knows about
  const allGuilds = await db.select({
    guildId: guilds.guildId,
    guildName: guilds.guildName,
  }).from(guilds);

  // Get guilds where user is a custom admin
  const customAdminGuilds = await db.select({
    guildId: guildAdmins.guildId,
  }).from(guildAdmins).where(eq(guildAdmins.discordId, discordId));

  const customAdminGuildIds = new Set(customAdminGuilds.map((g) => g.guildId));

  // Check permissions and fetch icons for accessible guilds
  const accessible: GuildInfo[] = [];

  for (const guild of allGuilds) {
    let hasAccess = false;

    if (customAdminGuildIds.has(guild.guildId)) {
      hasAccess = true;
    } else {
      hasAccess = await checkGuildPermission(guild.guildId, discordId);
    }

    if (hasAccess) {
      const iconUrl = await getGuildIconUrl(guild.guildId);
      accessible.push({ ...guild, iconUrl });
    }
  }

  return NextResponse.json(accessible);
}
