import { describe, it, expect, vi } from "vitest";
import { GuildAdminService } from "../../src/services/guild-admin.service.js";
import type { GuildAdminRepository } from "../../src/repositories/guild-admin.repository.js";

// Characterization tests: these pin GuildAdminService's permission answers and
// cache behaviour so the D3 refactor (shared scope helpers) cannot change them.

function setup(row: { permissions: string[]; addedBy?: string } | null) {
  const repo = {
    findByGuildAndUser: vi.fn().mockResolvedValue(row ? { addedBy: "u0", ...row } : null),
    findAllByGuild: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(true),
  };
  const service = new GuildAdminService(repo as unknown as GuildAdminRepository);
  return { service, repo };
}

describe("GuildAdminService.hasPermission", () => {
  const cases: [string, { permissions: string[] } | null, string, boolean][] = [
    ["no row", null, "logging", false],
    ["empty grants", { permissions: [] }, "logging", false],
    ["wildcard grant", { permissions: ["*"] }, "logging", true],
    ["exact scope", { permissions: ["logging"] }, "logging", true],
    ["other scope", { permissions: ["moderation"] }, "logging", false],
    ["several scopes incl. target", { permissions: ["xp", "logging"] }, "logging", true],
    ["scope * with a non-wildcard grant", { permissions: ["moderation"] }, "*", false],
    ["scope * with a wildcard grant", { permissions: ["*"] }, "*", true],
    ["case differs", { permissions: ["Logging"] }, "logging", false],
  ];
  for (const [name, row, scope, expected] of cases) {
    it(`${name} -> ${expected}`, async () => {
      const { service } = setup(row);
      expect(await service.hasPermission("g1", "u1", scope as never)).toBe(expected);
    });
  }
});

describe("GuildAdminService.hasAnyPermission", () => {
  const cases: [string, { permissions: string[] } | null, boolean][] = [
    ["no row", null, false],
    ["empty grants", { permissions: [] }, false],
    ["one scope", { permissions: ["xp"] }, true],
    ["wildcard", { permissions: ["*"] }, true],
  ];
  for (const [name, row, expected] of cases) {
    it(`${name} -> ${expected}`, async () => {
      const { service } = setup(row);
      expect(await service.hasAnyPermission("g1", "u1")).toBe(expected);
    });
  }
});

describe("GuildAdminService.getPermissions", () => {
  it("returns [] for a missing row", async () => {
    const { service } = setup(null);
    expect(await service.getPermissions("g1", "u1")).toEqual([]);
  });

  it("returns the stored grants as they are", async () => {
    const { service } = setup({ permissions: ["xp", "*"] });
    expect(await service.getPermissions("g1", "u1")).toEqual(["xp", "*"]);
  });
});

describe("GuildAdminService cache", () => {
  it("reads the repository once for repeated checks, including the non-admin (null) case", async () => {
    const { service, repo } = setup(null);
    await service.hasPermission("g1", "u1", "xp");
    await service.hasAnyPermission("g1", "u1");
    await service.getPermissions("g1", "u1");
    expect(repo.findByGuildAndUser).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by guild and user", async () => {
    const { service, repo } = setup({ permissions: ["xp"] });
    await service.hasPermission("g1", "u1", "xp");
    await service.hasPermission("g2", "u1", "xp");
    await service.hasPermission("g1", "u2", "xp");
    expect(repo.findByGuildAndUser).toHaveBeenCalledTimes(3);
  });

  it("addAdmin invalidates the cached entry", async () => {
    const { service, repo } = setup(null);
    expect(await service.hasPermission("g1", "u1", "xp")).toBe(false);
    repo.findByGuildAndUser.mockResolvedValue({ permissions: ["xp"], addedBy: "u0" });
    await service.addAdmin("g1", "u1", ["xp"], "u0");
    expect(await service.hasPermission("g1", "u1", "xp")).toBe(true);
    expect(repo.findByGuildAndUser).toHaveBeenCalledTimes(2);
  });

  it("removeAdmin invalidates the cached entry", async () => {
    const { service, repo } = setup({ permissions: ["xp"] });
    expect(await service.hasPermission("g1", "u1", "xp")).toBe(true);
    repo.findByGuildAndUser.mockResolvedValue(null);
    await service.removeAdmin("g1", "u1");
    expect(await service.hasPermission("g1", "u1", "xp")).toBe(false);
    expect(repo.findByGuildAndUser).toHaveBeenCalledTimes(2);
  });
});
