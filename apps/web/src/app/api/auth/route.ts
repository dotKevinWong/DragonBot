import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { authTokens } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { signJwt, getDiscordIdFromRequest } from "@/lib/auth";
import { getDiscordUser } from "@/lib/discord";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string };
    if (!body.token) {
      return NextResponse.json({ error: "Token is required", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    // Find token
    const rows = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.token, body.token))
      .limit(1);

    const record = rows[0];
    if (!record) {
      return NextResponse.json({ error: "Invalid token", code: "TOKEN_NOT_FOUND" }, { status: 404 });
    }

    if (record.used) {
      return NextResponse.json({ error: "Token already used", code: "TOKEN_USED" }, { status: 400 });
    }

    if (new Date() > record.expiresAt) {
      return NextResponse.json({ error: "Token expired", code: "TOKEN_EXPIRED" }, { status: 400 });
    }

    // Mark as used
    await db.update(authTokens).set({ used: true }).where(eq(authTokens.id, record.id));

    // Sign JWT
    const jwt = signJwt(record.discordId);

    return NextResponse.json({ jwt, discord_id: record.discordId });
  } catch {
    return NextResponse.json({ error: "Internal error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const discordId = getDiscordIdFromRequest(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const user = await getDiscordUser(discordId);
  return NextResponse.json({
    discord_id: discordId,
    username: user?.username ?? null,
    display_name: user?.displayName ?? null,
    avatar_url: user?.avatarUrl ?? null,
  });
}
