import { NextResponse } from "next/server";
import { requireGuildAccess, FEATURE_ROUTE_BODIES, invalidDataResponse } from "@/lib/route-guard";
import { eq, and } from "drizzle-orm";
import { suggestions } from "@dragonbot/db/schema";
import { SUGGESTION_STATUSES } from "@dragonbot/db/contracts";
import { db } from "@/lib/db";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(SUGGESTION_STATUSES),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string; suggestionId: string }> },
) {
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, uuidParams: ["suggestionId"], scope: "suggestions" });
  if (!access.ok) return access.response;
  const { guildId, suggestionId } = access.params;

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: false });
  }

  const rows = await db
    .update(suggestions)
    .set({ status: parsed.data.status })
    .where(and(eq(suggestions.id, suggestionId), eq(suggestions.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ guildId: string; suggestionId: string }> },
) {
  const access = await requireGuildAccess(request, params, { bodies: FEATURE_ROUTE_BODIES, uuidParams: ["suggestionId"], scope: "suggestions" });
  if (!access.ok) return access.response;
  const { guildId, suggestionId } = access.params;

  const rows = await db
    .update(suggestions)
    .set({ status: "archived" })
    .where(and(eq(suggestions.id, suggestionId), eq(suggestions.guildId, guildId)))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
