import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction, type TextChannel } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion")
    .addStringOption((opt) =>
      opt.setName("suggestion").setDescription("Your suggestion").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
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

      const userEmbed = new EmbedBuilder()
        .setColor(0x43b581)
        .setTitle("Suggestion Submitted")
        .setDescription(suggestion)
        .setFooter({ text: "Thank you for your feedback!" })
        .setTimestamp();

      await interaction.editReply({ embeds: [userEmbed] });

      // Post to mod notes channel if configured
      const guild = await ctx.services.guild.getSettings(interaction.guildId);
      if (guild?.modNotesChannelId) {
        try {
          const channel = await interaction.client.channels.fetch(guild.modNotesChannelId);
          if (channel?.isTextBased()) {
            const modEmbed = new EmbedBuilder()
              .setColor(0xffcc00)
              .setTitle("New Suggestion")
              .setDescription(suggestion)
              .addFields(
                { name: "From", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                { name: "Status", value: "Pending", inline: true },
              )
              .setFooter({ text: `ID: ${record.id}` })
              .setTimestamp();
            const msg = await (channel as TextChannel).send({ embeds: [modEmbed] });
            await msg.react("👍");
            await msg.react("👎");
          }
        } catch (err) {
          ctx.logger.warn({ err }, "Failed to post suggestion to mod notes");
        }
      }
    } catch (err) {
      if (err instanceof AppError) {
        await interaction.editReply({ embeds: [errorEmbed(err.message)] });
        return;
      }
      ctx.logger.error({ err }, "Error in /suggest");
      await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
    }
  },
};

export default command;
