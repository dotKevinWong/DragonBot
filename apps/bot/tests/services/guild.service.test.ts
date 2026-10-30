import { describe, it, expect, vi } from "vitest";
import { GuildService } from "../../src/services/guild.service.js";
import type { GuildRepository } from "../../src/repositories/guild.repository.js";

const rowA = { guildId: "g1", guildName: "Before", honeypotWarningChannelId: null, honeypotWarningMessageId: null };
const rowB = { guildId: "g1", guildName: "After", honeypotWarningChannelId: "c1", honeypotWarningMessageId: "m1" };

function setup() {
  const repo = {
    findByGuildId: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(null),
  };
  const service = new GuildService(repo as unknown as GuildRepository);
  return { service, repo };
}

describe("GuildService", () => {
  it("getSettingsFresh reads the database even when the guild is cached", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValueOnce(rowA).mockResolvedValueOnce(rowB);
    expect(await service.getSettings("g1")).toEqual(rowA);

    expect(await service.getSettingsFresh("g1")).toEqual(rowB);
    expect(await service.getSettings("g1")).toEqual(rowB); // cache refreshed
    expect(repo.findByGuildId).toHaveBeenCalledTimes(2);
  });

  it("getSettingsFresh drops the cached row when the guild is gone", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValueOnce(rowA).mockResolvedValue(null);
    await service.getSettings("g1");

    expect(await service.getSettingsFresh("g1")).toBeNull();
    expect(await service.getSettings("g1")).toBeNull();
    expect(repo.findByGuildId).toHaveBeenCalledTimes(3);
  });

  it("setHoneypotWarning writes both columns and drops the cached row", async () => {
    const { service, repo } = setup();
    repo.findByGuildId.mockResolvedValueOnce(rowA).mockResolvedValueOnce(rowB);
    await service.getSettings("g1");

    await service.setHoneypotWarning("g1", { channelId: "c1", messageId: "m1" });
    expect(repo.updateSettings).toHaveBeenCalledWith("g1", { honeypotWarningChannelId: "c1", honeypotWarningMessageId: "m1" });
    expect(await service.getSettings("g1")).toEqual(rowB); // the stale cached row is gone

    await service.setHoneypotWarning("g1", null);
    expect(repo.updateSettings).toHaveBeenLastCalledWith("g1", { honeypotWarningChannelId: null, honeypotWarningMessageId: null });
  });
});
