import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { PERMISSION_SCOPES } from "@dragonbot/db";

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
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
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
    if (sub === "managers-add") {
      const targetUser = interaction.options.getUser("user", true);
      const permStr = interaction.options.getString("permissions", true);
      const permissions = permStr.split(",").map((p) => p.trim().toLowerCase());

      // Validate permission names
      const invalidPerms = permissions.filter((p) => !(PERMISSION_SCOPES as readonly string[]).includes(p));
      if (invalidPerms.length > 0) {
        await interaction.editReply({
          embeds: [errorEmbed(`Invalid permissions: \`${invalidPerms.join(", ")}\`\nValid: \`${PERMISSION_SCOPES.join(", ")}\``)],
        });
        return;
      }

      if (!hasManageGuild) {
        const callerPerms = await ctx.services.guildAdmin.getPermissions(guildId, userId);
        if (!callerPerms.includes("*")) {
          const unauthorized = permissions.filter((p) => p !== "*" && !callerPerms.includes(p));
          if (unauthorized.length > 0 || permissions.includes("*")) {
            await interaction.editReply({
              embeds: [errorEmbed(`You can only grant permissions you have. Missing: ${permissions.includes("*") ? "*" : unauthorized.join(", ")}`)],
            });
            return;
          }
        }
      }

      try {
        await ctx.services.guildAdmin.addAdmin(guildId, targetUser.id, permissions, userId);
        await interaction.editReply({
          embeds: [successEmbed(`Added ${targetUser.toString()} as a manager with permissions: \`${permissions.join(", ")}\``)],
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

    if (sub === "managers-update") {
      const targetUser = interaction.options.getUser("user", true);
      const permStr = interaction.options.getString("permissions", true);
      const permissions = permStr.split(",").map((p) => p.trim().toLowerCase());

      const invalidPerms = permissions.filter((p) => !(PERMISSION_SCOPES as readonly string[]).includes(p));
      if (invalidPerms.length > 0) {
        await interaction.editReply({
          embeds: [errorEmbed(`Invalid permissions: \`${invalidPerms.join(", ")}\`\nValid: \`${PERMISSION_SCOPES.join(", ")}\``)],
        });
        return;
      }

      if (!hasManageGuild) {
        const callerPerms = await ctx.services.guildAdmin.getPermissions(guildId, userId);
        if (!callerPerms.includes("*")) {
          const unauthorized = permissions.filter((p) => p !== "*" && !callerPerms.includes(p));
          if (unauthorized.length > 0 || permissions.includes("*")) {
            await interaction.editReply({
              embeds: [errorEmbed(`You can only grant permissions you have. Missing: ${permissions.includes("*") ? "*" : unauthorized.join(", ")}`)],
            });
            return;
          }
        }
      }

      try {
        await ctx.services.guildAdmin.updatePermissions(guildId, targetUser.id, permissions, userId);
        await interaction.editReply({
          embeds: [successEmbed(`Updated ${targetUser.toString()} permissions to: \`${permissions.join(", ")}\``)],
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
  },
};

export default command;
