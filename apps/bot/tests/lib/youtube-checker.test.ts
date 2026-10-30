import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import { YouTubeChecker } from "../../src/lib/youtube-checker.js";
import type { YouTubeService, YouTubeVideo } from "../../src/services/youtube.service.js";
import type { YouTubeRepository } from "../../src/repositories/youtube.repository.js";
import type { GuildService } from "../../src/services/guild.service.js";

const video: YouTubeVideo = {
  id: "v1",
  title: "Week 1 recap",
  url: "https://www.youtube.com/watch?v=v1",
  author: "Drexel CCI",
  publishedAt: "2026-10-30T12:00:00Z",
  thumbnailUrl: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
};

/** Server g1's notify channel c1 resolves to a text channel in `channelGuildId`. */
function setup(channelGuildId: string) {
  const send = vi.fn(async (_content: unknown) => ({}));
  const fetch = vi.fn(async (_channelId: string) => ({
    id: "c1",
    guildId: channelGuildId,
    isDMBased: () => false,
    isTextBased: () => true,
    send,
  }));
  const client = { channels: { fetch } } as unknown as Client;
  const youtubeService = { buildNotificationMessage: vi.fn(() => "New video: Week 1 recap") };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const logger = { ...log, child: vi.fn(() => log) } as unknown as Logger;
  const checker = new YouTubeChecker(
    client,
    youtubeService as unknown as YouTubeService,
    {} as YouTubeRepository,
    {} as GuildService,
    logger,
  );
  return { checker, send, log, logger };
}

describe("YouTubeChecker.announce", () => {
  it("never announces in a notify channel in another server", async () => {
    const { checker, send, log, logger } = setup("g2");

    await checker["announce"]("g1", "c1", video, null, logger);

    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", channelId: "c1", channelGuildId: "g2" }),
      expect.any(String),
    );
  });

  it("announces in a notify channel in the same server", async () => {
    const { checker, send, logger } = setup("g1");

    await checker["announce"]("g1", "c1", video, null, logger);

    expect(send).toHaveBeenCalledWith("New video: Week 1 recap");
  });
});
