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
  /**
   * Fetch the most recent videos (newest first, up to 15) from a YouTube channel's RSS feed.
   * Throws on HTTP or parse failures so the caller can log them instead of failing silently.
   */
  async fetchRecentVideos(youtubeChannelId: string): Promise<YouTubeVideo[]> {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(youtubeChannelId)}`;

    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DragonBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`YouTube feed request failed with HTTP ${res.status}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    const feed = parsed?.feed;
    if (!feed) throw new Error("YouTube feed response was not a valid Atom feed");

    // RSS feed returns entries as an array (or single object if only 1 video)
    const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
    const feedTitle = typeof feed.title === "string" ? feed.title : undefined;

    const videos: YouTubeVideo[] = [];
    for (const entry of entries) {
      const videoId = entry["yt:videoId"] as string | undefined;
      if (!videoId) continue;
      videos.push({
        id: String(videoId),
        title: String(entry.title ?? "Untitled"),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        author: feedTitle ?? (entry.author?.name as string) ?? "Unknown",
        publishedAt: (entry.published as string) ?? "",
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      });
    }

    // The feed is normally newest-first, but sort defensively by publish date.
    return videos.sort((a, b) => Date.parse(b.publishedAt || "0") - Date.parse(a.publishedAt || "0"));
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
