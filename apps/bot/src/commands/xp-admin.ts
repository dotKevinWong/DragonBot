import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";

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
          const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
          if (!isAdmin) {
            await interaction.editReply({ embeds: [errorEmbed("This command requires **Administrator** permission.")] });
            break;
          }

          const confirmStr = interaction.options.getString("confirm", true);
          if (confirmStr !== "CONFIRM") {
            await interaction.editReply({ embeds: [errorEmbed("You must type `CONFIRM` to reset all XP. This action archives current data before resetting.")] });
            break;
          }

          const reason = interaction.options.getString("reason") ?? null;
          const guildId = interaction.guildId;
          const log = ctx.logger.child({ command: "xp-admin", sub: "reset-all", guildId });

          // Step 1: Flush current dirty data to ensure archive is complete
          log.info("Flushing XP before archive...");
          try {
            await ctx.services.xp.flush();
          } catch (err) {
            log.error({ err }, "Flush failed before reset — aborting");
            await interaction.editReply({ embeds: [errorEmbed("Failed to flush XP data before reset. Reset aborted to prevent data loss.")] });
            break;
          }

          // Step 2: Snapshot current guild data
          const snapshot = ctx.services.xp.getGuildSnapshot(guildId);
          if (snapshot.length === 0) {
            await interaction.editReply({ embeds: [errorEmbed("No XP data found for this server.")] });
            break;
          }

          const totalXpSum = snapshot.reduce((sum, e) => sum + e.totalXp, 0);

          // Step 3: Archive to database
          if (!ctx.xpArchiveRepo) {
            await interaction.editReply({ embeds: [errorEmbed("Archive system not available.")] });
            break;
          }

          const archive = await ctx.xpArchiveRepo.create(
            guildId,
            interaction.user.id,
            reason,
            snapshot,
            snapshot.length,
            totalXpSum,
          );
          log.info({ archiveId: archive.id, users: snapshot.length, totalXp: totalXpSum }, "XP archived");

          // Step 4: Zero all in-memory entries
          ctx.services.xp.resetAllInMemory(guildId);

          // Step 5: Flush zeros to DB immediately
          try {
            await ctx.services.xp.flush();
          } catch (err) {
            log.error({ err }, "Flush after reset failed — data archived but DB may be stale");
          }

          await interaction.editReply({
            embeds: [successEmbed(
              `**XP Reset Complete**\n\n` +
              `Archived **${snapshot.length}** users with **${totalXpSum.toLocaleString()}** total XP.\n` +
              `Archive ID: \`${archive.id}\`\n` +
              `${reason ? `Reason: ${reason}\n` : ""}` +
              `\nUse \`/xp-admin restore\` with the archive ID to undo.`,
            )],
          });
          break;
        }

        case "restore": {
          // Require Administrator permission
          const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
          if (!isAdmin) {
            await interaction.editReply({ embeds: [errorEmbed("This command requires **Administrator** permission.")] });
            break;
          }

          if (!ctx.xpArchiveRepo) {
            await interaction.editReply({ embeds: [errorEmbed("Archive system not available.")] });
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

          // Validate UUID format
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(archiveId)) {
            await interaction.editReply({ embeds: [errorEmbed("Invalid archive ID format.")] });
            break;
          }

          const archive = await ctx.xpArchiveRepo.findByIdAndGuild(archiveId, guildId);
          if (!archive) {
            await interaction.editReply({ embeds: [errorEmbed("Archive not found.")] });
            break;
          }

          // Validate archive data structure before restoring
          const rawData = archive.data;
          if (!Array.isArray(rawData)) {
            await interaction.editReply({ embeds: [errorEmbed("Archive data is corrupted (not an array).")] });
            break;
          }
          const entries: { discordId: string; totalXp: number; level: number; messageCount: number; xpMessageCount: number; lastMessageAt: number }[] = [];
          for (const item of rawData) {
            if (
              typeof item !== "object" || item === null ||
              typeof (item as Record<string, unknown>).discordId !== "string" ||
              typeof (item as Record<string, unknown>).totalXp !== "number" ||
              typeof (item as Record<string, unknown>).level !== "number" ||
              typeof (item as Record<string, unknown>).messageCount !== "number" ||
              typeof (item as Record<string, unknown>).xpMessageCount !== "number" ||
              typeof (item as Record<string, unknown>).lastMessageAt !== "number"
            ) {
              await interaction.editReply({ embeds: [errorEmbed("Archive data is corrupted (invalid entry format).")] });
              break;
            }
            entries.push(item as { discordId: string; totalXp: number; level: number; messageCount: number; xpMessageCount: number; lastMessageAt: number });
          }
          if (entries.length !== rawData.length) break; // validation failed above

          // Auto-archive current data before overwriting
          await ctx.services.xp.flush();
          const currentSnapshot = ctx.services.xp.getGuildSnapshot(guildId);
          if (currentSnapshot.length > 0) {
            const currentXpSum = currentSnapshot.reduce((sum, e) => sum + e.totalXp, 0);
            await ctx.xpArchiveRepo.create(
              guildId,
              interaction.user.id,
              `Auto-archive before restore of ${archiveId.slice(0, 8)}`,
              currentSnapshot,
              currentSnapshot.length,
              currentXpSum,
            );
            log.info({ users: currentSnapshot.length }, "Auto-archived current XP before restore");
          }

          const restored = ctx.services.xp.rehydrateGuild(guildId, entries);

          // Flush to DB
          try {
            await ctx.services.xp.flush();
          } catch (err) {
            log.error({ err }, "Flush after restore failed — data is in memory but may not be persisted");
          }

          // Mark archive as restored
          await ctx.xpArchiveRepo.markRestored(archiveId);

          log.info({ restored, archiveId }, "XP restored from archive");
          await interaction.editReply({
            embeds: [successEmbed(
              `**XP Restored**\n\n` +
              `Restored **${restored}** users with **${archive.totalXpSum.toLocaleString()}** total XP from archive \`${archiveId.slice(0, 8)}...\`.`,
            )],
          });
          break;
        }

        case "archives": {
          if (!ctx.xpArchiveRepo) {
            await interaction.editReply({ embeds: [errorEmbed("Archive system not available.")] });
            break;
          }

          const archives = await ctx.xpArchiveRepo.findByGuild(interaction.guildId, 10);
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
