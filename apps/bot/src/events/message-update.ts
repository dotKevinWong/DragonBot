import { EmbedBuilder, type Message, type PartialMessage } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"messageUpdate"> = {
  name: "messageUpdate",

  async execute(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, ctx: BotContext) {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    const guild = newMessage.guild;

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

    const guildId = guild.id;
    if (await ctx.services.logging.shouldLog(guildId, "message_edit")) {

      const embed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setAuthor({
          name: newMessage.author?.tag ?? "Unknown",
          iconURL: newMessage.author?.displayAvatarURL() ?? undefined,
        })
        .setTitle("Message Edited")
        .addFields(
          { name: "Author", value: `<@${newMessage.author?.id ?? "?"}>`, inline: true },
          { name: "Channel", value: `<#${newMessage.channel.id}>`, inline: true },
          { name: "Old Content", value: (oldMessage.content ?? "*Not cached*").slice(0, 1024) },
          { name: "New Content", value: (newMessage.content ?? "*Empty*").slice(0, 1024) },
          {
            name: "ID",
            value: [
              "```js",
              `User: ${newMessage.author?.id ?? "Unknown"}`,
              `Message: ${newMessage.id}`,
              `Channel: ${newMessage.channel.id}`,
              `Guild: ${guildId}`,
              `Created Timestamp: ${newMessage.createdTimestamp}`,
              `Edited Timestamp: ${newMessage.editedTimestamp ?? "null"}`,
              `Nonce: ${newMessage.nonce ?? "null"}`,
              "",
              "```",
            ].join("\n"),
          },
        )
        .setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, newMessage.client, ctx.logger);
    }
  },
};

export default event;
