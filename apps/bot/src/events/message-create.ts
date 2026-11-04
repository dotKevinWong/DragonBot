import { EmbedBuilder, type Message } from "discord.js";
import { deleteLateMessage, handleHoneypotMessage } from "../lib/honeypot-enforcer.js";
import type { GuildRow } from "@dragonbot/db";
import { handleRepeatSpamMessage } from "../lib/repeat-spam-enforcer.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";
import { validateIntroduction } from "../utils/intro-validator.js";

const event: BotEvent<"messageCreate"> = {
  name: "messageCreate",

  /** Runs each step in order. A step that handles the message ends the pipeline. */
  async execute(message: Message, ctx: BotContext) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    const guild = await ctx.services.guild.getSettings(message.guild.id);
    if (!guild) return;

    // Honeypot, before the intro gate and XP: a honeypot message never earns XP
    if ((await handleHoneypotMessage(message, guild, ctx)) === "handled") return;
    // Messages from an account the honeypot just removed are deleted on arrival
    if (await deleteLateMessage(message, ctx)) return;
    // Repeated-message check: the same message in several channels gets the account kicked
    if ((await handleRepeatSpamMessage(message, guild, ctx)) === "handled") return;

    // A rejected intro earns no XP and posts no level-up. This holds even if the delete
    // failed: the message was still rejected, and the user was told to try again.
    if ((await runIntroGate(message, guild, ctx)) === "rejected") return;

    await awardXp(message, guild, ctx);
  },
};

/**
 * The introduction gate. In the intro channel, gives the intro role for a valid introduction, or deletes an invalid
 * one and DMs the user why. Returns "rejected" for an invalid introduction, "continue" otherwise.
 * Fetches the member rather than using message.member, and warns on any failure.
 */
async function runIntroGate(
  message: Message<true>,
  guild: GuildRow,
  ctx: BotContext,
): Promise<"rejected" | "continue"> {
  if (
    !(
      guild.isIntroGateEnabled &&
      guild.introChannelId &&
      guild.introRoleId &&
      message.channel.id === guild.introChannelId
    )
  ) {
    return "continue";
  }

  const result = validateIntroduction(message.content, {
    minChars: guild.introMinChars,
    minWords: guild.introMinWords,
    minSubstantiveWords: guild.introMinSubstantiveWords,
    uniqueWordRatio: guild.introUniqueWordRatio,
    maxRepeatedCharPct: guild.introMaxRepeatedCharPct,
  });

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
    return "continue";
  }

  // Delete the rejected message and DM the user with feedback
  const originalContent = message.content.length > 1000
    ? `${message.content.slice(0, 1000)}...`
    : message.content;

  try {
    await message.delete();
  } catch (err) {
    ctx.logger.warn({ err, guildId: message.guild.id }, "Failed to delete rejected intro message");
  }

  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xffcc00)
      .setTitle("Introduction Not Accepted")
      .setDescription(
        `${result.reason}\n\nPlease try again in <#${guild.introChannelId}>.`,
      )
      .addFields({
        name: "Your message",
        value: originalContent || "(empty)",
      })
      .setFooter({ text: message.guild.name })
      .setTimestamp();
    await message.author.send({ embeds: [dmEmbed] });
  } catch (err) {
    ctx.logger.warn({ err, userId: message.author.id }, "Failed to DM user about rejected intro");
  }

  return "rejected";
}

/**
 * XP for a message, and the level-up post. Excluded channels are checked before any member lookup. Uses
 * message.member, fetching only when it's missing, and skips XP silently if that fails.
 */
async function awardXp(message: Message<true>, guild: GuildRow, ctx: BotContext): Promise<void> {
  if (!guild.isXpEnabled) return;

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

export default event;
