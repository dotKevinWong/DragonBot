import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { suggestions } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { z } from "zod";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = ["pending", "approved", "rejected", "completed", "archived"] as const;

const updateSchema = z.object({
  status: z.enum(VALID_STATUSES),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; suggestionId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId, suggestionId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId) || !UUID_RE.test(suggestionId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", ...(process.env.NODE_ENV !== "production" && { details: parsed.error.issues }) },
      { status: 400 },
    );
  }

  const rows = await db
    .update(suggestions)
    .set({ status: parsed.data.status })
    .where(and(eq(suggestions.id, suggestionId), eq(suggestions.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; suggestionId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId, suggestionId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId) || !UUID_RE.test(suggestionId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .update(suggestions)
    .set({ status: "archived" })
    .where(and(eq(suggestions.id, suggestionId), eq(suggestions.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
