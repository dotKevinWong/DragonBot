import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { scheduledMessages } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getDiscordIdFromRequest } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { z } from "zod";
import { markSchedulesDirty } from "@/lib/sync";

const updateSchema = z.object({
  channelId: z.string().max(20).min(1).optional(),
  message: z.string().max(4000).min(1).optional(),
  cronExpression: z.string().max(100).min(1).optional(),
  timezone: z.string().max(50).optional(),
  isEnabled: z.boolean().optional(),
  isEmbed: z.boolean().optional(),
  embedColor: z.string().max(7).nullable().optional(),
  embedTitle: z.string().max(256).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; scheduleId: string }> },
) {
  const discordId = getDiscordIdFromRequest(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId, scheduleId } = await params;

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const rows = await db
    .update(scheduledMessages)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(scheduledMessages.id, scheduleId), eq(scheduledMessages.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await markSchedulesDirty();
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; scheduleId: string }> },
) {
  const discordId = getDiscordIdFromRequest(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId, scheduleId } = await params;

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .delete(scheduledMessages)
    .where(and(eq(scheduledMessages.id, scheduleId), eq(scheduledMessages.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await markSchedulesDirty();
  return NextResponse.json({ success: true });
}
