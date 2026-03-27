import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { SUBCOMMAND_SCOPE_MAP, PERMISSION_SCOPES } from "@dragonbot/db";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Server configuration commands")
    // Removed setDefaultMemberPermissions so custom guild admins can see the command
    .addSubcommand((sub) =>
      sub.setName("view-settings").setDescription("View all server settings"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("verification-role")
        .setDescription("Set the role given on verification")
        .addRoleOption((opt) => opt.setName("role").setDescription("Role to assign").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("verification-sync")
        .setDescription("Toggle auto-verification on join")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ban-sync")
        .setDescription("Toggle cross-guild ban sync")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("welcome-message-toggle")
        .setDescription("Toggle welcome messages")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("welcome-message")
        .setDescription("Set welcome message ({member} and {server} are placeholders)")
        .addStringOption((opt) => opt.setName("message").setDescription("Welcome message text").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("welcome-message-channel")
        .setDescription("Set the welcome message channel")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel").setRequired(true).addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("dm-message-toggle")
        .setDescription("Toggle DM welcome messages")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("dm-message").setDescription("Set DM welcome message (opens modal)"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("log-channel")
        .setDescription("Set the audit log channel")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel").setRequired(true).addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("log-toggle")
        .setDescription("Toggle audit logging")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("log-events")
        .setDescription("Set which events to log (comma-separated)")
        .addStringOption((opt) =>
          opt
            .setName("events")
            .setDescription("e.g. member_join,member_leave,message_delete")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("intro-channel")
        .setDescription("Set the introduction channel")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel").setRequired(true).addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("intro-role")
        .setDescription("Set the role given on valid introduction")
        .addRoleOption((opt) => opt.setName("role").setDescription("Role").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("intro-toggle")
        .setDescription("Toggle introduction gate")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("mod-notes-channel")
        .setDescription("Set the mod notes channel")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel").setRequired(true).addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("offtopic-message")
        .setDescription("Set the off-topic response message")
        .addStringOption((opt) => opt.setName("message").setDescription("Message text").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ask-toggle")
        .setDescription("Toggle AI /ask command")
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enable or disable").setRequired(true)),
    )
    // Manager subcommands
    .addSubcommand((sub) =>
      sub
        .setName("managers-add")
        .setDescription("Add a guild manager with specific permissions")
        .addUserOption((opt) => opt.setName("user").setDescription("User to add as manager").setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName("permissions")
            .setDescription("Comma-separated scopes (e.g. verification,welcome,logging)")
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
            .setDescription("Comma-separated scopes (e.g. verification,welcome,logging)")
            .setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
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
      // Check custom guild_admins table
      const isManagerSub = sub.startsWith("managers-");

      if (isManagerSub) {
        // Manager subcommands require "managers" scope
        const hasManagerPerm = await ctx.services.guildAdmin.hasPermission(guildId, userId, "managers");
        if (!hasManagerPerm) {
          await interaction.reply({ embeds: [errorEmbed("You don't have permission to manage guild managers.")], ephemeral: true });
          return;
        }
      } else if (sub === "view-settings") {
        // Any permission grants read access
        const hasAny = await ctx.services.guildAdmin.hasAnyPermission(guildId, userId);
        if (!hasAny) {
          await interaction.reply({ embeds: [errorEmbed("You don't have permission to view server settings.")], ephemeral: true });
          return;
        }
      } else {
        // Regular settings subcommands — check specific scope
        const requiredScope = SUBCOMMAND_SCOPE_MAP[sub];
        if (!requiredScope) {
          await interaction.reply({ embeds: [errorEmbed("Permission denied.")], ephemeral: true });
          return;
        }

        const hasPerm = await ctx.services.guildAdmin.hasPermission(guildId, userId, requiredScope);
        if (!hasPerm) {
          await interaction.reply({
            embeds: [errorEmbed(`You don't have the \`${requiredScope}\` permission to change this setting.`)],
            ephemeral: true,
          });
          return;
        }
      }
    }

    // --- Manager subcommands ---
    if (sub === "managers-add") {
      const targetUser = interaction.options.getUser("user", true);
      const permStr = interaction.options.getString("permissions", true);
      const permissions = permStr.split(",").map((p) => p.trim().toLowerCase());

      // If the caller is a custom admin (not MANAGE_GUILD), they can only grant scopes they have
      if (!hasManageGuild) {
        const callerPerms = await ctx.services.guildAdmin.getPermissions(guildId, userId);
        if (!callerPerms.includes("*")) {
          const unauthorized = permissions.filter((p) => p !== "*" && !callerPerms.includes(p));
          if (unauthorized.length > 0 || permissions.includes("*")) {
            await interaction.reply({
              embeds: [errorEmbed(`You can only grant permissions you have. Missing: ${permissions.includes("*") ? "*" : unauthorized.join(", ")}`)],
              ephemeral: true,
            });
            return;
          }
        }
      }

      try {
        await ctx.services.guildAdmin.addAdmin(guildId, targetUser.id, permissions, userId);
        await interaction.reply({
          embeds: [successEmbed(`Added ${targetUser.toString()} as a manager with permissions: \`${permissions.join(", ")}\``)],
          ephemeral: true,
        });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
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
        await interaction.reply({
          embeds: [successEmbed(`Removed ${targetUser.toString()} as a manager.`)],
          ephemeral: true,
        });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "managers-list") {
      const admins = await ctx.services.guildAdmin.listAdmins(guildId);
      if (admins.length === 0) {
        await interaction.reply({ embeds: [infoEmbed("No custom guild managers configured.")], ephemeral: true });
        return;
      }

      const lines = admins.map(
        (a) => `<@${a.discordId}> — \`${a.permissions.join(", ")}\` (added by <@${a.addedBy}>)`,
      );
      await interaction.reply({
        embeds: [infoEmbed(`**Guild Managers**\n\n${lines.join("\n")}`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "managers-update") {
      const targetUser = interaction.options.getUser("user", true);
      const permStr = interaction.options.getString("permissions", true);
      const permissions = permStr.split(",").map((p) => p.trim().toLowerCase());

      // Same delegation check as managers-add
      if (!hasManageGuild) {
        const callerPerms = await ctx.services.guildAdmin.getPermissions(guildId, userId);
        if (!callerPerms.includes("*")) {
          const unauthorized = permissions.filter((p) => p !== "*" && !callerPerms.includes(p));
          if (unauthorized.length > 0 || permissions.includes("*")) {
            await interaction.reply({
              embeds: [errorEmbed(`You can only grant permissions you have. Missing: ${permissions.includes("*") ? "*" : unauthorized.join(", ")}`)],
              ephemeral: true,
            });
            return;
          }
        }
      }

      try {
        await ctx.services.guildAdmin.updatePermissions(guildId, targetUser.id, permissions, userId);
        await interaction.reply({
          embeds: [successEmbed(`Updated ${targetUser.toString()} permissions to: \`${permissions.join(", ")}\``)],
          ephemeral: true,
        });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          return;
        }
        throw err;
      }
      return;
    }

    // --- Existing settings subcommands ---
    if (sub === "view-settings") {
      const settings = await ctx.services.guild.getSettings(guildId);
      if (!settings) {
        await interaction.reply({ embeds: [errorEmbed("No settings found.")], ephemeral: true });
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
      ];

      await interaction.reply({ embeds: [infoEmbed(lines.join("\n"))], ephemeral: true });
      return;
    }

    if (sub === "dm-message") {
      const modal = new ModalBuilder()
        .setCustomId("admin:dm-message")
        .setTitle("DM Welcome Message")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("message")
              .setLabel("DM Welcome Message")
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder("Welcome to {server}! Please introduce yourself.")
              .setRequired(true),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    // All other subcommands update a setting
    const settingsMap: Record<string, () => Partial<Record<string, unknown>>> = {
      "verification-role": () => ({ verificationRoleId: interaction.options.getRole("role", true).id }),
      "verification-sync": () => ({ isVerificationSyncEnabled: interaction.options.getBoolean("enabled", true) }),
      "ban-sync": () => ({ isBanSyncEnabled: interaction.options.getBoolean("enabled", true) }),
      "welcome-message-toggle": () => ({ isWelcomeEnabled: interaction.options.getBoolean("enabled", true) }),
      "welcome-message": () => ({ welcomeMessage: interaction.options.getString("message", true) }),
      "welcome-message-channel": () => ({ welcomeChannelId: interaction.options.getChannel("channel", true).id }),
      "dm-message-toggle": () => ({ isDmWelcomeEnabled: interaction.options.getBoolean("enabled", true) }),
      "log-channel": () => ({ logChannelId: interaction.options.getChannel("channel", true).id }),
      "log-toggle": () => ({ isLoggingEnabled: interaction.options.getBoolean("enabled", true) }),
      "log-events": () => ({
        logEvents: interaction.options
          .getString("events", true)
          .split(",")
          .map((e) => e.trim().toLowerCase()),
      }),
      "intro-channel": () => ({ introChannelId: interaction.options.getChannel("channel", true).id }),
      "intro-role": () => ({ introRoleId: interaction.options.getRole("role", true).id }),
      "intro-toggle": () => ({ isIntroGateEnabled: interaction.options.getBoolean("enabled", true) }),
      "mod-notes-channel": () => ({ modNotesChannelId: interaction.options.getChannel("channel", true).id }),
      "offtopic-message": () => ({ offtopicMessage: interaction.options.getString("message", true) }),
      "ask-toggle": () => ({ isAskEnabled: interaction.options.getBoolean("enabled", true) }),
    };

    const getSettings = settingsMap[sub];
    if (!getSettings) {
      await interaction.reply({ embeds: [errorEmbed("Unknown subcommand.")], ephemeral: true });
      return;
    }

    await ctx.services.guild.updateSettings(guildId, getSettings() as Record<string, unknown>);
    await interaction.reply({ embeds: [successEmbed("Setting updated!")], ephemeral: true });
  },

  async modal(interaction: ModalSubmitInteraction, ctx: BotContext) {
    if (interaction.customId === "admin:dm-message") {
      const message = interaction.fields.getTextInputValue("message");
      if (interaction.guildId) {
        await ctx.services.guild.updateSettings(interaction.guildId, { dmWelcomeMessage: message });
      }
      await interaction.reply({ embeds: [successEmbed("DM welcome message updated!")], ephemeral: true });
    }
  },
};

export default command;
