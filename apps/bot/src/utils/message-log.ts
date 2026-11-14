import { EmbedBuilder, type APIEmbedField, type Message, type PartialMessage } from "discord.js";
import { messageIdBlockField, userAuthorOrUnknown } from "./log-embeds.js";

/**
 * Content text for a deleted message DragonBot never cached. Discord's delete event carries only IDs, so the content
 * and author come from the bot's in-memory cache, which starts empty on every restart and keeps 200 messages per channel.
 */
export const NOT_CACHED_CONTENT =
  "*Not cached: DragonBot only remembers messages sent since it last started (the newest 200 per channel).*";

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
  const content = message.content ?? NOT_CACHED_CONTENT;
  const attachments = message.attachments.map((a) => a.url);
  const reactions = message.reactions.cache.map((r) => `${r.emoji.toString()} (${r.count})`);
  const stickers = message.stickers.map((s) => s.name);

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor(userAuthorOrUnknown(message.author))
    .setTitle(options.title ?? "Message Deleted")
    .addFields(
      { name: "Author", value: message.author ? `<@${message.author.id}>` : "Unknown", inline: true },
      { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
      { name: "Content", value: content.slice(0, 1024) || "*Empty*" },
      { name: "Reactions", value: reactions.length > 0 ? reactions.join(", ").slice(0, 1024) : "No reactions" },
      { name: "Attachments", value: attachments.length > 0 ? attachments.join("\n").slice(0, 1024) : "No attachments" },
      { name: "Stickers", value: stickers.length > 0 ? stickers.join(", ").slice(0, 1024) : "No stickers" },
      ...(options.extraFields ?? []),
      messageIdBlockField(message, guildId),
    )
    .setTimestamp();
}

/**
 * The repeated-message check's log embed: the account, the channels its copies reached, the message text and what
 * DragonBot did. message is the copy that triggered the case.
 */
export function buildRepeatSpamEmbed(message: Message<true>, channelIds: string[], actionText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xff0000)
    .setAuthor({
      name: message.author.tag,
      iconURL: message.author.displayAvatarURL(),
    })
    .setTitle("Repeated Messages (Honeypot)")
    .setDescription(`Posted the same message in ${channelIds.length} channels.`)
    .addFields(
      { name: "Author", value: `<@${message.author.id}>`, inline: true },
      { name: "Channels", value: channelIds.map((id) => `<#${id}>`).join(", ").slice(0, 1024) },
      { name: "Content", value: message.content.slice(0, 1024) || "*Empty*" },
      { name: "Honeypot Action", value: actionText },
      {
        name: "ID",
        value: [
          "```js",
          `User: ${message.author.id}`,
          `Message: ${message.id}`,
          `Guild: ${message.guildId}`,
          "",
          "```",
        ].join("\n"),
      },
    )
    .setTimestamp();
}
