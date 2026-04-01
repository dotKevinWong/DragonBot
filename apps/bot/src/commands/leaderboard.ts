import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed } from "../utils/embeds.js";
import { xpProgress } from "../utils/xp.js";

const MEDALS = ["🥇", "🥈", "🥉"];

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the XP leaderboard for this server")
    .addIntegerOption((opt) =>
      opt.setName("page").setDescription("Page number (10 per page)").setMinValue(1),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    const guild = await ctx.services.guild.getSettings(interaction.guildId);
    if (!guild?.isXpEnabled) {
      await interaction.editReply({ embeds: [errorEmbed("XP is not enabled in this server.")] });
      return;
    }

    const requestedPage = interaction.options.getInteger("page") ?? 1;
    const perPage = 10;
    const allEntries = ctx.services.xp.getLeaderboard(interaction.guildId, 100);

    if (allEntries.length === 0) {
      await interaction.editReply({ embeds: [errorEmbed("No one has earned XP yet.")] });
      return;
    }

    const totalPages = Math.ceil(allEntries.length / perPage);
    if (requestedPage > totalPages) {
      await interaction.editReply({ embeds: [errorEmbed(`Page ${requestedPage} doesn't exist. There are only ${totalPages} page${totalPages === 1 ? "" : "s"}.`)] });
      return;
    }
    const currentPage = requestedPage - 1;
    const entries = allEntries.slice(currentPage * perPage, (currentPage + 1) * perPage);

    // Resolve usernames
    const resolved = await Promise.all(
      entries.map(async (entry) => {
        let name = entry.discordId;
        try {
          const user = await interaction.client.users.fetch(entry.discordId);
          name = user.displayName;
        } catch {
          // fallback to ID
        }
        return { ...entry, name };
      }),
    );

    const lines = resolved.map((entry) => {
      const rank = entry.rank;
      const medal = rank <= 3 ? MEDALS[rank - 1] : `**${rank}**`;
      const progress = xpProgress(entry.totalXp, entry.level);
      const barLen = 8;
      const filled = Math.round((progress.current / Math.max(progress.required, 1)) * barLen);
      const bar = "▰".repeat(filled) + "▱".repeat(barLen - filled);

      return `${medal}\n**${entry.name}** | ${entry.messageCount.toLocaleString()} Messages (${entry.xpMessageCount.toLocaleString()} earned XP) | ${entry.totalXp.toLocaleString()} XP | Level ${entry.level}\n${bar} ${progress.current}/${progress.required} to Lvl ${entry.level + 1}`;
    });

    // Get requesting user's rank for footer
    const userRank = ctx.services.xp.getRank(interaction.guildId, interaction.user.id);
    const footerText = userRank
      ? `Your rank: #${userRank.rank} · Level ${userRank.level} · ${userRank.totalXp.toLocaleString()} XP`
      : "Send messages to start earning XP!";

    const embed = new EmbedBuilder()
      .setColor(0xffcc00)
      .setAuthor({
        name: interaction.guild?.name ?? "Leaderboard",
        iconURL: interaction.guild?.iconURL() ?? undefined,
      })
      .setTitle("Leaderboard")
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `${footerText} · Page ${requestedPage}/${totalPages}` })
      .setTimestamp();

    const leaderboardUrl = `${ctx.config.WEBAPP_URL}/leaderboard/${interaction.guildId}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("View Full Leaderboard")
        .setStyle(ButtonStyle.Link)
        .setURL(leaderboardUrl),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};

export default command;
