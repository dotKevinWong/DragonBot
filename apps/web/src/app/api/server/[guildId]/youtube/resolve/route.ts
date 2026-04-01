import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { checkGuildPermission } from "@/lib/discord";
import { DISCORD_SNOWFLAKE_RE } from "@/lib/validators";

/**
 * Resolve a YouTube URL, @handle, or channel name to a channel ID + name.
 * No Google API key required — fetches the YouTube page and extracts metadata.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const discordId = await getAuthenticatedUser(request);
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guildId } = await params;

  if (!DISCORD_SNOWFLAKE_RE.test(guildId)) {
    return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const hasPermission = await checkGuildPermission(guildId, discordId);
  if (!hasPermission) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const query = (body.query as string)?.trim();
  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const result = await resolveYouTubeChannel(query);
    if (!result) {
      return NextResponse.json({ error: "Could not find a YouTube channel. Try pasting the full channel URL." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to resolve YouTube channel" }, { status: 500 });
  }
}

interface ResolvedChannel {
  channelId: string;
  channelName: string;
}

async function resolveYouTubeChannel(query: string): Promise<ResolvedChannel | null> {
  // Already a channel ID (UC + 22 chars)
  if (/^UC[\w-]{22}$/.test(query)) {
    const name = await fetchChannelName(`https://www.youtube.com/channel/${query}`);
    return { channelId: query, channelName: name ?? query };
  }

  // Full URL: validate it's a YouTube domain to prevent SSRF
  let url: string | null = null;

  if (query.startsWith("http://") || query.startsWith("https://")) {
    try {
      const parsed = new URL(query);
      const host = parsed.hostname.toLowerCase();
      if (!host.endsWith("youtube.com") && !host.endsWith("youtu.be") && host !== "youtube.com" && host !== "youtu.be") {
        return null;
      }
      url = query;
    } catch {
      return null;
    }
  } else if (query.startsWith("youtube.com") || query.startsWith("www.youtube.com")) {
    url = `https://${query}`;
  } else if (query.startsWith("@")) {
    url = `https://www.youtube.com/${encodeURIComponent(query)}`;
  } else {
    url = `https://www.youtube.com/@${encodeURIComponent(query)}`;
  }

  if (!url) return null;

  return await fetchChannelMetadata(url);
}

async function fetchChannelMetadata(url: string): Promise<ResolvedChannel | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DragonBot/1.0)",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;

  const html = await res.text();

  // Extract channel ID from various meta patterns
  const channelId = extractChannelId(html);
  if (!channelId) return null;

  // Extract channel name from og:title or page title
  const channelName = extractChannelName(html) ?? channelId;

  return { channelId, channelName };
}

async function fetchChannelName(url: string): Promise<string | null> {
  try {
    const result = await fetchChannelMetadata(url);
    return result?.channelName ?? null;
  } catch {
    return null;
  }
}

function extractChannelId(html: string): string | null {
  // Pattern 1: <meta property="og:url" content="https://www.youtube.com/channel/UCxxxx">
  const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="[^"]*\/channel\/(UC[\w-]{22})"/);
  if (ogUrlMatch) return ogUrlMatch[1]!;

  // Pattern 2: <link rel="canonical" href="https://www.youtube.com/channel/UCxxxx">
  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="[^"]*\/channel\/(UC[\w-]{22})"/);
  if (canonicalMatch) return canonicalMatch[1]!;

  // Pattern 3: "channelId":"UCxxxx" in page JSON data
  const jsonMatch = html.match(/"channelId":"(UC[\w-]{22})"/);
  if (jsonMatch) return jsonMatch[1]!;

  // Pattern 4: "externalId":"UCxxxx" in page JSON data
  const externalMatch = html.match(/"externalId":"(UC[\w-]{22})"/);
  if (externalMatch) return externalMatch[1]!;

  // Pattern 5: /channel/UCxxxx anywhere in the page
  const channelPathMatch = html.match(/\/channel\/(UC[\w-]{22})/);
  if (channelPathMatch) return channelPathMatch[1]!;

  return null;
}

function extractChannelName(html: string): string | null {
  // Pattern 1: <meta property="og:title" content="Channel Name">
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  if (ogTitleMatch) return decodeHtmlEntities(ogTitleMatch[1]!);

  // Pattern 2: <title>Channel Name - YouTube</title>
  const titleMatch = html.match(/<title>([^<]+?)\s*-\s*YouTube<\/title>/);
  if (titleMatch) return decodeHtmlEntities(titleMatch[1]!);

  return null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}
