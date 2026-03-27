import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guildAdmins } from "@dragonbot/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { env } from "@/lib/env";
import { db } from "@/lib/db";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { guildId } = await params;

  // Check guild_admins table first (no Discord API call), then fall back to Discord permission
  const adminRows = await db.select().from(guildAdmins).where(eq(guildAdmins.discordId, discordId)).limit(1);
  const isCustomAdmin = adminRows.some((r) => r.guildId === guildId);

  if (!isCustomAdmin) {
    const hasPermission = await checkGuildPermission(guildId, discordId);
    if (!hasPermission) {
      return NextResponse.json({ error: "Forbidden", code: "UNAUTHORIZED" }, { status: 403 });
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
      channels.sort((a, b) => {
        const rawA = raw.find((r) => r.id === a.id);
        const rawB = raw.find((r) => r.id === b.id);
        return (rawA?.position ?? 0) - (rawB?.position ?? 0);
      });
    }

    const roles: { id: string; name: string; color: string }[] = [];
    if (rolesRes.ok) {
      const raw = (await rolesRes.json()) as DiscordRole[];
      for (const role of raw) {
        if (role.name === "@everyone") continue;
        const color = role.color === 0 ? "#b5bac1" : `#${role.color.toString(16).padStart(6, "0")}`;
        roles.push({ id: role.id, name: role.name, color });
      }
      roles.sort((a, b) => {
        const rawA = raw.find((r) => r.id === a.id);
        const rawB = raw.find((r) => r.id === b.id);
        return (rawB?.position ?? 0) - (rawA?.position ?? 0); // Higher position = higher in hierarchy
      });
    }

    return NextResponse.json({ channels, roles });
  } catch {
    return NextResponse.json({ error: "Failed to fetch Discord data" }, { status: 500 });
  }
}
