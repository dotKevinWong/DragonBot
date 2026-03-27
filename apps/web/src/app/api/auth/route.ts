import { NextResponse } from "next/server";
import { eq, and, lt, gt } from "drizzle-orm";
import { authTokens } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { signJwt, getDiscordIdFromRequest, getJwtPayloadFromRequest, createSessionCookie, clearSessionCookie } from "@/lib/auth";
import { getDiscordUser } from "@/lib/discord";
import { users } from "@dragonbot/db/schema";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string };
    if (!body.token) {
      return NextResponse.json({ error: "Token is required", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    // Atomic token exchange — find valid token AND mark as used in one query
    // Prevents race conditions (double-spend) and returns unified error
    const rows = await db
      .update(authTokens)
      .set({ used: true })
      .where(
        and(
          eq(authTokens.token, body.token),
          eq(authTokens.used, false),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning();

    const record = rows[0];
    if (!record) {
      return NextResponse.json({ error: "Invalid or expired token. Please use /login in Discord to get a new link.", code: "INVALID_TOKEN" }, { status: 401 });
    }

    // Sign JWT and set as httpOnly cookie
    const jwt = signJwt(record.discordId);
    const response = NextResponse.json({ discord_id: record.discordId });
    response.headers.set("Set-Cookie", createSessionCookie(jwt));

    // Clean up expired tokens (piggyback on token exchange — no extra requests)
    db.delete(authTokens)
      .where(lt(authTokens.expiresAt, new Date()))
      .then(() => {})
      .catch(() => {});

    return response;
  } catch {
    return NextResponse.json({ error: "Internal error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const discordId = getDiscordIdFromRequest(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  // Check JWT revocation
  const jwtPayload = getJwtPayloadFromRequest(request);
  if (jwtPayload) {
    const userRows = await db
      .select({ jwtInvalidBefore: users.jwtInvalidBefore })
      .from(users)
      .where(eq(users.discordId, discordId))
      .limit(1);

    const user = userRows[0];
    if (user?.jwtInvalidBefore) {
      const issuedAt = new Date(jwtPayload.iat * 1000);
      if (issuedAt < user.jwtInvalidBefore) {
        // JWT was issued before revocation — clear cookie and reject
        const response = NextResponse.json({ error: "Session revoked", code: "UNAUTHORIZED" }, { status: 401 });
        response.headers.set("Set-Cookie", clearSessionCookie());
        return response;
      }
    }
  }

  const discordUser = await getDiscordUser(discordId);
  return NextResponse.json({
    discord_id: discordId,
    username: discordUser?.username ?? null,
    display_name: discordUser?.displayName ?? null,
    avatar_url: discordUser?.avatarUrl ?? null,
  });
}

/** DELETE /api/auth — clear session cookie (logout) */
export async function DELETE(request: Request) {
  const discordId = getDiscordIdFromRequest(request);
  if (!discordId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
