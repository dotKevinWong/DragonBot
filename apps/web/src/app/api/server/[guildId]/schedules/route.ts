import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { scheduledMessages } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { z } from "zod";
import { notifyBotReload } from "@/lib/bot-webhook";
import { cronExpressionSchema, embedColorSchema, DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

const createSchema = z.object({
  channelId: z.string().regex(DISCORD_SNOWFLAKE_RE, "Invalid channel ID"),
  message: z.string().trim().max(4000).min(1),
  cronExpression: cronExpressionSchema,
  timezone: z.string().max(50).optional().default("America/New_York"),
  isEmbed: z.boolean().optional().default(false),
  embedColor: embedColorSchema,
  embedTitle: z.string().trim().max(256).nullable().optional(),
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

  if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

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

  if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

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

  notifyBotReload(guildId);
  return NextResponse.json(rows[0], { status: 201 });
}
