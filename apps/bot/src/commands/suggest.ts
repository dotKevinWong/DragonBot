import { SlashCommandBuilder, type ChatInputCommandInteraction, type TextChannel } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion")
    .addStringOption((opt) =>
      opt.setName("suggestion").setDescription("Your suggestion").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
      return;
    }

    try {
      const suggestion = interaction.options.getString("suggestion", true);
      const record = await ctx.services.suggestion.create({
        guildId: interaction.guildId,
        discordId: interaction.user.id,
        discordUsername: interaction.user.tag,
        suggestion,
      });

      await interaction.reply({
        embeds: [successEmbed(`Suggestion #${record.id} submitted! Thank you.`)],
        ephemeral: true,
      });

      // Post to mod notes channel if configured
      const guild = await ctx.services.guild.getSettings(interaction.guildId);
      if (guild?.modNotesChannelId) {
        try {
          const channel = await interaction.client.channels.fetch(guild.modNotesChannelId);
          if (channel?.isTextBased()) {
            const embed = infoEmbed(
              `**New Suggestion #${record.id}**\nFrom: ${interaction.user.tag}\n\n${suggestion}`,
            );
            const msg = await (channel as TextChannel).send({ embeds: [embed] });
            await msg.react("👍");
            await msg.react("👎");
          }
        } catch (err) {
          ctx.logger.warn({ err }, "Failed to post suggestion to mod notes");
        }
      }
    } catch (err) {
      if (err instanceof AppError) {
        await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
        return;
      }
      ctx.logger.error({ err }, "Error in /suggest");
      await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], ephemeral: true });
    }
  },
};

export default command;
