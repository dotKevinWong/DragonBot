import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { scheduledMessages } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { z } from "zod";
import { markSchedulesDirty } from "@/lib/sync";

const createSchema = z.object({
  channelId: z.string().max(20).min(1),
  message: z.string().max(4000).min(1),
  cronExpression: z.string().max(100).min(1).regex(
    /^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+$/,
    "Invalid cron expression format (expected 5 fields)",
  ),
  timezone: z.string().max(50).optional().default("America/New_York"),
  isEmbed: z.boolean().optional().default(false),
  embedColor: z.string().max(7).nullable().optional(),
  embedTitle: z.string().max(256).nullable().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId } = await params;

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.guildId, guildId))
    .orderBy(asc(scheduledMessages.createdAt));

  return NextResponse.json(rows);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId } = await params;

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", ...(process.env.NODE_ENV !== "production" && { details: parsed.error.issues }) },
      { status: 400 },
    );
  }

  const rows = await db
    .insert(scheduledMessages)
    .values({
      guildId,
      createdBy: discordId,
      ...parsed.data,
    })
    .returning();

  await markSchedulesDirty();
  return NextResponse.json(rows[0], { status: 201 });
}
