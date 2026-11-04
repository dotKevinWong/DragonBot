import crypto from "node:crypto";
import type { AuthRepository } from "../repositories/auth.repository.js";

export class AuthService {
  constructor(private repo: AuthRepository) {}

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
}
