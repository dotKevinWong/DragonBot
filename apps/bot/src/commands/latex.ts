import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("latex")
    .setDescription("Converts LaTeX to an image")
    .addStringOption((opt) =>
      opt.setName("expression").setDescription("The LaTeX to convert to an image").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction, _ctx: BotContext) {
    const expression = interaction.options.getString("expression", true);
    const encoded = encodeURIComponent(expression);
    const imageUrl = `https://latex.codecogs.com/png.latex?%5Cdpi%7B300%7D%20%5Cbg_white%20${encoded}`;

    const embed = new EmbedBuilder()
      .setTitle("LaTeX")
      .setColor(0x0099ff)
      .setDescription(`Here is your LaTeX: \`${expression}\``)
      .setImage(imageUrl);

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
