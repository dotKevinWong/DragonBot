import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";

const command: BotCommand = {
  ephemeral: true,
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
      "`/verify sync` — Sync verified role to this server",
      "`/whois @user` — View a user's profile",
      "`/ask` — Ask the AI a question",
      "`/suggest` — Submit a feature suggestion",
      "`/membercount` — Server member statistics",
      "`/login` — Get a web dashboard link",
      "`/latex` — Render LaTeX expression",
      "`/offtopic` — Get the off-topic response",
      "`/roll` — Roll a d20",
      "`/help` — Show this menu",
      "",
      "**XP & Leveling**",
      "`/rank [@user]` — View your rank or another user's",
      "`/leaderboard [page]` — View the XP leaderboard",
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
        "`/admin reload` — Reload bot cache",
        "",
        "**XP Admin**",
        "`/xp-admin status` — View XP system stats",
        "`/xp-admin flush` — Force save XP to database",
        "`/xp-admin reset @user` — Reset a user's XP",
        "",
        "**Scheduling**",
        "`/schedule list` — View all scheduled messages",
        "`/schedule test` — Preview a scheduled message",
        "",
        `*All settings are managed via the [web dashboard](${ctx.config.WEBAPP_URL}).*`,
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("DragonBot Help")
      .setDescription(sections.join("\n"))
      .setFooter({ text: isAdmin || isCustomAdmin ? "Showing all commands" : isMod ? "Showing general + mod commands" : "Showing general commands" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
