import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { youtubeSubscriptions } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { z } from "zod";
import { notifyBotReload } from "@/lib/bot-webhook";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z.object({
  notifyChannelId: z.string().regex(DISCORD_SNOWFLAKE_RE, "Invalid channel ID").optional(),
  youtubeChannelName: z.string().trim().max(200).nullable().optional(),
  customMessage: z.string().trim().max(2000).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; subscriptionId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId, subscriptionId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId) || !UUID_RE.test(subscriptionId)) {
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
    .update(youtubeSubscriptions)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(youtubeSubscriptions.id, subscriptionId), eq(youtubeSubscriptions.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  notifyBotReload(guildId);
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; subscriptionId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId, subscriptionId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId) || !UUID_RE.test(subscriptionId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .delete(youtubeSubscriptions)
    .where(and(eq(youtubeSubscriptions.id, subscriptionId), eq(youtubeSubscriptions.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  notifyBotReload(guildId);
  return NextResponse.json({ success: true });
}
