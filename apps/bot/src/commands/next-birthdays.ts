import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { MONTH_NAMES, nextBirthdayYear } from "../utils/birthday.js";
import { errorEmbed } from "../utils/embeds.js";
import { replyServerOnly } from "../utils/command-helpers.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("next-birthdays")
    .setDescription("View upcoming birthdays in this server"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId || !interaction.guild) {
      await replyServerOnly(interaction);
      return;
    }

    const guild = await ctx.services.guild.getSettings(interaction.guildId);
    if (!guild?.isBirthdayEnabled) {
      await interaction.editReply({ embeds: [errorEmbed("Birthdays are not enabled in this server.")] });
      return;
    }

    try {
      // Fetch all guild members (cache may be incomplete)
      const members = await interaction.guild.members.fetch();
      const memberIds = [...members.keys()];

      const upcoming = await ctx.services.birthday.getUpcomingBirthdays(memberIds, 15);

      if (upcoming.length === 0) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle("Upcoming birthdays")
            .setDescription("No birthdays registered in this server yet.")
            .setColor(0xffd700)],
        });
        return;
      }

      // Group by date (month-day) like MEE6
      const now = new Date();
      const currentYear = now.getFullYear();
      const groups = new Map<string, { dateLabel: string; users: string[] }>();

      for (const b of upcoming) {
        // The service counted daysUntil from its own clock read, so a birthday it found today stays this year here
        const year = b.daysUntil === 0 ? currentYear : nextBirthdayYear(b.month, b.day, now);

        const monthName = MONTH_NAMES[b.month - 1] ?? "Unknown";
        const dateLabel = `${monthName} ${String(b.day).padStart(2, "0")}, ${year}`;
        const key = `${year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;

        if (!groups.has(key)) {
          groups.set(key, { dateLabel, users: [] });
        }
        const member = members.get(b.discordId);
        const mention = member
          ? `<@${b.discordId}> (${member.displayName})`
          : `<@${b.discordId}>`;
        groups.get(key)!.users.push(mention);
      }

      // Build description with date headers and user lists
      const lines: string[] = [];
      for (const [, group] of groups) {
        lines.push(`**${group.dateLabel}**`);
        for (const user of group.users) {
          lines.push(`> ${user}`);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("Upcoming birthdays")
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
