import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { profileUpdateSchema } from "@/lib/validators";
import { invalidDataResponse } from "@/lib/route-guard";
import { toSafeUser } from "@/lib/safe-rows";

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
  return NextResponse.json(toSafeUser(user));
}

export async function PATCH(request: Request) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = profileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: true });
  }

  const rows = await db
    .update(users)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(users.discordId, discordId))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Profile not found", code: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(toSafeUser(rows[0]!));
}
