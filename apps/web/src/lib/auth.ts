import crypto from "node:crypto";
import { env } from "./env";

interface JwtPayload {
  discord_id: string;
  iat: number;
  exp: number;
}

export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  if (signature !== expectedSignature) return null;

  const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString()) as JwtPayload;

  if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

  return decoded;
}

export function signJwt(discordId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      discord_id: discordId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    }),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

export function getDiscordIdFromRequest(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const payload = verifyJwt(token);
  return payload?.discord_id ?? null;
}
