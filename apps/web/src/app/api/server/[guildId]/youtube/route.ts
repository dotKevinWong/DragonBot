import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { youtubeSubscriptions } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { z } from "zod";
import { notifyBotReload } from "@/lib/bot-webhook";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

const YOUTUBE_CHANNEL_ID_RE = /^UC[\w-]{22}$/;

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
    .from(youtubeSubscriptions)
    .where(eq(youtubeSubscriptions.guildId, guildId))
    .orderBy(asc(youtubeSubscriptions.createdAt));

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
