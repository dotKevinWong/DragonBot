import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guilds, FIELD_SCOPE_MAP } from "@dragonbot/db";
import { db } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission, getUserGuildPermissions } from "@/lib/discord";
import { guildSettingsUpdateSchema } from "@/lib/validators";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { guildId } = await params;

  // Any guild permission grants read access
  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden", code: "UNAUTHORIZED" }, { status: 403 });
  }

  const rows = await db.select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
  const guild = rows[0];

  if (!guild) {
    return NextResponse.json({ error: "Server not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const { id: _id, ...safeGuild } = guild;
  return NextResponse.json(safeGuild);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { guildId } = await params;

  // Get the user's permission scopes
  const userPermissions = await getUserGuildPermissions(guildId, discordId);
  if (userPermissions.length === 0) {
    return NextResponse.json({ error: "Forbidden", code: "UNAUTHORIZED" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = guildSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", code: "VALIDATION_ERROR", ...(process.env.NODE_ENV !== "production" && { details: parsed.error.issues }) },
      { status: 400 },
    );
  }

  // If user has wildcard, allow everything. Otherwise check each field.
  if (!userPermissions.includes("*")) {
    const fieldsBeingUpdated = Object.keys(parsed.data);
    const requiredScopes = new Set<string>();

    for (const field of fieldsBeingUpdated) {
      const scope = FIELD_SCOPE_MAP[field];
      if (scope) {
        requiredScopes.add(scope);
      }
    }

    const missingScopes = [...requiredScopes].filter(
      (scope) => !userPermissions.includes(scope),
    );

    if (missingScopes.length > 0) {
      return NextResponse.json(
        {
          error: `You don't have permission to modify these settings. Missing scopes: ${missingScopes.join(", ")}`,
          code: "UNAUTHORIZED",
        },
        { status: 403 },
      );
    }
  }

  const rows = await db
    .update(guilds)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(guilds.guildId, guildId))
    .returning();

  if (rows.length === 0) {
    return NextResponse.json({ error: "Server not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const { id: _id2, ...safeUpdated } = rows[0]!;
  return NextResponse.json(safeUpdated);
}
