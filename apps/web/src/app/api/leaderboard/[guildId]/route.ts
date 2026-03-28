import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { userXp, guilds } from "@dragonbot/db";
import { db } from "@/lib/db";
import { resolveDiscordUser } from "@/lib/discord";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
  }

  const guildRows = await db
    .select({ guildName: guilds.guildName })
    .from(guilds)
    .where(eq(guilds.guildId, guildId))
    .limit(1);

  if (guildRows.length === 0) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
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

  return NextResponse.json({
    guildName: guildRows[0]!.guildName,
    entries: withUsers,
  });
}
