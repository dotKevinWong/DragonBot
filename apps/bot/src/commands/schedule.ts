import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { AppError } from "../types/errors.js";
import { successEmbed, errorEmbed, infoEmbed } from "../utils/embeds.js";
import { cronToHuman } from "../services/scheduled-message.service.js";

const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Manage scheduled messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a scheduled message")
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel to send to").setRequired(true).addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((opt) =>
          opt.setName("message").setDescription("Message to send").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("interval").setDescription('e.g. "every 30 minutes", "daily at 9am", or cron').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("timezone").setDescription("Timezone (default: America/New_York)"),
        )
        .addBooleanOption((opt) =>
          opt.setName("embed").setDescription("Send as an embed?"),
        )
        .addStringOption((opt) =>
          opt.setName("embed-title").setDescription("Embed title (if embed is true)"),
        )
        .addStringOption((opt) =>
          opt.setName("embed-color").setDescription("Embed color hex (e.g. #5865f2)"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a scheduled message")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Schedule ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all scheduled messages"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Enable or disable a scheduled message")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Schedule ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("test")
        .setDescription("Send a scheduled message immediately to preview")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Schedule ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit a scheduled message")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Schedule ID").setRequired(true),
        )
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("New channel").addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((opt) =>
          opt.setName("message").setDescription("New message content"),
        )
        .addStringOption((opt) =>
          opt.setName("interval").setDescription('New interval (e.g. "daily at 9am" or cron)'),
        )
        .addStringOption((opt) =>
          opt.setName("timezone").setDescription("New timezone"),
        )
        .addBooleanOption((opt) =>
          opt.setName("embed").setDescription("Send as embed?"),
        )
        .addStringOption((opt) =>
          opt.setName("embed-title").setDescription("New embed title"),
        )
        .addStringOption((opt) =>
          opt.setName("embed-color").setDescription("New embed color hex"),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("reload").setDescription("Reload schedules from database (use after web dashboard changes)"),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "add") {
      const channel = interaction.options.getChannel("channel", true);
      const message = interaction.options.getString("message", true);
      const interval = interaction.options.getString("interval", true);
      const timezone = interaction.options.getString("timezone") ?? "America/New_York";
      const isEmbed = interaction.options.getBoolean("embed") ?? false;
      const embedTitle = interaction.options.getString("embed-title") ?? null;
      const embedColor = interaction.options.getString("embed-color") ?? null;

      try {
        const schedule = await ctx.services.scheduledMessage.create({
          guildId,
          channelId: channel.id,
          message,
          interval,
          timezone,
          isEmbed,
          embedTitle,
          embedColor,
          createdBy: interaction.user.id,
        });

        // Register with scheduler
        if (ctx.scheduler) {
          ctx.scheduler.addJob(schedule);
        }

        await interaction.reply({
          embeds: [successEmbed(
            `Scheduled message #${schedule.id} created!\n` +
            `**Channel:** <#${channel.id}>\n` +
            `**Schedule:** ${cronToHuman(schedule.cronExpression)}\n` +
            `**Timezone:** ${schedule.timezone}`,
          )],
          ephemeral: true,
        });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "remove") {
      const id = interaction.options.getString("id", true);
      try {
        await ctx.services.scheduledMessage.remove(id, guildId);
        if (ctx.scheduler) {
          ctx.scheduler.removeJob(id);
        }
        await interaction.reply({ embeds: [successEmbed(`Scheduled message #${id} removed.`)], ephemeral: true });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "list") {
      const schedules = await ctx.services.scheduledMessage.listByGuild(guildId);
      if (schedules.length === 0) {
        await interaction.reply({ embeds: [infoEmbed("No scheduled messages configured.")], ephemeral: true });
        return;
      }

      const lines = schedules.map((s) => {
        const status = s.isEnabled ? "✅" : "⏸️";
        const preview = s.message.length > 50 ? s.message.slice(0, 50) + "..." : s.message;
        return `${status} **#${s.id}** — <#${s.channelId}>\n` +
          `  ${cronToHuman(s.cronExpression)} (${s.timezone})\n` +
          `  \`${preview}\``;
      });

      await interaction.reply({
        embeds: [infoEmbed(`**Scheduled Messages**\n\n${lines.join("\n\n")}`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "toggle") {
      const id = interaction.options.getString("id", true);
      try {
        const updated = await ctx.services.scheduledMessage.toggle(id, guildId);
        if (ctx.scheduler) {
          await ctx.scheduler.reloadJob(id);
        }
        const status = updated?.isEnabled ? "enabled" : "disabled";
        await interaction.reply({ embeds: [successEmbed(`Scheduled message #${id} ${status}.`)], ephemeral: true });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "edit") {
      const id = interaction.options.getString("id", true);
      const channel = interaction.options.getChannel("channel");
      const message = interaction.options.getString("message");
      const interval = interaction.options.getString("interval");
      const timezone = interaction.options.getString("timezone");
      const isEmbed = interaction.options.getBoolean("embed");
      const embedTitle = interaction.options.getString("embed-title");
      const embedColor = interaction.options.getString("embed-color");

      const updates: Record<string, unknown> = {};
      if (channel) updates.channelId = channel.id;
      if (message) updates.message = message;
      if (interval) updates.interval = interval;
      if (timezone) updates.timezone = timezone;
      if (isEmbed !== null) updates.isEmbed = isEmbed;
      if (embedTitle !== null) updates.embedTitle = embedTitle || null;
      if (embedColor !== null) updates.embedColor = embedColor || null;

      if (Object.keys(updates).length === 0) {
        await interaction.reply({ embeds: [errorEmbed("No changes provided. Specify at least one option to edit.")], ephemeral: true });
        return;
      }

      try {
        const updated = await ctx.services.scheduledMessage.update(id, guildId, updates as Parameters<typeof ctx.services.scheduledMessage.update>[2]);
        if (ctx.scheduler) {
          await ctx.scheduler.reloadJob(id);
        }
        await interaction.reply({
          embeds: [successEmbed(`Scheduled message #${id} updated!`)],
          ephemeral: true,
        });
      } catch (err) {
        if (err instanceof AppError) {
          await interaction.reply({ embeds: [errorEmbed(err.message)], ephemeral: true });
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "test") {
      const id = interaction.options.getString("id", true);
      if (ctx.scheduler) {
        const success = await ctx.scheduler.testJob(id, guildId);
        if (success) {
          await interaction.reply({ embeds: [successEmbed(`Test message #${id} sent!`)], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [errorEmbed("Scheduled message not found.")], ephemeral: true });
        }
      } else {
        await interaction.reply({ embeds: [errorEmbed("Scheduler not ready yet.")], ephemeral: true });
      }
      return;
    }

    if (sub === "reload") {
      if (ctx.scheduler) {
        await ctx.scheduler.reload();
        await interaction.reply({
          embeds: [successEmbed(`Schedules reloaded! ${ctx.scheduler.activeJobCount} active job(s).`)],
          ephemeral: true,
        });
      } else {
        await interaction.reply({ embeds: [errorEmbed("Scheduler not ready yet.")], ephemeral: true });
      }
      return;
    }
  },
};

export default command;
