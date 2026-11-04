import { NextResponse } from "next/server";
import { requireGuildAccess, FEATURE_ROUTE_BODIES, invalidDataResponse } from "@/lib/route-guard";
import { eq, asc } from "drizzle-orm";
import { youtubeSubscriptions } from "@dragonbot/db/schema";
import { YOUTUBE_CHANNEL_ID_RE } from "@dragonbot/db/contracts";
import { db } from "@/lib/db";
import { z } from "zod";
import { notifyBotReload } from "@/lib/bot-webhook";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

const createSchema = z.object({
  youtubeChannelId: z.string().regex(YOUTUBE_CHANNEL_ID_RE, "Invalid YouTube channel ID (must start with UC)"),
  youtubeChannelName: z.string().trim().max(200).nullable().optional(),
  notifyChannelId: z.string().regex(DISCORD_SNOWFLAKE_RE, "Invalid channel ID"),
  customMessage: z.string().trim().max(2000).nullable().optional(),
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
    .from(youtubeSubscriptions)
    .where(eq(youtubeSubscriptions.guildId, guildId))
    .orderBy(asc(youtubeSubscriptions.createdAt));

  return NextResponse.json(rows);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, scope: "youtube" });
  if (!access.ok) return access.response;
  const { guildId } = access.params;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: false });
  }

  try {
    const rows = await db
      .insert(youtubeSubscriptions)
      .values({
        guildId,
        ...parsed.data,
      })
      .returning();

    notifyBotReload(guildId);
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: unknown) {
    // Handle unique constraint violation (duplicate YouTube channel per guild)
    if (err instanceof Error && err.message.includes("youtube_subs_guild_channel_unique")) {
      return NextResponse.json(
        { error: "This YouTube channel is already subscribed in this server" },
        { status: 409 },
      );
    }
    throw err;
  }
}
