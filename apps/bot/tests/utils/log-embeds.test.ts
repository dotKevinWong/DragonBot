import { describe, expect, it } from "vitest";
import type { Message, User } from "discord.js";
import { idBlockField, messageIdBlockField, userAuthor, userAuthorOrUnknown } from "../../src/utils/log-embeds.js";

describe("idBlockField", () => {
  it("fences the lines with no blank line before the closing fence", () => {
    expect(idBlockField(["User: u1", "Guild: g1"])).toEqual({ name: "ID", value: "```js\nUser: u1\nGuild: g1\n```" });
  });
});

describe("messageIdBlockField", () => {
  it("lists the message's IDs and ends with a blank line before the closing fence", () => {
    const message = {
      id: "m1",
      author: null,
      channel: { id: "c1" },
      createdTimestamp: 1,
      editedTimestamp: null,
      nonce: null,
    } as unknown as Message;
    expect(messageIdBlockField(message, "g1").value).toBe(
      "```js\nUser: Unknown\nMessage: m1\nChannel: c1\nGuild: g1\nCreated Timestamp: 1\nEdited Timestamp: null\nNonce: null\n\n```",
    );
  });
});

describe("author helpers", () => {
  const user = { tag: "u1#0001", displayAvatarURL: () => "https://cdn.example/u1.png" } as unknown as User;

  it("uses the user's tag and avatar", () => {
    expect(userAuthor(user)).toEqual({ name: "u1#0001", iconURL: "https://cdn.example/u1.png" });
    expect(userAuthorOrUnknown(user)).toEqual({ name: "u1#0001", iconURL: "https://cdn.example/u1.png" });
  });

  it("falls back to Unknown with no icon for a missing user", () => {
    expect(userAuthorOrUnknown(null)).toEqual({ name: "Unknown", iconURL: undefined });
  });
});
