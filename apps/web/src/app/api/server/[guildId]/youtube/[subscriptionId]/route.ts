import { NextResponse } from "next/server";
import { requireGuildAccess, FEATURE_ROUTE_BODIES, invalidDataResponse } from "@/lib/route-guard";
import { eq, and } from "drizzle-orm";
import { youtubeSubscriptions } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { z } from "zod";
import { notifyBotReload } from "@/lib/bot-webhook";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

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
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, uuidParams: ["subscriptionId"], scope: "youtube" });
  if (!access.ok) return access.response;
  const { guildId, subscriptionId } = access.params;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: false });
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
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, uuidParams: ["subscriptionId"], scope: "youtube" });
  if (!access.ok) return access.response;
  const { guildId, subscriptionId } = access.params;

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
