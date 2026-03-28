import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

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

/** Extract discord_id from the request — checks httpOnly cookie first, then Authorization header.
 *  Note: This does NOT check jwtInvalidBefore — call getAuthenticatedUser for protected routes. */
export async function getDiscordIdFromRequest(request: Request): Promise<string | null> {
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
      const payload = await verifyJwt(sessionToken);
      if (payload) return payload.discord_id;
    }
  }

  // 2. Fallback to Authorization header (for backward compat)
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyJwt(token);
    return payload?.discord_id ?? null;
  }

  return null;
}

/** Get the JWT payload (iat) from the request for revocation checking */
async function getJwtPayloadFromRequest(request: Request): Promise<JwtPayload | null> {
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
  const payload = await getJwtPayloadFromRequest(request);
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
