import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import { fetchGuildTextChannel } from "../../src/utils/guild-channel.js";

/** A text channel in server `guildId`, as `client.channels.fetch` returns it. */
function textChannel(guildId: string) {
  return { id: "c1", guildId, isDMBased: () => false, isTextBased: () => true, send: vi.fn() };
}

function setup(fetched: unknown) {
  const fetch = vi.fn(async (_channelId: string) => {
    if (fetched instanceof Error) throw fetched;
    return fetched;
  });
  const client = { channels: { fetch } } as unknown as Client;
  const logger = { warn: vi.fn() } as unknown as Logger;
  return { client, fetch, logger, warn: logger.warn as ReturnType<typeof vi.fn> };
}

describe("fetchGuildTextChannel", () => {
  it("returns a text channel in the same server", async () => {
    const channel = textChannel("g1");
    const { client, fetch, logger, warn } = setup(channel);

    await expect(fetchGuildTextChannel(client, "g1", "c1", logger)).resolves.toBe(channel);

    expect(fetch).toHaveBeenCalledWith("c1");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null and warns once for a text channel in another server", async () => {
    const { client, logger, warn } = setup(textChannel("g2"));

    await expect(fetchGuildTextChannel(client, "g1", "c1", logger)).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({ guildId: "g1", channelId: "c1", channelGuildId: "g2" });
  });

  it("returns null for a DM channel, a non-text channel and a channel that isn't there", async () => {
    const dm = { id: "c1", isDMBased: () => true, isTextBased: () => true, send: vi.fn() };
    const forum = { id: "c1", guildId: "g1", isDMBased: () => false, isTextBased: () => false };

    for (const fetched of [dm, forum, null]) {
      const { client, logger, warn } = setup(fetched);

      await expect(fetchGuildTextChannel(client, "g1", "c1", logger)).resolves.toBeNull();

      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("rejects when the fetch rejects, so each caller keeps its own error handling", async () => {
    const error = new Error("Missing Access");
    const { client, logger } = setup(error);

    await expect(fetchGuildTextChannel(client, "g1", "c1", logger)).rejects.toBe(error);
  });
});
