import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { users } from "@dragonbot/db/schema";
import { env } from "./env";
import { db } from "./db";

interface JwtPayload {
  discord_id: string;
  iat: number;
  exp: number;
}

const COOKIE_NAME = "dragonbot_session";
const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours
const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    const discordId = payload.discord_id as string | undefined;
    if (!discordId) return null;
    return {
      discord_id: discordId,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    // Covers expired, invalid signature, malformed, wrong algorithm
    return null;
  }
}

export async function signJwt(discordId: string): Promise<string> {
  return new SignJWT({ discord_id: discordId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
    .sign(secret);
}

/**
 * A cookie's raw value from the Cookie header. Kept exactly as before: no URL-decoding,
 * a value may contain "=", and a repeated name takes the last occurrence.
 */
function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    }),
  );
  return cookies[name];
}

/** The token from an `Authorization: Bearer <token>` header (legacy clients), or null. Case-sensitive prefix. */
function readBearer(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

/** Extract discord_id from the request — checks httpOnly cookie first, then Authorization header.
 *  Note: This does NOT check jwtInvalidBefore — call getAuthenticatedUser for protected routes.
 *  Unlike getJwtPayloadFromRequest, an invalid cookie falls through to the Bearer header (used by logout). */
export async function getDiscordIdFromRequest(request: Request): Promise<string | null> {
  // 1. Check httpOnly cookie
  const sessionToken = readCookie(request, COOKIE_NAME);
  if (sessionToken) {
    const payload = await verifyJwt(sessionToken);
    if (payload) return payload.discord_id;
  }

  // 2. Fallback to Authorization header (for backward compat)
  const bearer = readBearer(request);
  if (bearer !== null) {
    const payload = await verifyJwt(bearer);
    return payload?.discord_id ?? null;
  }

  return null;
}

/** Get the JWT payload (iat) from the request for revocation checking.
 *  A cookie, when present, is final: an invalid one does not fall through to the Bearer header. */
async function getJwtPayloadFromRequest(request: Request): Promise<JwtPayload | null> {
  const sessionToken = readCookie(request, COOKIE_NAME);
  if (sessionToken) return verifyJwt(sessionToken);

  const bearer = readBearer(request);
  if (bearer !== null) return verifyJwt(bearer);

  return null;
}

/**
 * Authenticate the request AND check JWT revocation.
 * Use this for all protected API routes.
 * Returns discord_id if valid, null if unauthorized or revoked.
 */
export async function getAuthenticatedUser(request: Request): Promise<string | null> {
  const payload = await getJwtPayloadFromRequest(request);
  if (!payload) return null;

  const rows = await db
    .select({ jwtInvalidBefore: users.jwtInvalidBefore })
    .from(users)
    .where(eq(users.discordId, payload.discord_id))
    .limit(1);

  const user = rows[0];
  // No user row → JWT is for a non-existent/deleted user
  if (!user) return null;

  if (user.jwtInvalidBefore) {
    const issuedAt = new Date(payload.iat * 1000);
    if (issuedAt < user.jwtInvalidBefore) return null;
  }

  return payload.discord_id;
}

/** Create Set-Cookie header value for the JWT */
export function createSessionCookie(jwt: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${jwt}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${JWT_EXPIRY_SECONDS}`,
  ];
  if (isProduction) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/** Create Set-Cookie header value to clear the session */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
