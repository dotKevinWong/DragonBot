import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { replyAppErrorOrFail, replyServerOnly } from "../utils/command-helpers.js";

/** Replies with the Administrator error and returns false unless the caller has Administrator (reset-all, restore). */
async function requireAdministrator(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  if (!isAdmin) {
    await interaction.editReply({ embeds: [errorEmbed("This command requires **Administrator** permission.")] });
  }
  return isAdmin;
}

async function replyArchiveUnavailable(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.editReply({ embeds: [errorEmbed("Archive system not available.")] });
}

let lastFlushAt = 0;
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset-all")
        .setDescription("Reset ALL XP for this server (archives data first)")
        .addStringOption((opt) =>
          opt.setName("confirm").setDescription("Type CONFIRM to proceed").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Reason for reset (optional)").setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("restore")
        .setDescription("Restore XP from an archive (overwrites current XP)")
        .addStringOption((opt) =>
          opt.setName("archive_id").setDescription("Archive ID from /xp-admin archives").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("confirm").setDescription("Type CONFIRM to proceed").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("archives")
        .setDescription("List recent XP archives for this server"),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await replyServerOnly(interaction);
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
    const xpArchive = ctx.services.xpArchive;

    try {
      switch (sub) {
        case "flush": {
          const now = Date.now();
          if (ctx.services.xp.flushing) {
            await interaction.editReply({ embeds: [errorEmbed("A flush is already in progress.")] });
            break;
          }
          if (now - lastFlushAt < FLUSH_COOLDOWN_MS) {
            const remainingSec = Math.ceil((FLUSH_COOLDOWN_MS - (now - lastFlushAt)) / 1000);
            await interaction.editReply({ embeds: [errorEmbed(`Flush is on cooldown. Try again in ${remainingSec}s.`)] });
            break;
          }
          lastFlushAt = now;
          await ctx.services.xp.flush();
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

        case "reset-all": {
          // Require Administrator permission (stricter than MANAGE_GUILD)
          if (!(await requireAdministrator(interaction))) break;

          const confirmStr = interaction.options.getString("confirm", true);
          if (confirmStr !== "CONFIRM") {
            await interaction.editReply({ embeds: [errorEmbed("You must type `CONFIRM` to reset all XP. This action archives current data before resetting.")] });
            break;
          }

          const reason = interaction.options.getString("reason") ?? null;
          const guildId = interaction.guildId;
          const log = ctx.logger.child({ command: "xp-admin", sub: "reset-all", guildId });

          const result = await xpArchive.resetAll(guildId, interaction.user.id, reason, log);
          if (result.kind === "flush-failed") {
            await interaction.editReply({ embeds: [errorEmbed("Failed to flush XP data before reset. Reset aborted to prevent data loss.")] });
            break;
          }
          if (result.kind === "empty") {
            await interaction.editReply({ embeds: [errorEmbed("No XP data found for this server.")] });
            break;
          }
          if (result.kind === "unavailable") {
            await replyArchiveUnavailable(interaction);
            break;
          }

          await interaction.editReply({
            embeds: [successEmbed(
              `**XP Reset Complete**\n\n` +
              `Archived **${result.userCount}** users with **${result.totalXpSum.toLocaleString()}** total XP.\n` +
              `Archive ID: \`${result.archiveId}\`\n` +
              `${reason ? `Reason: ${reason}\n` : ""}` +
              `\nUse \`/xp-admin restore\` with the archive ID to undo.`,
            )],
          });
          break;
        }

        case "restore": {
          // Require Administrator permission
          if (!(await requireAdministrator(interaction))) break;

          if (!xpArchive.available) {
            await replyArchiveUnavailable(interaction);
            break;
          }

          const confirmStr = interaction.options.getString("confirm", true);
          if (confirmStr !== "CONFIRM") {
            await interaction.editReply({ embeds: [errorEmbed("You must type `CONFIRM` to restore. This will **overwrite** current XP data.")] });
            break;
          }

          const archiveId = interaction.options.getString("archive_id", true).trim();
          const guildId = interaction.guildId;
          const log = ctx.logger.child({ command: "xp-admin", sub: "restore", guildId, archiveId });

          const result = await xpArchive.restore(guildId, interaction.user.id, archiveId, log);
          switch (result.kind) {
            case "unavailable":
              await replyArchiveUnavailable(interaction);
              break;
            case "invalid-id":
              await interaction.editReply({ embeds: [errorEmbed("Invalid archive ID format.")] });
              break;
            case "not-found":
              await interaction.editReply({ embeds: [errorEmbed("Archive not found.")] });
              break;
            case "not-array":
              await interaction.editReply({ embeds: [errorEmbed("Archive data is corrupted (not an array).")] });
              break;
            case "invalid-entry":
              await interaction.editReply({ embeds: [errorEmbed("Archive data is corrupted (invalid entry format).")] });
              break;
            case "ok":
              await interaction.editReply({
                embeds: [successEmbed(
                  `**XP Restored**\n\n` +
                  `Restored **${result.restored}** users with **${result.archiveTotalXpSum.toLocaleString()}** total XP from archive \`${archiveId.slice(0, 8)}...\`.`,
                )],
              });
              break;
          }
          break;
        }

        case "archives": {
          const archives = await xpArchive.listRecent(interaction.guildId);
          if (!archives) {
            await replyArchiveUnavailable(interaction);
            break;
          }
          if (archives.length === 0) {
            await interaction.editReply({ embeds: [infoEmbed("No XP archives found for this server.")] });
            break;
          }

          const archiverIds = [...new Set(archives.map((a) => a.archivedBy))];
          if (!interaction.guild) {
            await interaction.editReply({ embeds: [errorEmbed("Guild not available.")] });
            break;
          }
          const members = await interaction.guild.members.fetch({ user: archiverIds });
          const lines = archives.map((a) => {
            const date = new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const restored = a.restoredAt ? " ✅ restored" : "";
            const archiver = members.get(a.archivedBy);
            const archiverName = archiver ? `<@${a.archivedBy}> (${archiver.displayName})` : `<@${a.archivedBy}>`;
            return `\`${a.id.slice(0, 8)}...\` — ${date} — ${a.userCount} users, ${a.totalXpSum.toLocaleString()} XP — ${archiverName}${restored}`;
          });

          await interaction.editReply({
            embeds: [infoEmbed(`**XP Archives**\n\n${lines.join("\n")}`)],
          });
          break;
        }
      }
    } catch (err) {
      await replyAppErrorOrFail(interaction, err, () => ctx.logger.error({ err, sub }, "Error in /xp-admin"));
    }
  },
};

export default command;
