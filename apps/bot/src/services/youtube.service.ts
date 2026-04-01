import { XMLParser } from "fast-xml-parser";

export interface YouTubeVideo {
  id: string;
  title: string;
  url: string;
  author: string;
  publishedAt: string;
  thumbnailUrl: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export class YouTubeService {
  /** Fetch the latest video from a YouTube channel's RSS feed. */
  async fetchLatestVideo(youtubeChannelId: string): Promise<YouTubeVideo | null> {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(youtubeChannelId)}`;

    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "DragonBot/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const xml = await res.text();
    const parsed = parser.parse(xml);

    const feed = parsed?.feed;
    if (!feed) return null;

    // RSS feed returns entries as an array (or single object if only 1 video)
    const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
    if (entries.length === 0) return null;

    const latest = entries[0];
    const videoId = latest["yt:videoId"] as string | undefined;
    if (!videoId) return null;

    return {
      id: videoId,
      title: (latest.title as string) ?? "Untitled",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      author: (feed.title as string) ?? (latest.author?.name as string) ?? "Unknown",
      publishedAt: (latest.published as string) ?? "",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  /** Build a notification message with template substitution. */
  buildNotificationMessage(
    video: YouTubeVideo,
    customMessage: string | null,
  ): string {
    if (customMessage) {
      return customMessage
        .replace(/\{title}/g, video.title)
        .replace(/\{url}/g, video.url)
        .replace(/\{channel}/g, video.author)
        .trim();
    }

    return `**${video.author}** just uploaded a new video!\n${video.url}`;
  }
}
