import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("List all available commands"),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers) ?? false;

    // Check guild_admins for custom permissions
    let isCustomAdmin = false;
    if (!isAdmin && interaction.guildId) {
      isCustomAdmin = await ctx.services.guildAdmin.hasAnyPermission(interaction.guildId, interaction.user.id);
    }

    const sections: string[] = [];

    // Everyone
    sections.push(
      "**General**",
      "`/verify email` — Start email verification",
      "`/verify code` — Enter verification code",
      "`/whois @user` — View a user's profile",
      "`/ask` — Ask the AI a question",
      "`/suggest` — Submit a feature suggestion",
      "`/membercount` — Server member statistics",
      "`/login` — Get a web dashboard link",
      "`/latex` — Render LaTeX expression",
      "`/roll` — Roll a d20",
      "`/help` — Show this menu",
    );

    // Moderators (Kick Members permission)
    if (isMod || isAdmin || isCustomAdmin) {
      sections.push(
        "",
        "**Moderator**",
        "`/mod talk` — Send an announcement as the bot",
        "`/mod react` — Add a reaction to a message",
      );
    }

    // Admins (Manage Guild permission or custom guild admin)
    if (isAdmin || isCustomAdmin) {
      sections.push(
        "",
        "**Admin**",
        "`/admin view-settings` — View all server settings",
        "`/admin managers-*` — Manage guild managers",
        "`/admin verification-*` — Verification settings",
        "`/admin welcome-*` — Welcome message settings",
        "`/admin log-*` — Audit logging settings",
        "`/admin intro-*` — Introduction gate settings",
        "`/admin ban-sync` — Toggle ban sync",
        "`/admin ask-toggle` — Toggle AI command",
        "",
        "**Scheduling**",
        "`/schedule add` — Create a scheduled message",
        "`/schedule list` — View all schedules",
        "`/schedule edit` — Edit a scheduled message",
        "`/schedule toggle` — Enable/disable a schedule",
        "`/schedule remove` — Delete a schedule",
        "`/schedule test` — Preview a scheduled message",
        "`/schedule reload` — Sync from database",
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("DragonBot Help")
      .setDescription(sections.join("\n"))
      .setFooter({ text: isAdmin || isCustomAdmin ? "Showing all commands" : isMod ? "Showing general + mod commands" : "Showing general commands" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export default command;
