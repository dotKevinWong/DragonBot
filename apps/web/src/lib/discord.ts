import { eq, and } from "drizzle-orm";
import { guildAdmins } from "@dragonbot/db/schema";
import { env } from "./env";
import { db } from "./db";

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
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

/** Fetch a Discord user's info (avatar, username) */
export async function getDiscordUser(userId: string): Promise<{
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
} | null> {
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as DiscordUser;
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
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
export async function getGuildIconUrl(guildId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` },
    });
    if (!res.ok) return null;
    const guild = (await res.json()) as DiscordGuild;
    if (!guild.icon) return null;
    return `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.${guild.icon.startsWith("a_") ? "gif" : "png"}?size=128`;
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
 * fetch or error refuses access. At most two Discord calls: the guild, then the member (not needed for the owner).
 */
async function checkDiscordManageGuild(
  guildId: string,
  userId: string,
): Promise<boolean> {
  try {
    const headers = { Authorization: `Bot ${env.DISCORD_API_TOKEN}` };

    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, { headers });
    if (!guildRes.ok) return false;

    const guild = (await guildRes.json()) as DiscordGuild;
    if (guild.owner_id === userId) return true;

    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      { headers },
    );
    if (!memberRes.ok) return false;

    const member = (await memberRes.json()) as DiscordGuildMember;
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
 */
export async function checkGuildPermission(
  guildId: string,
  userId: string,
  scope?: string,
): Promise<boolean> {
  // The server owner, Administrator or Manage Server always grants full access
  const hasManageGuild = await checkDiscordManageGuild(guildId, userId);
  if (hasManageGuild) return true;

  // Check custom guild_admins table
  try {
    const rows = await db
      .select()
      .from(guildAdmins)
      .where(and(eq(guildAdmins.guildId, guildId), eq(guildAdmins.discordId, userId)))
      .limit(1);

    const admin = rows[0];
    if (!admin || admin.permissions.length === 0) return false;

    // Wildcard grants everything
    if (admin.permissions.includes("*")) return true;

    // No specific scope requested — any permission grants read access
    if (!scope) return true;

    return admin.permissions.includes(scope);
  } catch {
    return false;
  }
}

/**
 * Get the list of permission scopes a user has for a guild.
 * Returns ["*"] for the server owner, Administrator or Manage Server.
 * Returns empty array if no permissions.
 */
export async function getUserGuildPermissions(
  guildId: string,
  userId: string,
): Promise<string[]> {
  const hasManageGuild = await checkDiscordManageGuild(guildId, userId);
  if (hasManageGuild) return ["*"];

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

/** Simple in-memory cache for Discord user lookups (10 min TTL, prevents N+1 API abuse). */
const userCache = new Map<string, { data: { username: string; displayName: string; avatarUrl: string | null } | null; expiresAt: number }>();
const USER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Resolve a Discord user ID to display name + avatar. Cached for 10 minutes. Respects rate limits. */
export async function resolveDiscordUser(userId: string): Promise<{ username: string; displayName: string; avatarUrl: string | null } | null> {
  const cached = userCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
      headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` },
    });
    if (res.status === 429) {
      // Rate limited — don't cache the failure so we can retry later
      return null;
    }
    if (!res.ok) {
      userCache.set(userId, { data: null, expiresAt: Date.now() + USER_CACHE_TTL_MS });
      return null;
    }
    const user = await res.json() as { id: string; username: string; global_name: string | null; avatar: string | null };
    const data = {
      username: user.username,
      displayName: user.global_name ?? user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
    };
    userCache.set(userId, { data, expiresAt: Date.now() + USER_CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}

/** Resolve multiple Discord user IDs with concurrency control to avoid rate limits. */
export async function resolveDiscordUsers(
  userIds: string[],
  concurrency = 5,
): Promise<Map<string, { username: string; displayName: string; avatarUrl: string | null }>> {
  const results = new Map<string, { username: string; displayName: string; avatarUrl: string | null }>();
  const queue = [...userIds];

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const resolved = await Promise.all(
      batch.map(async (id) => ({ id, data: await resolveDiscordUser(id) })),
    );
    for (const { id, data } of resolved) {
      if (data) results.set(id, data);
    }
  }

  return results;
}

/** Check if a user is a member of a guild (regardless of permissions). */
export async function isGuildMember(guildId: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      { headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` } },
    );
    return res.ok;
  } catch {
    return false;
  }
}
