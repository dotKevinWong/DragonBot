import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("next-birthdays")
    .setDescription("View upcoming birthdays in this server"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    const guild = await ctx.services.guild.getSettings(interaction.guildId);
    if (!guild?.isBirthdayEnabled) {
      await interaction.editReply({ embeds: [errorEmbed("Birthdays are not enabled in this server.")] });
      return;
    }

    try {
      // Get all guild member IDs from cache
      const members = interaction.guild.members.cache;
      const memberIds = [...members.keys()];

      if (memberIds.length === 0) {
        await interaction.editReply({ embeds: [errorEmbed("No members found in cache. Try again shortly.")] });
        return;
      }

      const upcoming = await ctx.services.birthday.getUpcomingBirthdays(memberIds, 10);

      if (upcoming.length === 0) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle("🎂 Upcoming Birthdays")
            .setDescription("No birthdays registered in this server yet.")
            .setColor(0xffd700)],
        });
        return;
      }

      const lines = upcoming.map((b) => {
        const monthName = MONTH_NAMES[b.month - 1] ?? "???";
        const age = ctx.services.birthday.formatAge(b.year);
        const ageStr = age ? ` (turning ${age.replace(/(?:st|nd|rd|th)$/, "")})` : "";
        const daysStr = b.daysUntil === 0 ? "**Today!**" : `in ${b.daysUntil} day${b.daysUntil === 1 ? "" : "s"}`;
        return `<@${b.discordId}> — ${monthName} ${b.day}${ageStr} — ${daysStr}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🎂 Upcoming Birthdays")
        .setDescription(lines.join("\n"))
        .setColor(0xffd700)
        .setFooter({ text: "Set yours with /birthday set" });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      ctx.logger.error({ err, command: "next-birthdays" }, "Unhandled error");
      await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
    }
  },
};

export default command;
