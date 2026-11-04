import { NextResponse } from "next/server";
import type { ZodIssue } from "zod";
import { UUID_RE } from "@dragonbot/db/contracts";
import { getAuthenticatedUser } from "./auth";
import { checkGuildPermission } from "./discord";
import { DISCORD_SNOWFLAKE_RE } from "./validators";

/**
 * The JSON bodies a guild route answers with when the guard refuses a request.
 * Routes differ here on purpose (clients may match on them), so each route
 * passes its own set rather than sharing one normalised shape.
 */
export interface GuardBodies {
  readonly unauthorized: Readonly<Record<string, string>>;
  readonly notFound: Readonly<Record<string, string>>;
  readonly forbidden: Readonly<Record<string, string>>;
}

/** Freezes a body set and its three bodies, so no caller can change a route's answers. */
function frozenBodies(bodies: GuardBodies): GuardBodies {
  Object.freeze(bodies.unauthorized);
  Object.freeze(bodies.notFound);
  Object.freeze(bodies.forbidden);
  return Object.freeze(bodies);
}

/** Schedules, YouTube and suggestions routes: no `code` on 401 and 403, but the 404 has one. */
export const FEATURE_ROUTE_BODIES: GuardBodies = frozenBodies({
  unauthorized: { error: "Unauthorized" },
  notFound: { error: "Not found", code: "NOT_FOUND" },
  forbidden: { error: "Forbidden" },
});

/** /api/server/[guildId]: "Server not found", and a 403 whose code is UNAUTHORIZED. */
export const SETTINGS_ROUTE_BODIES: GuardBodies = frozenBodies({
  unauthorized: { error: "Unauthorized", code: "UNAUTHORIZED" },
  notFound: { error: "Server not found", code: "NOT_FOUND" },
  forbidden: { error: "Forbidden", code: "UNAUTHORIZED" },
});

/** /api/server/[guildId]/discord: as the settings route, but the 404 says "Not found". */
export const DISCORD_ROUTE_BODIES: GuardBodies = frozenBodies({
  unauthorized: { error: "Unauthorized", code: "UNAUTHORIZED" },
  notFound: { error: "Not found", code: "NOT_FOUND" },
  forbidden: { error: "Forbidden", code: "UNAUTHORIZED" },
});

export type GuardResult<P> =
  | { ok: true; discordId: string; params: P }
  | { ok: false; response: NextResponse };

/**
 * The first two steps of every guild route, in this order:
 * 1. the session (401 when absent, invalid or revoked), before the params are read;
 * 2. the guildId must be a snowflake and each named param a UUID (one 404 for any).
 * Routes with their own permission step (settings PATCH, /discord) use this alone.
 */
export async function authenticateGuildRequest<P extends { guildId: string }>(
  request: Request,
  params: Promise<P>,
  bodies: GuardBodies,
  uuidParams: readonly (keyof P)[] = [],
): Promise<GuardResult<P>> {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return { ok: false, response: NextResponse.json(bodies.unauthorized, { status: 401 }) };
  }

  const resolved = await params;

  if (
    !DISCORD_SNOWFLAKE_RE.test(resolved.guildId) ||
    uuidParams.some((key) => !UUID_RE.test(resolved[key] as string))
  ) {
    return { ok: false, response: NextResponse.json(bodies.notFound, { status: 404 }) };
  }

  return { ok: true, discordId, params: resolved };
}

/**
 * The whole guard for a guild route: authenticateGuildRequest, then
 * checkGuildPermission (403). With no scope any grant is enough (read access);
 * with a scope the user needs that scope or "*".
 */
export async function requireGuildAccess<P extends { guildId: string }>(
  request: Request,
  params: Promise<P>,
  options: { bodies: GuardBodies; uuidParams?: readonly (keyof P)[]; scope?: string },
): Promise<GuardResult<P>> {
  const auth = await authenticateGuildRequest(request, params, options.bodies, options.uuidParams);
  if (!auth.ok) return auth;

  const { guildId } = auth.params;
  const hasPermission =
    options.scope === undefined
      ? await checkGuildPermission(guildId, auth.discordId)
      : await checkGuildPermission(guildId, auth.discordId, options.scope);
  if (!hasPermission) {
    return { ok: false, response: NextResponse.json(options.bodies.forbidden, { status: 403 }) };
  }

  return auth;
}

/**
 * The 400 for a request body that fails its zod schema. Keys stay in the order
 * error, code, details. `code` only where the route sent it before (settings
 * PATCH and profile PATCH); `details` only outside production, read per call.
 */
export function invalidDataResponse(issues: ZodIssue[], options: { withCode: boolean }): NextResponse {
  return NextResponse.json(
    {
      error: "Invalid data",
      ...(options.withCode && { code: "VALIDATION_ERROR" }),
      ...(process.env.NODE_ENV !== "production" && { details: issues }),
    },
    { status: 400 },
  );
}
