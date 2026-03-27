import { eq, and } from "drizzle-orm";
import { guildAdmins } from "@dragonbot/db/schema";
import { env } from "./env";
import { db } from "./db";

interface DiscordGuildMember {
  user: { id: string };
  roles: string[];
  permissions: string;
}

interface DiscordGuild {
  owner_id: string;
  icon: string | null;
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

/** Check if a user has Discord's MANAGE_GUILD permission (owner or permission bit) */
async function checkDiscordManageGuild(
  guildId: string,
  userId: string,
): Promise<boolean> {
  try {
    // Check if user is guild owner
    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` },
    });

    if (guildRes.ok) {
      const guild = (await guildRes.json()) as DiscordGuild;
      if (guild.owner_id === userId) return true;
    }

    // Check member permissions
    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      { headers: { Authorization: `Bot ${env.DISCORD_API_TOKEN}` } },
    );

    if (!memberRes.ok) return false;

    const member = (await memberRes.json()) as DiscordGuildMember;
    const permissions = BigInt(member.permissions);
    const MANAGE_GUILD = BigInt(1 << 5);

    return (permissions & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

/**
 * Check if a user has permission to manage a guild.
 *
 * 1. Discord MANAGE_GUILD always grants full access.
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
  // Discord MANAGE_GUILD always grants full access
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
 * Returns ["*"] for Discord MANAGE_GUILD holders.
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
