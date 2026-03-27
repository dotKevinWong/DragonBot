import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("offtopic")
    .setDescription("Get the off-topic response"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
      return;
    }

    const guild = await ctx.services.guild.getSettings(interaction.guildId);
    const message = guild?.offtopicMessage ?? "This is off-topic!";
    const images = guild?.offtopicImages ?? [];

    const embed = new EmbedBuilder().setColor(0xffcc00).setDescription(message);

    if (images.length > 0) {
      const randomImage = images[Math.floor(Math.random() * images.length)]!;
      embed.setImage(randomImage);
    }

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
