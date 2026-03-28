import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";

let lastFlushAt = 0;
let isFlushing = false;
const FLUSH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const command: BotCommand = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("xp-admin")
    .setDescription("XP system administration")
    .addSubcommand((sub) =>
      sub
        .setName("flush")
        .setDescription("Manually flush XP data to the database"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset")
        .setDescription("Reset a user's XP in this server")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to reset").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("View XP system status and stats"),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    // Check permissions: require "xp" or "*" scope, or guild MANAGE_GUILD permission
    const hasGuildPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!hasGuildPermission) {
      const hasXpScope = await ctx.services.guildAdmin.hasPermission(interaction.guildId, interaction.user.id, "xp");
      if (!hasXpScope) {
        await interaction.editReply({ embeds: [errorEmbed("You need the `xp` permission or Manage Server to use this.")] });
        return;
      }
    }

    const sub = interaction.options.getSubcommand();

    try {
      switch (sub) {
        case "flush": {
          const now = Date.now();
          if (isFlushing) {
            await interaction.editReply({ embeds: [errorEmbed("A flush is already in progress.")] });
            break;
          }
          if (now - lastFlushAt < FLUSH_COOLDOWN_MS) {
            const remainingSec = Math.ceil((FLUSH_COOLDOWN_MS - (now - lastFlushAt)) / 1000);
            await interaction.editReply({ embeds: [errorEmbed(`Flush is on cooldown. Try again in ${remainingSec}s.`)] });
            break;
          }
          // Set flags before awaiting to prevent concurrent flushes
          isFlushing = true;
          lastFlushAt = now;
          try {
            await ctx.services.xp.flush();
          } finally {
            isFlushing = false;
          }
          await interaction.editReply({ embeds: [successEmbed("XP data flushed to database.")] });
          break;
        }

        case "reset": {
          const user = interaction.options.getUser("user", true);
          const didReset = ctx.services.xp.resetUser(interaction.guildId, user.id);
          if (didReset) {
            await interaction.editReply({ embeds: [successEmbed(`XP reset for **${user.displayName}**.`)] });
          } else {
            await interaction.editReply({ embeds: [errorEmbed(`${user.displayName} has no XP data to reset.`)] });
          }
          break;
        }

        case "status": {
          const guild = await ctx.services.guild.getSettings(interaction.guildId);
          const stats = ctx.services.xp.getStats();
          const guildEntries = ctx.services.xp.getLeaderboard(interaction.guildId, 9999);

          await interaction.editReply({
            embeds: [infoEmbed(
              `**XP System Status**\n` +
              `Enabled: ${guild?.isXpEnabled ? "✅" : "❌"}\n` +
              `XP Range: ${guild?.xpMin ?? 15}–${guild?.xpMax ?? 25}\n` +
              `Cooldown: ${guild?.xpCooldownSeconds ?? 60}s\n` +
              `Level-up Channel: ${guild?.xpLevelupChannelId ? `<#${guild.xpLevelupChannelId}>` : "Same channel"}\n` +
              `Excluded Channels: ${guild?.xpExcludedChannelIds.length ?? 0}\n` +
              `Excluded Roles: ${guild?.xpExcludedRoleIds.length ?? 0}\n\n` +
              `**Cache Stats**\n` +
              `Total entries: ${stats.totalEntries}\n` +
              `Dirty (pending flush): ${stats.dirtyEntries}\n` +
              `Users in this guild: ${guildEntries.length}\n\n` +
              `*Configure XP settings via the web dashboard.*`,
            )],
          });
          break;
        }
      }
    } catch (err) {
      if (err instanceof AppError) {
        await interaction.editReply({ embeds: [errorEmbed(err.message)] });
        return;
      }
      ctx.logger.error({ err, sub }, "Error in /xp-admin");
      await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
    }
  },
};

export default command;
