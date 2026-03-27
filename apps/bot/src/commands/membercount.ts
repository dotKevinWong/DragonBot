import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("membercount")
    .setDescription("Get the number of users, bots and verified members in the server"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guild) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
      return;
    }

    await interaction.guild.members.fetch();

    const memberCount = interaction.guild.memberCount;
    const botCount = interaction.guild.members.cache.filter((m) => m.user.bot).size;
    const humanCount = memberCount - botCount;

    let verifiedCount = 0;
    const guild = await ctx.services.guild.getSettings(interaction.guildId!);
    if (guild?.verificationRoleId) {
      verifiedCount = interaction.guild.members.cache.filter((m) =>
        m.roles.cache.has(guild.verificationRoleId!),
      ).size;
    }

    const embed = new EmbedBuilder()
      .setTitle("Member Count")
      .setColor(0x0099ff)
      .addFields(
        { name: "👤 Members", value: `${memberCount}` },
        { name: "🤓 Humans", value: `${humanCount}` },
        { name: "😎 Verified", value: `${verifiedCount}` },
        { name: "🤖 Bots", value: `${botCount}` },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
