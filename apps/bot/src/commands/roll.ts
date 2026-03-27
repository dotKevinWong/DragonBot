import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { infoEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a d20"),

  async execute(interaction: ChatInputCommandInteraction, _ctx: BotContext) {
    const result = Math.floor(Math.random() * 20) + 1;
    let message = `🎲 You rolled a **${result}**!`;
    if (result === 20) message += " Natural 20! 🎉";
    if (result === 1) message += " Critical fail! 💀";

    await interaction.reply({ embeds: [infoEmbed(message)] });
  },
};

export default command;
