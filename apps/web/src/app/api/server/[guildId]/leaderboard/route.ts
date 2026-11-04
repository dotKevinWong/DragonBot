import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isGuildMember } from "@/lib/discord";
import { getLeaderboardEntries } from "@/lib/leaderboard";
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

  const withUsers = await getLeaderboardEntries(guildId);

  return NextResponse.json(withUsers);
}
