import { EmbedBuilder, type Message } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";
import { validateIntroduction } from "../utils/intro-validator.js";

const event: BotEvent<"messageCreate"> = {
  name: "messageCreate",

  async execute(message: Message, ctx: BotContext) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guild = await ctx.services.guild.getSettings(message.guild.id);
    if (!guild) return;

    // Introduction gate
    if (
      guild.isIntroGateEnabled &&
      guild.introChannelId &&
      guild.introRoleId &&
      message.channel.id === guild.introChannelId
    ) {
      const result = validateIntroduction(
        message.content,
        guild.introMinChars,
        guild.introMinWords,
      );

      if (result.valid) {
        try {
          const member = await message.guild.members.fetch(message.author.id);
          if (!member.roles.cache.has(guild.introRoleId)) {
            await member.roles.add(guild.introRoleId);
            ctx.logger.info(
              { guildId: message.guild.id, userId: message.author.id },
              "Intro role assigned",
            );
          }
        } catch (err) {
          ctx.logger.warn({ err }, "Failed to assign intro role");
        }
      }
    }

    // XP processing
    if (guild.isXpEnabled) {
      // Check excluded channels
      if (guild.xpExcludedChannelIds.includes(message.channel.id)) return;

      // Check excluded roles
      try {
        const member = message.member ?? await message.guild.members.fetch(message.author.id);
        const hasExcludedRole = guild.xpExcludedRoleIds.some((roleId) =>
          member.roles.cache.has(roleId),
        );
        if (hasExcludedRole) return;
      } catch {
        // If we can't fetch the member, skip XP silently
        return;
      }

      const xpResult = ctx.services.xp.processMessage(
        message.guild.id,
        message.author.id,
        {
          xpMin: guild.xpMin,
          xpMax: guild.xpMax,
          xpCooldownSeconds: guild.xpCooldownSeconds,
          xpExcludedChannelIds: guild.xpExcludedChannelIds,
          xpExcludedRoleIds: guild.xpExcludedRoleIds,
        },
      );

      if (xpResult?.leveledUp) {
        const levelUpEmbed = new EmbedBuilder()
          .setColor(0x43b581)
          .setDescription(
            `🎉 **${message.author.displayName}** reached **Level ${xpResult.newLevel}**!`,
          );

        try {
          // Send to configured level-up channel, or same channel
          const channelId = guild.xpLevelupChannelId ?? message.channel.id;
          const channel = await message.guild.channels.fetch(channelId);
          if (channel?.isTextBased()) {
            await channel.send({ embeds: [levelUpEmbed] });
          }
        } catch (err) {
          ctx.logger.warn({ err }, "Failed to send level-up message");
        }
      }
    }
  },
};

export default event;
