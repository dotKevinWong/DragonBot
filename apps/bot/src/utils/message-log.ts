import { EmbedBuilder, type APIEmbedField, type Message, type PartialMessage } from "discord.js";

/**
 * The deleted-message log embed, shared by the delete log and the honeypot log so the two can't drift apart.
 * It only reads the message it is given, so it also works for a message that was never cached.
 * Extra fields go after the stickers and before the ID block.
 */
export function buildMessageDeletedEmbed(
  message: Message | PartialMessage,
  options: { title?: string; extraFields?: APIEmbedField[] } = {},
): EmbedBuilder {
  const guildId = message.guildId ?? "Unknown";
  const content = message.content ?? "*Content not cached*";
  const attachments = message.attachments.map((a) => a.url);
  const reactions = message.reactions.cache.map((r) => `${r.emoji.toString()} (${r.count})`);
  const stickers = message.stickers.map((s) => s.name);

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({
      name: message.author?.tag ?? "Unknown",
      iconURL: message.author?.displayAvatarURL() ?? undefined,
    })
    .setTitle(options.title ?? "Message Deleted")
    .addFields(
      { name: "Author", value: `<@${message.author?.id ?? "?"}>`, inline: true },
      { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
      { name: "Content", value: content.slice(0, 1024) || "*Empty*" },
      { name: "Reactions", value: reactions.length > 0 ? reactions.join(", ").slice(0, 1024) : "No reactions" },
      { name: "Attachments", value: attachments.length > 0 ? attachments.join("\n").slice(0, 1024) : "No attachments" },
      { name: "Stickers", value: stickers.length > 0 ? stickers.join(", ").slice(0, 1024) : "No stickers" },
      ...(options.extraFields ?? []),
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
}
