import { EmbedBuilder, type Message, type PartialMessage } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";
import { messageIdBlockField, userAuthorOrUnknown } from "../utils/log-embeds.js";

const event: BotEvent<"messageUpdate"> = {
  name: "messageUpdate",

  async execute(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, ctx: BotContext) {
    if (!newMessage.guild) return;
    // Runs before the fetch below, so an uncached message from a bot (author unknown) still gets through.
    if (newMessage.author?.bot) return;

    const guild = newMessage.guild;
    const guildId = guild.id;

    // Checked before any Discord call, so servers that don't log edits make none.
    if (!(await ctx.services.logging.shouldLog(guildId, "message_edit"))) return;

    // Fetch full message data if either side is uncached (partial)
    if (newMessage.partial) {
      try {
        newMessage = await newMessage.fetch();
      } catch {
        return;
      }
    }

    // For uncached old messages, we don't have the pre-edit content.
    // Check editedTimestamp to confirm this is an actual edit, not just
    // embed resolution or other non-content updates.
    if (oldMessage.partial) {
      if (!newMessage.editedTimestamp) return;
    } else {
      if (oldMessage.content === newMessage.content) return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xffcc00)
      .setAuthor(userAuthorOrUnknown(newMessage.author))
      .setTitle("Message Edited")
      .addFields(
        { name: "Author", value: `<@${newMessage.author?.id ?? "?"}>`, inline: true },
        { name: "Channel", value: `<#${newMessage.channel.id}>`, inline: true },
        { name: "Old Content", value: (oldMessage.content ?? "*Not cached*").slice(0, 1024) },
        { name: "New Content", value: (newMessage.content ?? "*Empty*").slice(0, 1024) },
        messageIdBlockField(newMessage, guildId),
      )
      .setTimestamp();

    await ctx.services.logging.sendLogEmbed(guildId, embed, newMessage.client, ctx.logger);
  },
};

export default event;
