import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { profileUpdateSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const rows = await db.select().from(users).where(eq(users.discordId, discordId)).limit(1);
  const user = rows[0];

  if (!user) {
    return NextResponse.json({ error: "Profile not found", code: "NOT_FOUND" }, { status: 404 });
  }

  // Strip sensitive fields
  const { id: _id, email: _email, jwtInvalidBefore: _jib, banGuildId: _bg, bannedAt: _ba, isBanned: _ib, ...safeUser } = user;
  return NextResponse.json(safeUser);
}

export async function PATCH(request: Request) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", code: "VALIDATION_ERROR", ...(process.env.NODE_ENV !== "production" && { details: parsed.error.issues }) },
      { status: 400 },
    );
  }

  const rows = await db
    .update(users)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(users.discordId, discordId))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Profile not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const { id: _id, email: _email, jwtInvalidBefore: _jib, banGuildId: _bg, bannedAt: _ba, isBanned: _ib, ...safeUpdated } = rows[0]!;
  return NextResponse.json(safeUpdated);
}
