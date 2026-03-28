import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { errorEmbed, infoEmbed, successEmbed } from "../utils/embeds.js";
import { cronToHuman } from "../services/scheduled-message.service.js";

const command: BotCommand = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("View and test scheduled messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all scheduled messages"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("test")
        .setDescription("Send a scheduled message immediately to preview it")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Schedule ID").setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.editReply({ embeds: [errorEmbed("This command can only be used in a server.")] });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "list") {
      const schedules = await ctx.services.scheduledMessage.listByGuild(guildId);
      if (schedules.length === 0) {
        await interaction.editReply({
          embeds: [infoEmbed(
            `No scheduled messages configured.\n\nManage schedules via the [web dashboard](${ctx.config.WEBAPP_URL}).`,
          )],
        });
        return;
      }

      const lines = schedules.map((s) => {
        const status = s.isEnabled ? "✅" : "⏸️";
        const preview = s.message.length > 50 ? s.message.slice(0, 50) + "..." : s.message;
        return (
          `${status} \`${s.id}\` — <#${s.channelId}>\n` +
          `  ${cronToHuman(s.cronExpression)} (${s.timezone})\n` +
          `  \`${preview}\``
        );
      });

      await interaction.editReply({
        embeds: [infoEmbed(
          `**Scheduled Messages**\n\n${lines.join("\n\n")}\n\n` +
          `*Manage schedules via the [web dashboard](${ctx.config.WEBAPP_URL}).*`,
        )],
      });
      return;
    }

    if (sub === "test") {
      const id = interaction.options.getString("id", true);
      if (!ctx.scheduler) {
        await interaction.editReply({ embeds: [errorEmbed("Scheduler not ready yet.")] });
        return;
      }
      const success = await ctx.scheduler.testJob(id, guildId);
      if (success) {
        await interaction.editReply({ embeds: [successEmbed(`Test message sent for schedule \`${id}\`.`)] });
      } else {
        await interaction.editReply({ embeds: [errorEmbed(`Scheduled message \`${id}\` not found in this server.`)] });
      }
      return;
    }
  },
};

export default command;
