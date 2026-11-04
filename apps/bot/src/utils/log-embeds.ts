import type { APIEmbedField, EmbedAuthorOptions, Message, PartialMessage, User } from "discord.js";

/**
 * Pieces shared by the log-channel embeds the event handlers build. Each handler still owns its colour, title,
 * fields, thumbnail and timestamp; these only build the parts that are written the same way everywhere.
 */

/** The `ID` field: the given lines in a ```js code block, with no blank line before the closing fence. */
export function idBlockField(lines: string[]): APIEmbedField {
  return { name: "ID", value: ["```js", ...lines, "```"].join("\n") };
}

/**
 * The `ID` field of a message log (deleted or edited). Unlike idBlockField, it ends with a blank line before the
 * closing fence. `guildId` is a parameter because the callers read it from different places.
 */
export function messageIdBlockField(message: Message | PartialMessage, guildId: string): APIEmbedField {
  return {
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
  };
}

/** The embed author for a user who is always known: their tag and avatar. */
export function userAuthor(user: User): EmbedAuthorOptions {
  return { name: user.tag, iconURL: user.displayAvatarURL() };
}

/** The embed author for a user who may be uncached: "Unknown" and no icon when missing. */
export function userAuthorOrUnknown(user: User | null | undefined): EmbedAuthorOptions {
  return { name: user?.tag ?? "Unknown", iconURL: user?.displayAvatarURL() ?? undefined };
}
