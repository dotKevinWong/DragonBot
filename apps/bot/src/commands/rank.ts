import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View your XP rank or another user's rank")
    .addUserOption((option) =>
      option.setName("user").setDescription("User to check rank for").setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    const guild = await ctx.services.guild.getSettings(interaction.guildId);
    if (!guild?.isXpEnabled) {
      await interaction.editReply({ embeds: [errorEmbed("XP is not enabled in this server.")] });
      return;
    }

    const targetUser = interaction.options.getUser("user") ?? interaction.user;
    const rankInfo = ctx.services.xp.getRank(interaction.guildId, targetUser.id);

    if (!rankInfo) {
      await interaction.editReply({
        embeds: [errorEmbed(`${targetUser.id === interaction.user.id ? "You haven't" : `${targetUser.displayName} hasn't`} earned any XP yet.`)],
      });
      return;
    }

    const percent = rankInfo.requiredLevelXp > 0
      ? Math.round((rankInfo.currentLevelXp / rankInfo.requiredLevelXp) * 100)
      : 0;
    const barLength = 12;
    const filled = Math.round((percent / 100) * barLength);
    const bar = "▰".repeat(filled) + "▱".repeat(barLength - filled);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: targetUser.displayName,
        iconURL: targetUser.displayAvatarURL(),
      })
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .setDescription(
        `**RANK #${rankInfo.rank}**  ·  **LEVEL ${rankInfo.level}**\n\n` +
        `${bar}  ${percent}% to Level ${rankInfo.level + 1}\n` +
        `${rankInfo.currentLevelXp.toLocaleString()} / ${rankInfo.requiredLevelXp.toLocaleString()} XP  ·  ${rankInfo.messageCount.toLocaleString()} messages`,
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
