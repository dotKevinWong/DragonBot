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

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: targetUser.displayName,
        iconURL: targetUser.displayAvatarURL(),
      })
      .addFields(
        { name: "Rank", value: `#${rankInfo.rank} / ${rankInfo.totalUsers}`, inline: true },
        { name: "Level", value: `${rankInfo.level}`, inline: true },
        { name: "Total XP", value: `${rankInfo.totalXp.toLocaleString()}`, inline: true },
        { name: "Messages", value: `${rankInfo.messageCount.toLocaleString()}`, inline: true },
        { name: "XP Messages", value: `${rankInfo.xpMessageCount.toLocaleString()}`, inline: true },
        {
          name: `Progress to Level ${rankInfo.level + 1}`,
          value: `${rankInfo.progressBar} ${rankInfo.currentLevelXp} / ${rankInfo.requiredLevelXp} XP`,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
