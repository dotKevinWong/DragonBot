import { eq, and } from "drizzle-orm";
import { guildAdmins } from "@dragonbot/db/schema";
import { grantsScope } from "@dragonbot/db/permissions";
import { env } from "./env";
import { db } from "./db";

const DISCORD_API = "https://discord.com/api/v10";

/** A member as `GET /guilds/{id}/members/{userId}` returns it: no `permissions`, which Discord sends only in interactions. */
interface DiscordGuildMember {
  user: { id: string };
  roles: string[];
  communication_disabled_until?: string | null;
}

/** A guild as `GET /guilds/{id}` returns it. Each role's `permissions` is a decimal string. */
interface DiscordGuild {
  owner_id: string;
  icon: string | null;
  roles: { id: string; permissions: string }[];
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
  global_name: string | null;
}

/**
 * Discord lookups shared within ONE request, so a request that checks a guild,
 * then its membership, then its icon fetches the guild and the member once.
 * Only successful responses are kept: a failed or rate-limited lookup is made
 * again, as it would be without the memo. Create one per request with
 * createDiscordLookupMemo() and never keep it across requests, or permission
 * changes would be missed.
 */
export interface DiscordLookupMemo {
  guilds: Map<string, DiscordGuild>;
  /** keyed by `${guildId}:${userId}` */
  members: Map<string, DiscordGuildMember>;
}

export function createDiscordLookupMemo(): DiscordLookupMemo {
  return { guilds: new Map(), members: new Map() };
}

const memberKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

/**
 * A Discord CDN image URL. `animated` serves a gif for an `a_` hash; otherwise png.
 * `id` is the owner of the image (the user or guild id), as the caller gives it.
 */
function discordCdnUrl(
  kind: "avatars" | "icons",
  id: string,
  hash: string,
  options: { size: number; animated: boolean },
): string {
  const ext = options.animated && hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/${kind}/${id}/${hash}.${ext}?size=${options.size}`;
}

/**
 * Discord allows 30 GET /users/{id} calls per second per bot. The leaderboard asks for up to 100 at once, so
 * without pacing everyone after the 30th came back 429 and showed as a bare ID. When Discord says the bucket
 * is empty (x-ratelimit-remaining 0) or answers 429, every user lookup in this instance waits until it refills.
 */
const MAX_RATE_LIMIT_WAIT_MS = 5000;
let usersBucketResetAt = 0;

/** The wait Discord asked for, in ms: the 429 body's retry_after, else the reset-after or Retry-After header. Null if none or too long. */
async function rateLimitWaitMs(res: Response): Promise<number | null> {
  let seconds = Number.NaN;
  try {
    const body = (await res.clone().json()) as { retry_after?: unknown };
    if (typeof body.retry_after === "number") seconds = body.retry_after;
  } catch {
    // No JSON body: fall back to the headers
  }
  if (Number.isNaN(seconds)) seconds = Number(res.headers.get("x-ratelimit-reset-after") ?? res.headers.get("retry-after") ?? Number.NaN);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.ceil(seconds * 1000);
  return ms <= MAX_RATE_LIMIT_WAIT_MS ? ms : null;
}

function noteUsersBucket(res: Response): void {
  if (res.headers.get("x-ratelimit-remaining") !== "0") return;
  const seconds = Number(res.headers.get("x-ratelimit-reset-after"));
  if (Number.isFinite(seconds) && seconds > 0 && seconds * 1000 <= MAX_RATE_LIMIT_WAIT_MS) {
    usersBucketResetAt = Math.max(usersBucketResetAt, Date.now() + Math.ceil(seconds * 1000));
  }
}

async function waitForUsersBucket(): Promise<void> {
  const wait = usersBucketResetAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * GET /users/{id}, with the outcome kept in three kinds the callers treat differently:
 * a parsed body, a non-ok status, or an error (network failure or unreadable body).
 * A 429 that says how long to wait (at most 5 seconds) is retried up to twice after that wait;
 * a 429 without a usable wait is returned as a status at once.
 */
async function fetchDiscordUserRaw(
  userId: string,
): Promise<{ kind: "ok"; user: DiscordUser } | { kind: "status"; status: number } | { kind: "error" }> {
  try {
    for (let attempt = 0; ; attempt++) {
      await waitForUsersBucket();
      const res = await fetch(`${DISCORD_API}/users/${userId}`, {
        headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` },
      });
      noteUsersBucket(res);
      if (res.status === 429 && attempt < 2) {
        const wait = await rateLimitWaitMs(res);
        if (wait !== null) {
          usersBucketResetAt = Math.max(usersBucketResetAt, Date.now() + wait);
          continue;
        }
      }
      if (!res.ok) return { kind: "status", status: res.status };
      return { kind: "ok", user: (await res.json()) as DiscordUser };
    }
  } catch {
    return { kind: "error" };
  }
}

