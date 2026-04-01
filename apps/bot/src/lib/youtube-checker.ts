import type { Client, TextChannel } from "discord.js";
import type { Logger } from "pino";
import type { YouTubeService } from "../services/youtube.service.js";
import type { YouTubeRepository } from "../repositories/youtube.repository.js";
import type { GuildService } from "../services/guild.service.js";

/**
 * YouTube checker — called on startup (catch-up) and via the 4-hour sync timer.
 * No internal cron; scheduling is handled externally.
 */
export class YouTubeChecker {
  constructor(
    private client: Client,
    private youtubeService: YouTubeService,
    private youtubeRepo: YouTubeRepository,
    private guildService: GuildService,
    private logger: Logger,
  ) {}

  /**
   * Run the YouTube check for all enabled subscriptions.
   * @param catchUp If true, silently sync latest video IDs without announcing (used on startup).
   */
  async check(catchUp = false): Promise<void> {
    const log = this.logger.child({ component: "youtube-checker" });

    let subscriptions;
    try {
      subscriptions = await this.youtubeRepo.getEnabledSubscriptions();
    } catch (err) {
      log.error({ err }, "Failed to load YouTube subscriptions");
      return;
    }

    if (subscriptions.length === 0) return;

    log.info({ count: subscriptions.length, catchUp }, "Checking YouTube subscriptions");

    for (const sub of subscriptions) {
      try {
        const video = await this.youtubeService.fetchLatestVideo(sub.youtubeChannelId);
        if (!video) continue;

        // Dedup: skip if we've already seen this video
        if (video.id === sub.lastVideoId) continue;

        // Update the last video ID regardless (catchUp or not)
        await this.youtubeRepo.updateLastVideoId(sub.id, video.id);

        // On catchUp (startup), don't announce — just sync
        if (catchUp) {
          log.debug(
            { guildId: sub.guildId, youtubeChannelId: sub.youtubeChannelId, videoId: video.id },
            "Synced latest video ID (catchUp)",
          );
          continue;
        }

        // If there was no previous video ID, this is likely the first check — don't announce
        if (!sub.lastVideoId) {
          log.debug(
            { guildId: sub.guildId, youtubeChannelId: sub.youtubeChannelId },
            "First check for subscription, skipping announcement",
          );
          continue;
        }

        // Announce the new video
        await this.announce(sub.guildId, sub.notifyChannelId, video, sub.customMessage, log);
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
