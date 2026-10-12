import type { Client, TextChannel } from "discord.js";
import type { Logger } from "pino";
import type { YouTubeService } from "../services/youtube.service.js";
import type { YouTubeRepository } from "../repositories/youtube.repository.js";
import type { GuildService } from "../services/guild.service.js";

/** Max videos announced per subscription per check, so a long outage can't flood a channel. */
const MAX_ANNOUNCEMENTS_PER_CHECK = 5;
/** Videos older than this are synced but not announced (e.g. after the bot was offline for a while). */
const MAX_ANNOUNCE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * YouTube checker — called on startup and via the 4-hour sync timer.
 * No internal cron; scheduling is handled externally.
 */
export class YouTubeChecker {
  private running = false;

  constructor(
    private client: Client,
    private youtubeService: YouTubeService,
    private youtubeRepo: YouTubeRepository,
    private guildService: GuildService,
    private logger: Logger,
  ) {}

  /**
   * Run the YouTube check for all enabled subscriptions, announcing every video
   * uploaded since the last one we saw (oldest first).
   */
  async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runCheck();
    } finally {
      this.running = false;
    }
  }

  private async runCheck(): Promise<void> {
    const log = this.logger.child({ component: "youtube-checker" });

    let subscriptions;
    try {
      subscriptions = await this.youtubeRepo.getEnabledSubscriptions();
    } catch (err) {
      log.error({ err }, "Failed to load YouTube subscriptions");
      return;
    }

    if (subscriptions.length === 0) return;

    log.debug({ count: subscriptions.length }, "Checking YouTube subscriptions");

    for (const sub of subscriptions) {
      try {
        const videos = await this.youtubeService.fetchRecentVideos(sub.youtubeChannelId);
        const latest = videos[0];
        if (!latest) {
          log.warn(
            { guildId: sub.guildId, youtubeChannelId: sub.youtubeChannelId },
            "YouTube feed returned no videos",
          );
          continue;
        }

        if (latest.id === sub.lastVideoId) continue;

        // Record the newest video first so a failed announcement can't cause repeat posts
        await this.youtubeRepo.updateLastVideoId(sub.id, latest.id);

        // No previous video ID means this is the first check — establish a baseline, don't announce
        if (!sub.lastVideoId) {
          log.info(
            { guildId: sub.guildId, youtubeChannelId: sub.youtubeChannelId, videoId: latest.id },
            "First check for subscription, recorded latest video without announcing",
          );
          continue;
        }

        const lastSeenIndex = videos.findIndex((v) => v.id === sub.lastVideoId);
        if (lastSeenIndex === -1) {
          // The last seen video is no longer in the feed (deleted/privated, or scrolled out).
          // We can't tell which entries are new, so re-baseline rather than risk re-announcing old videos.
          log.warn(
            { guildId: sub.guildId, youtubeChannelId: sub.youtubeChannelId, lastVideoId: sub.lastVideoId },
            "Last seen video not found in YouTube feed, re-baselined without announcing",
          );
          continue;
        }

        const now = Date.now();
        const newVideos = videos
          .slice(0, lastSeenIndex)
          .filter((v) => {
            const published = Date.parse(v.publishedAt);
            return Number.isNaN(published) || now - published <= MAX_ANNOUNCE_AGE_MS;
          })
          .slice(0, MAX_ANNOUNCEMENTS_PER_CHECK)
          .reverse();

        for (const video of newVideos) {
          await this.announce(sub.guildId, sub.notifyChannelId, video, sub.customMessage, log);
        }
      } catch (err) {
        log.error(
          { err, guildId: sub.guildId, youtubeChannelId: sub.youtubeChannelId },
          "YouTube check failed for subscription, continuing to next",
        );
      }
    }
  }

  private async announce(
    guildId: string,
    channelId: string,
    video: Parameters<YouTubeService["buildNotificationMessage"]>[0],
    customMessage: string | null,
    log: Logger,
  ): Promise<void> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      log.warn({ guildId, channelId }, "YouTube notify channel not found or not text-based");
      return;
    }

    const message = this.youtubeService.buildNotificationMessage(video, customMessage);

    // Send as plain text so Discord auto-embeds the YouTube link preview
    await (channel as TextChannel).send(message);

    log.info(
      { guildId, videoId: video.id, title: video.title },
      "YouTube notification sent",
    );
  }
}
