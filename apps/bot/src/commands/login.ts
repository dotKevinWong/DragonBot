import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { successEmbed, errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("login")
    .setDescription("Get a link to the web dashboard"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    try {
      const token = await ctx.services.auth.generateToken(
        interaction.user.id,
        interaction.id,
      );

      const url = `${ctx.config.WEBAPP_URL}/oauth?token=${token}`;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Open Dashboard")
          .setStyle(ButtonStyle.Link)
          .setURL(url),
      );

      await interaction.reply({
        embeds: [successEmbed("Click the button below to access the web dashboard. This link expires in 5 minutes.")],
        components: [row],
        ephemeral: true,
      });
    } catch (err) {
      ctx.logger.error({ err }, "Error in /login");
      await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], ephemeral: true });
    }
  },
};

export default command;
