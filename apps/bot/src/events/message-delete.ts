import { EmbedBuilder, type Message, type PartialMessage } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"messageDelete"> = {
  name: "messageDelete",

  async execute(message: Message | PartialMessage, ctx: BotContext) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    if (await ctx.services.logging.shouldLog(message.guild.id, "message_delete")) {
      const guildId = message.guild.id;
      const content = message.content ?? "*Content not cached*";
      const attachments = message.attachments.map((a) => a.url);
      const reactions = message.reactions.cache.map((r) => `${r.emoji.toString()} (${r.count})`);
      const stickers = message.stickers.map((s) => s.name);

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: message.author?.tag ?? "Unknown",
          iconURL: message.author?.displayAvatarURL() ?? undefined,
        })
        .setTitle("Message Deleted")
        .addFields(
          { name: "Author", value: `<@${message.author?.id ?? "?"}>`, inline: true },
          { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
          { name: "Content", value: content.slice(0, 1024) || "*Empty*" },
          { name: "Reactions", value: reactions.length > 0 ? reactions.join(", ").slice(0, 1024) : "No reactions" },
          { name: "Attachments", value: attachments.length > 0 ? attachments.join("\n").slice(0, 1024) : "No attachments" },
          { name: "Stickers", value: stickers.length > 0 ? stickers.join(", ").slice(0, 1024) : "No stickers" },
          {
            name: "ID",
            value: [
              "```js",
              `User: ${message.author?.id ?? "Unknown"}`,
              `Message: ${message.id}`,
              `Channel: ${message.channel.id}`,
              `Guild: ${guildId}`,
              `Created Timestamp: ${message.createdTimestamp}`,
              `Edited Timestamp: ${message.editedTimestamp ?? "null"}`,
              `Nonce: ${message.nonce ?? "null"}`,
              "",
              "```",
            ].join("\n"),
          },
        )
        .setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, message.client, ctx.logger);
    }
  },
};

export default event;
