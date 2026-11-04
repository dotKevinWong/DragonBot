import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { replyServerOnly } from "../utils/command-helpers.js";
import { PERMISSION_SCOPES, missingScopes, type RepeatSpamMatchMode } from "@dragonbot/db";

const REPEAT_MATCH_LABELS: Record<RepeatSpamMatchMode, string> = {
  exact: "Word for word, case-sensitive",
  ignore_case: "Word for word, ignoring case",
  similar: "Too similar",
};

/** The permissions option as a list: each item trimmed and lowercased. Empty items and duplicates are kept. */
function parsePermissionList(permStr: string): string[] {
  return permStr.split(",").map((p) => p.trim().toLowerCase());
}

/**
 * Why the caller may not grant `requested`, as the text to show, or null if they may. Checks, in order: every item is
 * a known scope; then, unless the caller has Manage Server (which skips reading their grants), that the caller holds
 * every requested scope ("*" only by a "*" holder). Used by managers-add and managers-update.
 */
async function grantRefusal(
  ctx: BotContext,
  guildId: string,
  callerId: string,
  hasManageGuild: boolean,
  requested: string[],
): Promise<string | null> {
  const invalidPerms = requested.filter((p) => !(PERMISSION_SCOPES as readonly string[]).includes(p));
  if (invalidPerms.length > 0) {
    return `Invalid permissions: \`${invalidPerms.join(", ")}\`\nValid: \`${PERMISSION_SCOPES.join(", ")}\``;
  }
  if (hasManageGuild) return null;

  const callerPerms = await ctx.services.guildAdmin.getPermissions(guildId, callerId);
  const missing = missingScopes(requested, callerPerms);
  if (missing.length === 0) return null;
  return `You can only grant permissions you have. Missing: ${requested.includes("*") ? "*" : missing.join(", ")}`;
}