/** Fetch a Discord user's info (avatar, username). Not cached; null on any failure. */
export async function getDiscordUser(userId: string): Promise<{
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
} | null> {
  const result = await fetchDiscordUserRaw(userId);
  if (result.kind !== "ok") return null;
  try {
    const { user } = result;
    const avatarUrl = user.avatar
      ? discordCdnUrl("avatars", user.id, user.avatar, { size: 128, animated: true })
      : null;
    return {
      username: user.username,
      displayName: user.global_name,
      avatarUrl,
    };
  } catch {
    return null;
  }
}

/** Fetch a guild's icon URL */
export async function getGuildIconUrl(guildId: string, memo?: DiscordLookupMemo): Promise<string | null> {
  try {
    let guild = memo?.guilds.get(guildId);
    if (!guild) {
      const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
        headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` },
      });
      if (!res.ok) return null;
      guild = (await res.json()) as DiscordGuild;
    }
    if (!guild.icon) return null;
    return discordCdnUrl("icons", guildId, guild.icon, { size: 128, animated: true });
  } catch {
    return null;
  }
}

const ADMINISTRATOR = BigInt(1) << BigInt(3);
const MANAGE_GUILD = BigInt(1) << BigInt(5);

/**
 * Check if a user is the server owner or has Administrator or Manage Server.
 *
 * The member's server-wide permissions are the @everyone role's (its ID is the guild ID) ORed with those of each of
 * their roles; role IDs the guild doesn't list are skipped. A timed-out member keeps only Administrator. Any failed
 * fetch or error refuses access. At most two Discord calls: the guild, then the member (not needed for the owner),
 * and none for a lookup the request's memo already holds. Never throws.
 */
async function checkDiscordManageGuild(
  guildId: string,
  userId: string,
  memo?: DiscordLookupMemo,
): Promise<boolean> {
  try {
    const headers = { Authorization: `Bot ${env.DISCORD_API_TOKEN}` };

    let guild = memo?.guilds.get(guildId);
    if (!guild) {
      const guildRes = await fetch(`${DISCORD_API}/guilds/${guildId}`, { headers });
      if (!guildRes.ok) return false;
      guild = (await guildRes.json()) as DiscordGuild;
      memo?.guilds.set(guildId, guild);
    }
    if (guild.owner_id === userId) return true;

    let member = memo?.members.get(memberKey(guildId, userId));
    if (!member) {
      const memberRes = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, { headers });
      if (!memberRes.ok) return false;
      member = (await memberRes.json()) as DiscordGuildMember;
      memo?.members.set(memberKey(guildId, userId), member);
    }

    const memberRoleIds = new Set(member.roles);
    let permissions = BigInt(0);
    for (const role of guild.roles) {
      if (role.id === guildId || memberRoleIds.has(role.id)) {
        permissions |= BigInt(role.permissions);
      }
    }

    if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) return true;

    // Discord limits a timed-out member to View Channels and Read Message History
    const timedOutUntil = member.communication_disabled_until
      ? Date.parse(member.communication_disabled_until)
      : NaN;
    if (timedOutUntil > Date.now()) return false;

    return (permissions & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

/**
 * Check if a user has permission to manage a guild.
 *
 * 1. The server owner, Administrator or Manage Server always grants full access.
 * 2. Otherwise, check the guild_admins table for custom permissions.
 *
 * @param scope - If provided, checks for a specific permission scope.
 *                If omitted, any guild_admins entry with permissions grants access.
 * @param memo - Optional request-scoped Discord lookup memo (see DiscordLookupMemo).
 */
export async function checkGuildPermission(
  guildId: string,
  userId: string,
  scope?: string,
  memo?: DiscordLookupMemo,
): Promise<boolean> {
  return grantsScope(await getUserGuildPermissions(guildId, userId, memo), scope);
}

/**
 * Get the list of permission scopes a user has for a guild.
 * Returns ["*"] for the server owner, Administrator or Manage Server.
 * Returns empty array if no permissions, or if the guild_admins lookup fails.
 */
export async function getUserGuildPermissions(
  guildId: string,
  userId: string,
  memo?: DiscordLookupMemo,
): Promise<string[]> {
  // The server owner, Administrator or Manage Server always grants full access
  const hasManageGuild = await checkDiscordManageGuild(guildId, userId, memo);
  if (hasManageGuild) return ["*"];

  // Check custom guild_admins table
  try {
    const rows = await db
      .select()
      .from(guildAdmins)
      .where(and(eq(guildAdmins.guildId, guildId), eq(guildAdmins.discordId, userId)))
      .limit(1);

    return rows[0]?.permissions ?? [];
  } catch {
    return [];
  }
}

type ResolvedDiscordUser = { username: string; displayName: string; avatarUrl: string | null };

/** Simple in-memory cache for Discord user lookups (10 min TTL, prevents N+1 API abuse). */
const userCache = new Map<string, { data: ResolvedDiscordUser | null; expiresAt: number }>();
const USER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Resolve a Discord user ID to display name + avatar. Cached for 10 minutes. Respects rate limits. */
export async function resolveDiscordUser(userId: string): Promise<ResolvedDiscordUser | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const result = await fetchDiscordUserRaw(userId);
  // A network error or unreadable body: don't cache, so we can retry later
  if (result.kind === "error") return null;
  if (result.kind === "status") {
    // Rate limited — don't cache the failure so we can retry later
    if (result.status === 429) return null;
    userCache.set(userId, { data: null, expiresAt: Date.now() + USER_CACHE_TTL_MS });
    return null;
  }

  let data: ResolvedDiscordUser;
  try {
    const { user } = result;
    data = {
      username: user.username,
      displayName: user.global_name ?? user.username,
      avatarUrl: user.avatar ? discordCdnUrl("avatars", user.id, user.avatar, { size: 64, animated: false }) : null,
    };
  } catch {
    return null;
  }
  userCache.set(userId, { data, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return data;
}

/**
 * Map `items` through `fn` with at most `concurrency` calls in flight, starting them in input order.
 * Each worker takes the next item as soon as its last call settles, so one slow call holds up only its own
 * slot. Results come back by index, in input order, whatever order the calls finish in. If `fn` rejects, the
 * returned promise rejects with that error and no further calls are started; callers should not rely on it.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // After a rejection no worker starts another call (the serial loops this replaces stopped too)
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  // A NaN or non-positive concurrency runs one call at a time rather than none
  const limit = Number.isNaN(concurrency) ? 1 : Math.max(1, concurrency);
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** Resolve multiple Discord user IDs with concurrency control to avoid rate limits. */
export async function resolveDiscordUsers(
  userIds: string[],
  concurrency = 5,
): Promise<Map<string, ResolvedDiscordUser>> {
  const results = new Map<string, ResolvedDiscordUser>();

  // A sliding pool: never more than `concurrency` lookups in flight (the old fixed waves had the same ceiling)
  const resolved = await mapWithConcurrency(userIds, concurrency, (id) => resolveDiscordUser(id));
  // Filled in input order, as the waves did
  userIds.forEach((id, i) => {
    const data = resolved[i];
    if (data) results.set(id, data);
  });

  return results;
}

/** Check if a user is a member of a guild (regardless of permissions). */
export async function isGuildMember(guildId: string, userId: string, memo?: DiscordLookupMemo): Promise<boolean> {
  // The memo holds only members Discord returned successfully
  if (memo?.members.has(memberKey(guildId, userId))) return true;
  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${userId}`,
      { headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` } },
    );
    return res.ok;
  } catch {
    return false;
  }
}
