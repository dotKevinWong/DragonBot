import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { userXp } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { isGuildMember, resolveDiscordUser } from "@/lib/discord";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { guildId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  // Any guild member can view the leaderboard (not just admins)
  const isMember = await isGuildMember(guildId, discordId);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

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

  // Resolve Discord usernames in parallel
  const withUsers = await Promise.all(
    entries.map(async (entry) => {
      const user = await resolveDiscordUser(entry.discordId);
      return {
        ...entry,
        displayName: user?.displayName ?? entry.discordId,
        avatarUrl: user?.avatarUrl ?? null,
      };
    }),
  );

  return NextResponse.json(withUsers);
}
