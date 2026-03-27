import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError, ErrorCode } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the AI a question")
    .addStringOption((opt) =>
      opt.setName("question").setDescription("Your question").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
      return;
    }

    const guild = await ctx.services.guild.getSettings(interaction.guildId);
    if (guild && !guild.isAskEnabled) {
      await interaction.reply({ embeds: [errorEmbed("The AI ask feature is disabled in this server.")], ephemeral: true });
      return;
    }

    // Check verification
    const isVerified = await ctx.services.user.isVerified(interaction.user.id);
    if (!isVerified) {
      await interaction.reply({ embeds: [errorEmbed("You must be verified to use this command. Use `/verify email` first.")], ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const question = interaction.options.getString("question", true);
      const answer = await ctx.ai.ask(question, guild?.askSystemPrompt);
      await interaction.editReply({ embeds: [infoEmbed(answer)] });
    } catch (err) {
      ctx.logger.error({ err }, "Error in /ask");
      await interaction.editReply({ embeds: [errorEmbed("Failed to get a response. Please try again.")] });
    }
  },
};

export default command;
