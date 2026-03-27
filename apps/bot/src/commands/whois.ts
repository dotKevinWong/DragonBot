import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("whois")
    .setDescription("View a user's profile")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to look up (defaults to yourself)"),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    const targetUser = interaction.options.getUser("user") ?? interaction.user;

    try {
      const profile = await ctx.services.user.getProfile(targetUser.id);

      const fields: { name: string; value: string; inline: boolean }[] = [];
      if (profile.name) fields.push({ name: "Name", value: profile.name, inline: true });
      if (profile.pronouns) fields.push({ name: "Pronouns", value: profile.pronouns, inline: true });
      if (profile.major) fields.push({ name: "Major", value: profile.major, inline: true });
      if (profile.college) fields.push({ name: "College", value: profile.college, inline: true });
      if (profile.year) fields.push({ name: "Year", value: profile.year, inline: true });
      if (profile.plan) fields.push({ name: "Plan", value: profile.plan, inline: true });
      if (profile.coop1) fields.push({ name: "Co-op 1", value: profile.coop1, inline: true });
      if (profile.coop2) fields.push({ name: "Co-op 2", value: profile.coop2, inline: true });
      if (profile.coop3) fields.push({ name: "Co-op 3", value: profile.coop3, inline: true });
      if (profile.clubs?.length) fields.push({ name: "Clubs", value: profile.clubs.join(", "), inline: false });
      if (profile.description) fields.push({ name: "About", value: profile.description, inline: false });

      const embed = new EmbedBuilder()
        .setColor(0x43b581)
        .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL() })
        .setFields(fields)
        .setFooter({ text: profile.isVerified ? "Verified" : "Not verified" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Notify target user via DM if it's not themselves
      if (targetUser.id !== interaction.user.id) {
        try {
          await targetUser.send(
            `${interaction.user.tag} viewed your profile in **${interaction.guild?.name ?? "a server"}**.`,
          );
        } catch {
          // DMs might be disabled — silently ignore
        }
      }
    } catch (err) {
      if (err instanceof AppError) {
        await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
        return;
      }
      ctx.logger.error({ err }, "Error in /whois");
      await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], ephemeral: true });
    }
  },
};

export default command;
