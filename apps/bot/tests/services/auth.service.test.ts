import { describe, it, expect, vi, afterEach } from "vitest";
import { AuthService } from "../../src/services/auth.service.js";
import type { AuthRepository } from "../../src/repositories/auth.repository.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("AuthService.generateToken", () => {
  it("creates a 64-hex one-time token that expires in 5 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const repo = { create: vi.fn().mockResolvedValue(undefined) };
    const service = new AuthService(repo as unknown as AuthRepository);

    const token = await service.generateToken("123", "interaction-1");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.create).toHaveBeenCalledWith({
      discordId: "123",
      token,
      commandInteractionId: "interaction-1",
      expiresAt: new Date("2026-11-03T12:05:00Z"),
    });

    const second = await service.generateToken("123");
    expect(second).not.toBe(token);
    expect(repo.create).toHaveBeenLastCalledWith(expect.objectContaining({ commandInteractionId: undefined }));
  });

  it("has no JWT or token-exchange methods; the web app owns those", () => {
    const service = new AuthService({} as AuthRepository);
    expect("exchangeToken" in service).toBe(false);
    expect("signJwt" in service).toBe(false);
    expect("verifyJwt" in service).toBe(false);
  });
});
