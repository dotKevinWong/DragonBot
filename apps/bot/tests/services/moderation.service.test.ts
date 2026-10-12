import { describe, it, expect, vi } from "vitest";
import { DiscordAPIError, RESTJSONErrorCodes, type Client } from "discord.js";
import type { Logger } from "pino";
import { ModerationService } from "../../src/services/moderation.service.js";
import type { GuildService } from "../../src/services/guild.service.js";

function apiError(code: number, message: string) {
  return new DiscordAPIError({ code, message }, code, 404, "GET", "/guilds/x", {});
}

function setup(fetchResults: Record<string, unknown>) {
  const guildService = {
    getAllBanSyncGuilds: vi.fn().mockResolvedValue(
      Object.keys(fetchResults).map((guildId) => ({ guildId })),
    ),
    disableBanSync: vi.fn().mockResolvedValue(null),
  };
  const ban = vi.fn().mockResolvedValue(undefined);
  const client = {
    guilds: {
      fetch: vi.fn(async (id: string) => {
        const result = fetchResults[id];
        if (result instanceof Error) throw result;
        return { members: { ban } };
      }),
    },
  } as unknown as Client;
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;
  const service = new ModerationService(guildService as unknown as GuildService);
  return { service, guildService, client, logger, ban };
}

describe("ModerationService.syncBan", () => {
  it("disables ban sync for a guild the bot is no longer in and keeps syncing the rest", async () => {
    const { service, guildService, client, logger, ban } = setup({
      gone: apiError(RESTJSONErrorCodes.UnknownGuild, "Unknown Guild"),
      ok: null,
    });

    const count = await service.syncBan("user-1", "source", client, logger);

    expect(count).toBe(1);
    expect(ban).toHaveBeenCalledTimes(1);
    expect(guildService.disableBanSync).toHaveBeenCalledWith("gone");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("only warns on other errors without disabling ban sync", async () => {
    const { service, guildService, client, logger } = setup({
      forbidden: apiError(RESTJSONErrorCodes.MissingPermissions, "Missing Permissions"),
    });

    const count = await service.syncBan("user-1", "source", client, logger);

    expect(count).toBe(0);
    expect(guildService.disableBanSync).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("skips the source guild", async () => {
    const { service, client, logger, ban } = setup({ source: null });

    const count = await service.syncBan("user-1", "source", client, logger);

    expect(count).toBe(0);
    expect(ban).not.toHaveBeenCalled();
  });
});
