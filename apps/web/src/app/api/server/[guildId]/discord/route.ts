import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { guildAdmins } from "@dragonbot/db/schema";
import { checkGuildPermission } from "@/lib/discord";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { authenticateGuildRequest, DISCORD_ROUTE_BODIES } from "@/lib/route-guard";

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

// Discord channel types
const GUILD_TEXT = 0;
const GUILD_VOICE = 2;
const GUILD_CATEGORY = 4;
const GUILD_ANNOUNCEMENT = 5;
const GUILD_FORUM = 15;

/**
 * Each id's position, looked up once instead of a find() per comparison.
 * The first entry for an id wins, as find() did; a missing position stays undefined (sorted as 0).
 */
function firstPositions(raw: { id: string; position?: number | null }[]): Map<string, number | null | undefined> {
  const position = new Map<string, number | null | undefined>();
  for (const r of raw) {
    if (!position.has(r.id)) position.set(r.id, r.position);
  }
  return position;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const auth = await authenticateGuildRequest(request, params, DISCORD_ROUTE_BODIES);
  if (!auth.ok) return auth.response;
  const { discordId, params: { guildId } } = auth;

  // Check guild_admins table first (no Discord API call), then fall back to Discord permission
  // A row with an empty permission list grants nothing, as in checkGuildPermission.
  const adminRows = await db
    .select()
    .from(guildAdmins)
    .where(and(eq(guildAdmins.guildId, guildId), eq(guildAdmins.discordId, discordId)))
    .limit(1);
  const isCustomAdmin = adminRows.some((r) => r.permissions.length > 0);

  if (!isCustomAdmin) {
    const hasPermission = await checkGuildPermission(guildId, discordId);
    if (!hasPermission) {
      return NextResponse.json(DISCORD_ROUTE_BODIES.forbidden, { status: 403 });
    }
  }

  try {
    const headers = { Authorization: `Bot ${env.DISCORD_API_TOKEN}` };

    // Fetch channels and roles in parallel
    const [channelsRes, rolesRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
      fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers }),
    ]);

    const channels: { id: string; name: string; type: string }[] = [];
    if (channelsRes.ok) {
      const raw = (await channelsRes.json()) as DiscordChannel[];
      for (const ch of raw) {
        let type: string;
        switch (ch.type) {
          case GUILD_TEXT: type = "text"; break;
          case GUILD_VOICE: type = "voice"; break;
          case GUILD_CATEGORY: type = "category"; break;
          case GUILD_ANNOUNCEMENT: type = "announcement"; break;
          case GUILD_FORUM: type = "forum"; break;
          default: type = "other"; break;
        }
        channels.push({ id: ch.id, name: ch.name, type });
      }
      // Sort by position, filter out categories
      const position = firstPositions(raw);
      channels.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    }

    const roles: { id: string; name: string; color: string }[] = [];
    if (rolesRes.ok) {
      const raw = (await rolesRes.json()) as DiscordRole[];
      for (const role of raw) {
        if (role.name === "@everyone") continue;
        const color = role.color === 0 ? "#b5bac1" : `#${role.color.toString(16).padStart(6, "0")}`;
        roles.push({ id: role.id, name: role.name, color });
      }
      const position = firstPositions(raw);
      roles.sort((a, b) => (position.get(b.id) ?? 0) - (position.get(a.id) ?? 0)); // Higher position = higher in hierarchy
    }

    return NextResponse.json({ channels, roles });
  } catch {
    return NextResponse.json({ error: "Failed to fetch Discord data" }, { status: 500 });
  }
}
