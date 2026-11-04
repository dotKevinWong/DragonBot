import { describe, expect, it, vi } from "vitest";
import type { Guild } from "discord.js";
import { addVerificationRole } from "../../src/utils/verification-role.js";

describe("addVerificationRole", () => {
  it("fetches the member, adds the role, and lets failures through", async () => {
    const add = vi.fn(async () => {
      throw new Error("Missing Permissions");
    });
    const fetch = vi.fn(async () => ({ roles: { add } }));
    const guild = { members: { fetch } } as unknown as Guild;

    await expect(addVerificationRole(guild, "u1", "r1")).rejects.toThrow("Missing Permissions");
    expect(fetch).toHaveBeenCalledWith("u1");
    expect(add).toHaveBeenCalledWith("r1");
  });
});
