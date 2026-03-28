import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Email verification commands")
    .addSubcommand((sub) =>
      sub
        .setName("email")
        .setDescription("Start email verification")
        .addStringOption((opt) =>
          opt.setName("email").setDescription("Your university email address").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("code")
        .setDescription("Enter your verification code")
        .addStringOption((opt) =>
          opt.setName("code").setDescription("The 6-character code from your email").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("sync").setDescription("Sync your verification status to this server"),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const log = ctx.logger.child({ command: "verify", sub, guildId: interaction.guildId, userId: interaction.user.id });

    try {
      if (sub === "email") {
        const email = interaction.options.getString("email", true);
        await ctx.services.verification.initiateVerification(
          interaction.guildId,
          interaction.user.id,
          email,
        );
        log.info({ email }, "Verification initiated");
        await interaction.editReply({
          embeds: [successEmbed("Verification email sent! Check your inbox and use `/verify code` to complete verification.")],
        });
      } else if (sub === "code") {
        const code = interaction.options.getString("code", true);
        const result = await ctx.services.verification.confirmVerification(
          interaction.guildId,
          interaction.user.id,
          code,
        );

        // Assign verification role if configured
        const guild = await ctx.services.guild.getSettings(interaction.guildId);
        if (guild?.verificationRoleId && interaction.guild) {
          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(guild.verificationRoleId);
          } catch (err) {
            log.warn({ err }, "Failed to assign verification role");
          }
        }

        log.info({ email: result.email }, "Verification confirmed");
        await interaction.editReply({
          embeds: [successEmbed("You have been verified!")],
        });
      } else if (sub === "sync") {
        const isVerified = await ctx.services.user.isVerified(interaction.user.id);
        if (!isVerified) {
          await interaction.editReply({
            embeds: [errorEmbed("You are not verified. Use `/verify email` first.")],
          });
          return;
        }

        const guild = await ctx.services.guild.getSettings(interaction.guildId);
        if (guild?.verificationRoleId && interaction.guild) {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(guild.verificationRoleId);
        }

        await interaction.editReply({
          embeds: [successEmbed("Your verification has been synced to this server!")],
        });
      }
    } catch (err) {
      if (err instanceof AppError) {
        await interaction.editReply({ embeds: [errorEmbed(err.message)] });
        return;
      }
      log.error({ err }, "Unhandled error in /verify");
      await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
    }
  },
};

export default command;
