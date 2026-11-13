import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guilds } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { getLeaderboardEntries } from "@/lib/leaderboard";
import { DISCORD_SNOWFLAKE_RE, parseLeaderboardPage } from "@/lib/validators";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
  }

  const page = parseLeaderboardPage(request.url);
  if (!page) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const guildRows = await db
    .select({ guildName: guilds.guildName })
    .from(guilds)
    .where(eq(guilds.guildId, guildId))
    .limit(1);

  if (guildRows.length === 0) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
  }

  const withUsers = await getLeaderboardEntries(guildId, page);

  return NextResponse.json({
    guildName: guildRows[0]!.guildName,
    entries: withUsers,
  });
}
