import type { Message } from "discord.js";
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
  },
};

export default event;
