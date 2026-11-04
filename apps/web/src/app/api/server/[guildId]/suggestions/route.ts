import { NextResponse } from "next/server";
import { requireGuildAccess, FEATURE_ROUTE_BODIES } from "@/lib/route-guard";
import { eq, desc } from "drizzle-orm";
import { suggestions } from "@dragonbot/db/schema";
import { db } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES });
  if (!access.ok) return access.response;
  const { guildId } = access.params;

  const rows = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.guildId, guildId))
    .orderBy(desc(suggestions.createdAt));

  return NextResponse.json(rows);
}
