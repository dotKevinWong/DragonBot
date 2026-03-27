import crypto from "node:crypto";
import { env } from "./env";

interface JwtPayload {
  discord_id: string;
  iat: number;
  exp: number;
}

const COOKIE_NAME = "dragonbot_session";
const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature!, "base64url"), Buffer.from(expectedSignature, "base64url"))) return null;
  } catch {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString()) as JwtPayload;
    if (!decoded.discord_id || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function signJwt(discordId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      discord_id: discordId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
    }),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

/** Extract discord_id from the request — checks httpOnly cookie first, then Authorization header.
 *  Note: This does NOT check jwtInvalidBefore — call checkJwtRevocation separately for protected routes. */
export function getDiscordIdFromRequest(request: Request): string | null {
  // 1. Check httpOnly cookie
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [key, ...val] = c.trim().split("=");
        return [key, val.join("=")];
      }),
    );
    const sessionToken = cookies[COOKIE_NAME];
    if (sessionToken) {
      const payload = verifyJwt(sessionToken);
      if (payload) return payload.discord_id;
    }
  }

  // 2. Fallback to Authorization header (for backward compat)
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    return payload?.discord_id ?? null;
  }

  return null;
}

/** Get the JWT payload (iat) from the request for revocation checking */
export function getJwtPayloadFromRequest(request: Request): JwtPayload | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [key, ...val] = c.trim().split("=");
        return [key, val.join("=")];
      }),
    );
    const sessionToken = cookies[COOKIE_NAME];
    if (sessionToken) return verifyJwt(sessionToken);
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyJwt(authHeader.slice(7));
  }

  return null;
}

/**
 * Authenticate the request AND check JWT revocation.
 * Use this for all protected API routes.
 * Returns discord_id if valid, null if unauthorized or revoked.
 */
export async function getAuthenticatedUser(request: Request): Promise<string | null> {
  const payload = getJwtPayloadFromRequest(request);
  if (!payload) return null;

  // Lazy import to avoid circular deps
  const { db: database } = await import("./db");
  const { users } = await import("@dragonbot/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await database
    .select({ jwtInvalidBefore: users.jwtInvalidBefore })
    .from(users)
    .where(eq(users.discordId, payload.discord_id))
    .limit(1);

  const user = rows[0];
  if (user?.jwtInvalidBefore) {
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