const command: BotCommand = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Server administration commands")
    .addSubcommand((sub) =>
      sub.setName("view-settings").setDescription("View all server settings"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("managers-add")
        .setDescription("Add a guild manager with specific permissions")
        .addUserOption((opt) => opt.setName("user").setDescription("User to add as manager").setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName("permissions")
            .setDescription("Comma-separated scopes (e.g. verification,welcome,logging,xp)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("managers-remove")
        .setDescription("Remove a guild manager")
        .addUserOption((opt) => opt.setName("user").setDescription("User to remove").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("managers-list").setDescription("List all guild managers and their permissions"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("managers-update")
        .setDescription("Update a guild manager's permissions")
        .addUserOption((opt) => opt.setName("user").setDescription("User to update").setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName("permissions")
            .setDescription("Comma-separated scopes (e.g. verification,welcome,logging,xp)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("reload").setDescription("Reload all caches and settings (use after web dashboard changes)"),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await replyServerOnly(interaction);
      return;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // Ensure guild exists
    await ctx.services.guild.ensureGuild(guildId, interaction.guild?.name ?? "Unknown");

    // --- Permission check ---
    const hasManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

    if (!hasManageGuild) {
      const isManagerSub = sub.startsWith("managers-");

      if (isManagerSub) {
        const hasManagerPerm = await ctx.services.guildAdmin.hasPermission(guildId, userId, "managers");
        if (!hasManagerPerm) {
          await interaction.editReply({ embeds: [errorEmbed("You don't have permission to manage guild managers.")] });
          return;
        }
      } else if (sub === "view-settings" || sub === "reload") {
        const hasAny = await ctx.services.guildAdmin.hasAnyPermission(guildId, userId);
        if (!hasAny) {
          await interaction.editReply({ embeds: [errorEmbed("You don't have permission.")] });
          return;
        }
      }
    }

    // --- View settings ---
    if (sub === "view-settings") {
      const settings = await ctx.services.guild.getSettings(guildId);
      if (!settings) {
        await interaction.editReply({ embeds: [errorEmbed("No settings found.")] });
        return;
      }

      const lines = [
        `**Verification Role:** ${settings.verificationRoleId ? `<@&${settings.verificationRoleId}>` : "Not set"}`,
        `**Verification Sync:** ${settings.isVerificationSyncEnabled ? "Enabled" : "Disabled"}`,
        `**Ban Sync:** ${settings.isBanSyncEnabled ? "Enabled" : "Disabled"}`,
        `**Welcome:** ${settings.isWelcomeEnabled ? "Enabled" : "Disabled"} ${settings.welcomeChannelId ? `in <#${settings.welcomeChannelId}>` : ""}`,
        `**DM Welcome:** ${settings.isDmWelcomeEnabled ? "Enabled" : "Disabled"}`,
        `**Logging:** ${settings.isLoggingEnabled ? "Enabled" : "Disabled"} ${settings.logChannelId ? `in <#${settings.logChannelId}>` : ""}`,
        `**Log Events:** ${settings.logEvents.length > 0 ? settings.logEvents.join(", ") : "None"}`,
        `**Intro Gate:** ${settings.isIntroGateEnabled ? "Enabled" : "Disabled"} ${settings.introChannelId ? `in <#${settings.introChannelId}>` : ""}`,
        `**Intro Role:** ${settings.introRoleId ? `<@&${settings.introRoleId}>` : "Not set"}`,
        `**Mod Notes:** ${settings.modNotesChannelId ? `<#${settings.modNotesChannelId}>` : "Not set"}`,
        `**Honeypot:** ${settings.isHoneypotEnabled ? "Enabled" : "Disabled"} ${settings.honeypotChannelId ? `in <#${settings.honeypotChannelId}>` : ""} (${settings.honeypotAction === "ban" ? "Ban" : "Kick"}, warning ${settings.honeypotWarningChannelId === settings.honeypotChannelId && settings.honeypotWarningMessageId ? "posted" : "not posted"})`,
        `**Repeated messages:** ${settings.isRepeatSpamEnabled ? "Enabled" : "Disabled"} (kick after ${settings.repeatSpamChannelCount} channels, ${REPEAT_MATCH_LABELS[settings.repeatSpamMatchMode]})`,
        `**Suggestions:** ${settings.isSuggestionsEnabled ? "Enabled" : "Disabled"}`,
        `**AI Ask:** ${settings.isAskEnabled ? "Enabled" : "Disabled"}`,
        `**XP:** ${settings.isXpEnabled ? "Enabled" : "Disabled"} (${settings.xpMin}–${settings.xpMax} XP, ${settings.xpCooldownSeconds}s cooldown)`,
        "",
        `*Use the [web dashboard](${ctx.config.WEBAPP_URL}) to edit settings.*`,
      ];

      await interaction.editReply({ embeds: [infoEmbed(lines.join("\n"))] });
      return;
    }

    // --- Reload ---
    if (sub === "reload") {
      try {
        await ctx.services.guild.hydrateAll();
        if (ctx.scheduler) {
          await ctx.scheduler.reload();
        }
        await ctx.honeypotWarning?.sync(guildId, { resetBudget: true });
        await interaction.editReply({
          embeds: [successEmbed(`Settings and schedules reloaded! ${ctx.scheduler?.activeJobCount ?? 0} active schedule(s).`)],
        });
      } catch (err) {
        ctx.logger.error({ err }, "Failed to reload");
        await interaction.editReply({ embeds: [errorEmbed("Failed to reload. Check logs.")] });
      }
      return;
    }

    // --- Manager subcommands ---
    if (sub === "managers-add" || sub === "managers-update") {
      const targetUser = interaction.options.getUser("user", true);
      const permStr = interaction.options.getString("permissions", true);
      const permissions = parsePermissionList(permStr);

      const refusal = await grantRefusal(ctx, guildId, userId, hasManageGuild, permissions);
      if (refusal) {
        await interaction.editReply({ embeds: [errorEmbed(refusal)] });
        return;
      }

      try {
        if (sub === "managers-add") {
          await ctx.services.guildAdmin.addAdmin(guildId, targetUser.id, permissions, userId);
          await interaction.editReply({
            embeds: [successEmbed(`Added ${targetUser.toString()} as a manager with permissions: \`${permissions.join(", ")}\``)],
          });
        } else {
          await ctx.services.guildAdmin.updatePermissions(guildId, targetUser.id, permissions, userId);
          await interaction.editReply({
            embeds: [successEmbed(`Updated ${targetUser.toString()} permissions to: \`${permissions.join(", ")}\``)],
          });
        }
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.editReply({ embeds: [errorEmbed(err.message)] });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "managers-remove") {
      const targetUser = interaction.options.getUser("user", true);
      try {
        await ctx.services.guildAdmin.removeAdmin(guildId, targetUser.id);
        await interaction.editReply({
          embeds: [successEmbed(`Removed ${targetUser.toString()} as a manager.`)],
        });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.editReply({ embeds: [errorEmbed(err.message)] });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "managers-list") {
      const admins = await ctx.services.guildAdmin.listAdmins(guildId);
      if (admins.length === 0) {
        await interaction.editReply({ embeds: [infoEmbed("No custom guild managers configured.")] });
        return;
      }

      if (!interaction.guild) {
        await interaction.editReply({ embeds: [errorEmbed("Guild not available.")] });
        return;
      }
      const members = await interaction.guild.members.fetch({ user: [...new Set(admins.flatMap((a) => [a.discordId, a.addedBy]))] });
      const resolveName = (id: string) => {
        const member = members.get(id);
        return member ? `<@${id}> (${member.displayName})` : `<@${id}>`;
      };
      const lines = admins.map(
        (a) => `${resolveName(a.discordId)} — \`${a.permissions.join(", ")}\` (added by ${resolveName(a.addedBy)})`,
      );
      await interaction.editReply({
        embeds: [infoEmbed(`**Guild Managers**\n\n${lines.join("\n")}`)],
      });
      return;
    }
  },
};

export default command;
