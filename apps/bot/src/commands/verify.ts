import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { successEmbed, errorEmbed } from "../utils/embeds.js";
import { replyAppErrorOrFail, replyServerOnly } from "../utils/command-helpers.js";
import { addVerificationRole } from "../utils/verification-role.js";

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
      await replyServerOnly(interaction);
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
            await addVerificationRole(interaction.guild, interaction.user.id, guild.verificationRoleId);
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
          // Not caught here: a failure reaches the catch below and fails the command.
          await addVerificationRole(interaction.guild, interaction.user.id, guild.verificationRoleId);
        }

        await interaction.editReply({
          embeds: [successEmbed("Your verification has been synced to this server!")],
        });
      }
    } catch (err) {
      await replyAppErrorOrFail(interaction, err, () => log.error({ err }, "Unhandled error in /verify"));
    }
  },
};

export default command;
