import { NextResponse } from "next/server";
import { requireGuildAccess, FEATURE_ROUTE_BODIES, invalidDataResponse } from "@/lib/route-guard";
import { eq, and } from "drizzle-orm";
import { scheduledMessages } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
import { z } from "zod";
import { notifyBotReload } from "@/lib/bot-webhook";
import { cronExpressionSchema, embedColorSchema, DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

const updateSchema = z.object({
  channelId: z.string().regex(DISCORD_SNOWFLAKE_RE, "Invalid channel ID").optional(),
  message: z.string().trim().max(4000).min(1).optional(),
  cronExpression: cronExpressionSchema.optional(),
  timezone: z.string().max(50).optional(),
  isEnabled: z.boolean().optional(),
  isEmbed: z.boolean().optional(),
  embedColor: embedColorSchema,
  embedTitle: z.string().trim().max(256).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; scheduleId: string }> },
) {
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, uuidParams: ["scheduleId"], scope: "schedules" });
  if (!access.ok) return access.response;
  const { guildId, scheduleId } = access.params;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: false });
  }

  const rows = await db
    .update(scheduledMessages)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(scheduledMessages.id, scheduleId), eq(scheduledMessages.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  notifyBotReload(guildId);
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; scheduleId: string }> },
) {
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, uuidParams: ["scheduleId"], scope: "schedules" });
  if (!access.ok) return access.response;
  const { guildId, scheduleId } = access.params;

  const rows = await db
    .delete(scheduledMessages)
    .where(and(eq(scheduledMessages.id, scheduleId), eq(scheduledMessages.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  notifyBotReload(guildId);
  return NextResponse.json({ success: true });
}
