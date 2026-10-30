import type { Message, PartialMessage } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";
import { buildMessageDeletedEmbed } from "../utils/message-log.js";

const event: BotEvent<"messageDelete"> = {
  name: "messageDelete",

  async execute(message: Message | PartialMessage, ctx: BotContext) {
    if (!message.guild) return;
    const guildId = message.guild.id;

    // Skip messages DragonBot deleted itself: the honeypot's trigger messages and its own warning.
    if (ctx.services.honeypot.consumeOwnDeletion(message.id)) return;
    // Skip the messages of an account the honeypot just removed, which Discord's ban cleanup deletes.
    if (message.author && ctx.services.honeypot.wasRecentlyActioned(guildId, message.author.id)) return;

    if (message.author?.bot) return;

    if (await ctx.services.logging.shouldLog(guildId, "message_delete")) {
      const embed = buildMessageDeletedEmbed(message);
      await ctx.services.logging.sendLogEmbed(guildId, embed, message.client, ctx.logger);
    }
  },
};

export default event;
