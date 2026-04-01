import { eq, and } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { youtubeSubscriptions, guilds } from "@dragonbot/db";

export interface YouTubeSubscriptionRow {
  id: string;
  guildId: string;
  youtubeChannelId: string;
  youtubeChannelName: string | null;
  notifyChannelId: string;
  customMessage: string | null;
  lastVideoId: string | null;
  isEnabled: boolean;
}

export class YouTubeRepository {
  constructor(private db: DrizzleClient) {}

  /** Get all enabled subscriptions for guilds that have YouTube enabled. */
  async getEnabledSubscriptions(): Promise<YouTubeSubscriptionRow[]> {
    const rows = await this.db
      .select({
        id: youtubeSubscriptions.id,
        guildId: youtubeSubscriptions.guildId,
        youtubeChannelId: youtubeSubscriptions.youtubeChannelId,
        youtubeChannelName: youtubeSubscriptions.youtubeChannelName,
        notifyChannelId: youtubeSubscriptions.notifyChannelId,
        customMessage: youtubeSubscriptions.customMessage,
        lastVideoId: youtubeSubscriptions.lastVideoId,
        isEnabled: youtubeSubscriptions.isEnabled,
      })
      .from(youtubeSubscriptions)
      .innerJoin(guilds, eq(guilds.guildId, youtubeSubscriptions.guildId))
      .where(
        and(
          eq(guilds.isYoutubeEnabled, true),
          eq(youtubeSubscriptions.isEnabled, true),
        ),
      );

    return rows;
  }

  /** Update the last seen video ID for a subscription. */
  async updateLastVideoId(subscriptionId: string, videoId: string): Promise<void> {
    await this.db
      .update(youtubeSubscriptions)
      .set({ lastVideoId: videoId, updatedAt: new Date() })
      .where(eq(youtubeSubscriptions.id, subscriptionId));
  }
}
