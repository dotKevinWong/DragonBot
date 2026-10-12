import { describe, it, expect, vi } from "vitest";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import { YouTubeChecker } from "../../src/lib/youtube-checker.js";
import { YouTubeService, type YouTubeVideo } from "../../src/services/youtube.service.js";
import type { YouTubeRepository, YouTubeSubscriptionRow } from "../../src/repositories/youtube.repository.js";
import type { GuildService } from "../../src/services/guild.service.js";

function video(id: string, hoursAgo: number): YouTubeVideo {
  return {
    id,
    title: `Video ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    author: "Drexel University",
    publishedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    thumbnailUrl: "",
  };
}

function setup(lastVideoId: string | null, videos: YouTubeVideo[]) {
  const sub: YouTubeSubscriptionRow = {
    id: "sub-1",
    guildId: "guild-1",
    youtubeChannelId: "UCWmrDUqDzI0PjXr2xYWpjYQ",
    youtubeChannelName: "Drexel University",
    notifyChannelId: "chan-1",
    customMessage: null,
    lastVideoId,
    isEnabled: true,
  };
  const repo = {
    getEnabledSubscriptions: vi.fn().mockResolvedValue([sub]),
    updateLastVideoId: vi.fn().mockResolvedValue(undefined),
  };
  const service = new YouTubeService();
  vi.spyOn(service, "fetchRecentVideos").mockResolvedValue(videos);
  const send = vi.fn().mockResolvedValue(undefined);
  const client = {
    channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) },
  } as unknown as Client;
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const logger = { child: () => child } as unknown as Logger;
  const checker = new YouTubeChecker(
    client,
    service,
    repo as unknown as YouTubeRepository,
    {} as GuildService,
    logger,
  );
  return { checker, repo, send };
}

describe("YouTubeChecker", () => {
  it("announces every video uploaded since the last seen one, oldest first", async () => {
    const { checker, repo, send } = setup("old", [video("c", 1), video("b", 2), video("old", 30)]);
    await checker.check();
    expect(repo.updateLastVideoId).toHaveBeenCalledWith("sub-1", "c");
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      expect.stringContaining("watch?v=b"),
      expect.stringContaining("watch?v=c"),
    ]);
  });

  it("announces new videos on the startup check too", async () => {
    const { checker, send } = setup("old", [video("new", 1), video("old", 30)]);
    await checker.check();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records a baseline without announcing on the first check", async () => {
    const { checker, repo, send } = setup(null, [video("a", 1)]);
    await checker.check();
    expect(repo.updateLastVideoId).toHaveBeenCalledWith("sub-1", "a");
    expect(send).not.toHaveBeenCalled();
  });

  it("re-baselines without announcing when the last seen video left the feed", async () => {
    const { checker, repo, send } = setup("deleted", [video("b", 1), video("a", 2)]);
    await checker.check();
    expect(repo.updateLastVideoId).toHaveBeenCalledWith("sub-1", "b");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not announce stale videos after a long outage", async () => {
    const { checker, send } = setup("old", [video("fresh", 1), video("stale", 24 * 10), video("old", 24 * 11)]);
    await checker.check();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("watch?v=fresh");
  });

  it("does nothing when the latest video is already seen", async () => {
    const { checker, repo, send } = setup("a", [video("a", 1)]);
    await checker.check();
    expect(repo.updateLastVideoId).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
