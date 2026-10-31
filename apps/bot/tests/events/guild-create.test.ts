import { describe, expect, it, vi } from "vitest";
import type { Guild } from "discord.js";
import event from "../../src/events/guild-create.js";
import type { BotContext } from "../../src/types/context.js";

describe("guildCreate event", () => {
  it("syncs the honeypot warning once the server is recorded", async () => {
    // The warning may have been deleted while DragonBot was away, leaving its IDs stored.
    let recorded!: () => void;
    const guildService = {
      ensureGuild: vi.fn(
        (_guildId: string, _guildName: string) =>
          new Promise<void>((resolve) => {
            recorded = resolve;
          }),
      ),
    };
    const honeypotWarning = { sync: vi.fn((_guildId: string) => Promise.resolve()) };
    const logger = { info: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);
    const ctx = { logger, services: { guild: guildService }, honeypotWarning } as unknown as BotContext;

    const joined = event.execute({ id: "g1", name: "Test Server" } as unknown as Guild, ctx);
    await vi.waitFor(() => expect(guildService.ensureGuild).toHaveBeenCalledWith("g1", "Test Server"));
    expect(honeypotWarning.sync).not.toHaveBeenCalled();
    recorded();
    await joined;

    // The guild's ID alone: joining a server doesn't reset its repost budget.
    expect(honeypotWarning.sync.mock.calls).toEqual([["g1"]]);
  });
});
