import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import { SchedulerManager } from "../../src/lib/scheduler.js";
import type { ScheduledMessageService } from "../../src/services/scheduled-message.service.js";

/** Server g1's schedule s1 posts to channel c1, which Discord resolves to a text channel in `channelGuildId`. */
function setup(channelGuildId: string) {
  const schedule = {
    id: "s1",
    guildId: "g1",
    channelId: "c1",
    message: "Office hours start now",
    cronExpression: "0 9 * * *",
    timezone: "UTC",
    isEnabled: true,
    isEmbed: false,
    embedColor: null,
    embedTitle: null,
    updatedAt: new Date(),
  };
  const service = {
    getById: vi.fn(async (_id: string) => schedule),
    updateLastRun: vi.fn(async () => undefined),
  };
  const send = vi.fn(async (_content: unknown) => ({}));
  const fetch = vi.fn(async (_channelId: string) => ({
    id: "c1",
    guildId: channelGuildId,
    isDMBased: () => false,
    isTextBased: () => true,
    send,
  }));
  const client = { channels: { fetch } } as unknown as Client;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = { ...log, child: vi.fn(() => log) } as unknown as Logger;
  const scheduler = new SchedulerManager(client, service as unknown as ScheduledMessageService, logger);
  return { scheduler, send, fetch, log };
}

describe("SchedulerManager.testJob", () => {
  it("never sends a scheduled message to a channel in another server", async () => {
    const { scheduler, send, log } = setup("g2");

    await scheduler.testJob("s1", "g1");

    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", channelId: "c1", channelGuildId: "g2" }),
      expect.any(String),
    );
  });

  it("sends a scheduled message to a channel in the same server", async () => {
    const { scheduler, send, fetch, log } = setup("g1");

    await scheduler.testJob("s1", "g1");

    expect(fetch).toHaveBeenCalledWith("c1");
    expect(send).toHaveBeenCalledWith("Office hours start now");
    expect(log.error).not.toHaveBeenCalled();
  });
});
