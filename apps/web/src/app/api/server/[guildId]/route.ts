import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { guilds } from "@dragonbot/db/schema";
import { grantsScope, missingScopes, requiredScopesForFields } from "@dragonbot/db/permissions";
import { HONEYPOT_CONFLICT_FIELDS, findHoneypotChannelConflict } from "@dragonbot/db/honeypot";
import { db } from "@/lib/db";
import { getUserGuildPermissions } from "@/lib/discord";
import { guildSettingsUpdateSchema } from "@/lib/validators";
import { notifyBotReload } from "@/lib/bot-webhook";
import {
  authenticateGuildRequest,
  invalidDataResponse,
  SETTINGS_ROUTE_BODIES,
} from "@/lib/route-guard";
import { toSafeGuild } from "@/lib/safe-rows";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const auth = await authenticateGuildRequest(request, params, SETTINGS_ROUTE_BODIES);
  if (!auth.ok) return auth.response;
  const { discordId, params: { guildId } } = auth;

  // Any guild permission grants read access. This is the lookup checkGuildPermission makes, done
  // here so the grants can go back to the page: viewerScopes is ["*"] for full access, otherwise the
  // caller's guild_admins scopes, and the dashboard hides write controls a scope is missing for.
  const viewerScopes = await getUserGuildPermissions(guildId, discordId);
  if (!grantsScope(viewerScopes)) {
    return NextResponse.json(SETTINGS_ROUTE_BODIES.forbidden, { status: 403 });
  }

  const rows = await db.select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
  const guild = rows[0];

  if (!guild) {
    return NextResponse.json({ error: "Server not found", code: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ...toSafeGuild(guild), viewerScopes });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const auth = await authenticateGuildRequest(request, params, SETTINGS_ROUTE_BODIES);
  if (!auth.ok) return auth.response;
  const { discordId, params: { guildId } } = auth;

  // Get the user's permission scopes
  const userPermissions = await getUserGuildPermissions(guildId, discordId);
  if (userPermissions.length === 0) {
    return NextResponse.json(SETTINGS_ROUTE_BODIES.forbidden, { status: 403 });
  }

  const body = await request.json();
  const parsed = guildSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return invalidDataResponse(parsed.error.issues, { withCode: true });
  }

  // Each field needs its scope; a "*" grant needs none
  const missing = missingScopes(requiredScopesForFields(Object.keys(parsed.data)), userPermissions);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `You don't have permission to modify these settings. Missing scopes: ${missing.map((scope) => (scope === "*" ? "full access" : scope)).join(", ")}`,
        code: "UNAUTHORIZED",
      },
      { status: 403 },
    );
  }

  const checksXp = parsed.data.xpMin !== undefined || parsed.data.xpMax !== undefined;
  const honeypotChannelFields = ["honeypotChannelId", ...Object.keys(HONEYPOT_CONFLICT_FIELDS)];
  const checksHoneypot = honeypotChannelFields.some((field) => field in parsed.data);

  // When both checks run, one read of the stored row serves both; alone, each reads as before
  const storedRow = checksXp && checksHoneypot
    ? await db.select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1)
    : undefined;

  // Cross-validate xpMin/xpMax against existing DB values when only one is provided
  if (checksXp) {
    const existing = storedRow ?? await db.select({ xpMin: guilds.xpMin, xpMax: guilds.xpMax }).from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
    if (existing[0]) {
      const effectiveMin = parsed.data.xpMin ?? existing[0].xpMin;
      const effectiveMax = parsed.data.xpMax ?? existing[0].xpMax;
      if (effectiveMin > effectiveMax) {
        return NextResponse.json(
          { error: "xpMin cannot be greater than xpMax", code: "VALIDATION_ERROR" },
          { status: 400 },
        );
      }
    }
  }

  // Reject a honeypot channel shared with another channel setting, comparing the values after this
  // update: the body's value where it sends one (null clears it), the stored value otherwise
  if (checksHoneypot) {
    const existing = storedRow ?? await db.select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
    if (existing[0]) {
      const conflict = findHoneypotChannelConflict({ ...existing[0], ...parsed.data });
      if (conflict) {
        return NextResponse.json(
          { error: `The honeypot channel can't be the same as the ${conflict} channel.`, code: "VALIDATION_ERROR" },
          { status: 400 },
        );
      }
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

  // Notify bot to reload this guild's cached settings instantly
  notifyBotReload(guildId);

  return NextResponse.json(toSafeGuild(rows[0]!));
}
