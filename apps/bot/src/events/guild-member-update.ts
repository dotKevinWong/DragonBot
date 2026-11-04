import {
  AuditLogEvent,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
} from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

/** Entries older than this belong to an earlier change, not the one being handled. */
const MAX_ENTRY_AGE_MS = 10_000;

/** Scan a few entries so back-to-back updates to other members still match the right one. */
const ENTRY_SCAN_LIMIT = 5;

const event: BotEvent<"guildMemberUpdate"> = {
  name: "guildMemberUpdate",

  async execute(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember, ctx: BotContext) {
    const guildId = newMember.guild.id;

    // An uncached old member has no roles or nickname to diff against, and fetching it would only
    // return the member's current state. The audit log says what changed instead.
    if (oldMember.partial) {
      await logFromAuditLog(newMember, ctx);
      return;
    }

    // Role changes
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
      if (await ctx.services.logging.shouldLog(guildId, "role_change")) {
        const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
        const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

        await logRoleChange(
          newMember,
          addedRoles.map((r) => r.id),
          removedRoles.map((r) => r.id),
          ctx,
        );
      }
    }

    // Nickname changes
    if (oldMember.nickname !== newMember.nickname) {
      if (await ctx.services.logging.shouldLog(guildId, "nickname_change")) {
        await logNicknameChange(newMember, oldMember.nickname, newMember.nickname, ctx);
      }
    }
  },
};

/**
 * Logs the role and nickname change behind an update whose old member wasn't cached, from the
 * member's audit log entries of the last few seconds. Logs nothing if logging is off for both,
 * if there's no matching entry, or if the bot can't read the audit log.
 *
 * Known cost: with both log types on, every partial update makes up to two audit log calls,
 * including updates that change neither roles nor nickname (avatar, pending, boost, timeout).
 * Known limit: an entry for the other change kind from the last 10 seconds (say, a nickname set
 * just before a role change) can be logged again, giving an occasional duplicate log.
 */
async function logFromAuditLog(newMember: GuildMember, ctx: BotContext) {
  const guildId = newMember.guild.id;
  // Check before any Discord call, so servers that don't log these make none.
  const roleOn = await ctx.services.logging.shouldLog(guildId, "role_change");
  const nickOn = await ctx.services.logging.shouldLog(guildId, "nickname_change");
  if (!roleOn && !nickOn) return;

  if (roleOn) {
    const entry = await findRecentMemberEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    if (entry) {
      const added: string[] = [];
      const removed: string[] = [];
      for (const change of entry.changes) {
        if (change.key !== "$add" && change.key !== "$remove") continue;
        const roleIds = ((change.new ?? []) as { id: string }[]).map((r) => r.id);
        (change.key === "$add" ? added : removed).push(...roleIds);
      }
      await logRoleChange(newMember, added, removed, ctx);
    }
  }

  if (nickOn) {
    const entry = await findRecentMemberEntry(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    // A member update can also be a timeout, mute or deafen; only a nickname change is logged here.
    const nick = entry?.changes.find((change) => change.key === "nick");
    if (nick) {
      await logNicknameChange(
        newMember,
        (nick.old as string | undefined) ?? null,
        (nick.new as string | undefined) ?? null,
        ctx,
      );
    }
  }
}

/**
 * Finds the newest audit log entry of `type` for `targetId` from the last few seconds.
 * Returns null if there isn't one or the bot lacks the View Audit Log permission.
 * Follows findRecentAuditLogEntry in utils/audit-log.ts, which only covers kicks and bans.
 */
async function findRecentMemberEntry(
  guild: Guild,
  type: AuditLogEvent.MemberRoleUpdate | AuditLogEvent.MemberUpdate,
  targetId: string,
) {
  try {
    const auditLogs = await guild.fetchAuditLogs({ type, limit: ENTRY_SCAN_LIMIT });
    const entry = auditLogs.entries.find(
      (e) => e.targetId === targetId && Date.now() - e.createdTimestamp < MAX_ENTRY_AGE_MS,
    );
    return entry ?? null;
  } catch {
    // May not have audit log permissions
    return null;
  }
}

async function logRoleChange(
  newMember: GuildMember,
  addedRoleIds: string[],
  removedRoleIds: string[],
  ctx: BotContext,
) {
  const guildId = newMember.guild.id;

  if (addedRoleIds.length > 0 || removedRoleIds.length > 0) {
    const embed = new EmbedBuilder()
      .setColor(removedRoleIds.length > 0 ? 0xff0000 : 0xff9900)
      .setAuthor({
        name: newMember.user.tag,
        iconURL: newMember.user.displayAvatarURL(),
      })
      .setTitle("Update: Role")
      .addFields({ name: "User", value: `<@${newMember.id}>` });

    if (addedRoleIds.length > 0) {
      const added = addedRoleIds.map((id) => `➕ <@&${id}>`).join("\n");
      embed.addFields({ name: "Roles Added", value: added });
    }

    if (removedRoleIds.length > 0) {
      const removed = removedRoleIds.map((id) => `❌ <@&${id}>`).join("\n");
      embed.addFields({ name: "Roles Removed", value: removed });
    }

    embed.addFields({
      name: "ID",
      value: `\`\`\`js\nUser: ${newMember.id}\nGuild: ${guildId}\n\`\`\``,
    });
    embed.setTimestamp();

    await ctx.services.logging.sendLogEmbed(guildId, embed, newMember.client, ctx.logger);
  }
}

async function logNicknameChange(
  newMember: GuildMember,
  before: string | null,
  after: string | null,
  ctx: BotContext,
) {
  const guildId = newMember.guild.id;

  const embed = new EmbedBuilder()
    .setColor(0xffcc00)
    .setAuthor({
      name: newMember.user.tag,
      iconURL: newMember.user.displayAvatarURL(),
    })
    .setTitle("Update: Nickname")
    .addFields(
      { name: "User", value: `<@${newMember.id}>` },
      { name: "Before", value: before ?? "*None*", inline: true },
      { name: "After", value: after ?? "*None*", inline: true },
      {
        name: "ID",
        value: `\`\`\`js\nUser: ${newMember.id}\nGuild: ${guildId}\n\`\`\``,
      },
    )
    .setTimestamp();

  await ctx.services.logging.sendLogEmbed(guildId, embed, newMember.client, ctx.logger);
}

export default event;
