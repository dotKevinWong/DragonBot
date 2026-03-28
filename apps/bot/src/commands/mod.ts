import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import type { BotContext } from "../types/context.js";
import type { BotCommand } from "../types/commands.js";
import { successEmbed, errorEmbed } from "../utils/embeds.js";

const command: BotCommand = {
  skipDefer: true,
  data: new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Moderation tools")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addSubcommand((sub) =>
      sub
        .setName("talk")
        .setDescription("Send a message as the bot")
        .addStringOption((opt) =>
          opt.setName("message").setDescription("Message to send").setRequired(true),
        )
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel to send in (defaults to current)"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("react")
        .setDescription("Add a reaction to a message")
        .addStringOption((opt) =>
          opt.setName("message_id").setDescription("Message ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("emote").setDescription("Emoji to react with").setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, ctx: BotContext) {
    const sub = interaction.options.getSubcommand();

    if (sub === "talk") {
      const message = interaction.options.getString("message", true);
      const channel = (interaction.options.getChannel("channel") ?? interaction.channel) as TextChannel;

      const embed = new EmbedBuilder()
        .setTitle("📣 Announcement")
        .setColor(0x0099ff)
        .setDescription(message)
        .setFooter({
          text: `Posted by ${interaction.user.username}`,
          iconURL: interaction.user.displayAvatarURL(),
        });

      if (!channel?.isTextBased()) {
        await interaction.reply({ embeds: [errorEmbed("That channel is not a text channel.")], ephemeral: true });
        return;
      }
      await channel.send({ embeds: [embed] });
      await interaction.reply({ embeds: [successEmbed("Announcement sent!")], ephemeral: true });
    } else if (sub === "react") {
      const messageId = interaction.options.getString("message_id", true);
      const emote = interaction.options.getString("emote", true);

      try {
        const channel = interaction.channel as TextChannel;
        const message = await channel.messages.fetch(messageId);
        await message.react(emote);
        await interaction.reply({ embeds: [successEmbed("Reaction added!")], ephemeral: true });
      } catch (err) {
        ctx.logger.warn({ err }, "Failed to add reaction");
        await interaction.reply({ embeds: [errorEmbed("Failed to add reaction. Check the message ID and emoji.")], ephemeral: true });
      }
    }
  },
};

export default command;
