import { NextResponse } from "next/server";
import { requireGuildAccess, FEATURE_ROUTE_BODIES, invalidDataResponse } from "@/lib/route-guard";
import { eq, asc } from "drizzle-orm";
import { scheduledMessages } from "@dragonbot/db/schema";
import { db } from "@/lib/db";
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
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES });
  if (!access.ok) return access.response;
  const { guildId } = access.params;

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
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, scope: "schedules" });
  if (!access.ok) return access.response;
  const { discordId, params: { guildId } } = access;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: false });
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
