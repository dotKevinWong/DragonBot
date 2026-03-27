import crypto from "node:crypto";
import type { AuthRepository } from "../repositories/auth.repository.js";
import { AppError, ErrorCode } from "../types/errors.js";

export class AuthService {
  constructor(
    private repo: AuthRepository,
    private jwtSecret: string,
  ) {}

  async generateToken(discordId: string, interactionId?: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex"); // 64 chars
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.repo.create({
      discordId,
      token,
      commandInteractionId: interactionId,
      expiresAt,
    });

    return token;
  }

  async exchangeToken(token: string): Promise<{ discordId: string }> {
    const record = await this.repo.findByToken(token);

    if (!record) {
      throw new AppError(ErrorCode.TOKEN_NOT_FOUND, "Invalid token.");
    }

    if (record.used) {
      throw new AppError(ErrorCode.TOKEN_USED, "Token has already been used.");
    }

    if (new Date() > record.expiresAt) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED, "Token has expired.");
    }

    await this.repo.markUsed(record.id);

    return { discordId: record.discordId };
  }

  signJwt(discordId: string): string {
    // Simple HMAC-based JWT (header.payload.signature)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        discord_id: discordId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      }),
    ).toString("base64url");

    const signature = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${payload}`)
      .digest("base64url");

    return `${header}.${payload}.${signature}`;
  }

  verifyJwt(token: string): { discord_id: string; iat: number; exp: number } | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;

    const expectedSignature = crypto
      .createHmac("sha256", this.jwtSecret)
      .update(`${header}.${payload}`)
      .digest("base64url");

    if (signature !== expectedSignature) return null;

    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString()) as {
      discord_id: string;
      iat: number;
      exp: number;
    };

    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return decoded;
  }
}
