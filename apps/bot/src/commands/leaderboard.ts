import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the MEE6 leaderboard for this server"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    try {
      const res = await fetch(
        `https://mee6.xyz/api/plugins/levels/leaderboard/${interaction.guildId}?limit=10`,
      );

      if (!res.ok) {
        await interaction.editReply({ embeds: [errorEmbed("Failed to fetch leaderboard. MEE6 might not be set up in this server.")] });
        return;
      }

      const data = (await res.json()) as {
        players: { username: string; discriminator: string; level: number; message_count: number }[];
      };

      const lines = data.players.map(
        (p, i) => `**${i + 1}.** ${p.username}#${p.discriminator} — Level ${p.level} (${p.message_count} messages)`,
      );

      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle("Leaderboard")
        .setDescription(lines.join("\n") || "No leaderboard data found.")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      ctx.logger.error({ err }, "Error in /leaderboard");
      await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
    }
  },
};

export default command;
