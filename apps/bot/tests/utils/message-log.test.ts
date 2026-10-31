import { describe, it, expect } from "vitest";
import { Collection, type Message } from "discord.js";
import { buildMessageDeletedEmbed } from "../../src/utils/message-log.js";

function fakeMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: "m1",
    guildId: "g1",
    content: "hi",
    author: { id: "u1", tag: "spammer#0001", displayAvatarURL: () => "https://cdn.example/u1.png" },
    channel: { id: "c1" },
    attachments: new Collection(),
    reactions: { cache: new Collection() },
    stickers: new Collection(),
    createdTimestamp: 1_700_000_000_000,
    editedTimestamp: null,
    nonce: null,
    ...overrides,
  } as unknown as Message;
}

describe("buildMessageDeletedEmbed", () => {
  it("keeps today's layout and title by default", () => {
    const embed = buildMessageDeletedEmbed(fakeMessage({ content: "hi" })).toJSON();

    expect(embed.title).toBe("Message Deleted");
    expect(embed.fields!.map((f) => f.name)).toEqual(["Author", "Channel", "Content", "Reactions", "Attachments", "Stickers", "ID"]);
  });

  it("puts extra fields before the ID block and uses the given title", () => {
    const embed = buildMessageDeletedEmbed(fakeMessage({ content: "spam" }), {
      title: "Message Deleted (Honeypot)",
      extraFields: [{ name: "Honeypot Action", value: "Banned." }],
    }).toJSON();

    expect(embed.title).toBe("Message Deleted (Honeypot)");
    expect(embed.fields!.map((f) => f.name)).toEqual([
      "Author",
      "Channel",
      "Content",
      "Reactions",
      "Attachments",
      "Stickers",
      "Honeypot Action",
      "ID",
    ]);
    expect(embed.fields!.find((f) => f.name === "Honeypot Action")!.value).toBe("Banned.");
  });

  it("describes a populated message the way the delete log always has", () => {
    const embed = buildMessageDeletedEmbed(
      fakeMessage({
        content: "buy now",
        attachments: new Collection([
          ["a1", { url: "https://cdn.example/a.png" }],
          ["a2", { url: "https://cdn.example/b.png" }],
        ]),
        reactions: { cache: new Collection([["r1", { emoji: { toString: () => "👍" }, count: 2 }]]) },
        stickers: new Collection([["s1", { name: "wave" }]]),
        editedTimestamp: 1_700_000_005_000,
        nonce: "n1",
      }),
    ).toJSON();

    expect(embed.color).toBe(0xff0000);
    expect(embed.author).toEqual({ name: "spammer#0001", icon_url: "https://cdn.example/u1.png" });
    expect(embed.timestamp).toBeDefined();
    expect(embed.fields).toEqual([
      { name: "Author", value: "<@u1>", inline: true },
      { name: "Channel", value: "<#c1>", inline: true },
      { name: "Content", value: "buy now" },
      { name: "Reactions", value: "👍 (2)" },
      { name: "Attachments", value: "https://cdn.example/a.png\nhttps://cdn.example/b.png" },
      { name: "Stickers", value: "wave" },
      {
        name: "ID",
        value: [
          "```js",
          "User: u1",
          "Message: m1",
          "Channel: c1",
          "Guild: g1",
          "Created Timestamp: 1700000000000",
          "Edited Timestamp: 1700000005000",
          "Nonce: n1",
          "",
          "```",
        ].join("\n"),
      },
    ]);
  });

  it("describes a message that was never cached, without a guild ID or an author", () => {
    const embed = buildMessageDeletedEmbed(fakeMessage({ content: null, author: null, guildId: null })).toJSON();

    expect(embed.author).toEqual({ name: "Unknown" });
    expect(embed.fields![0]).toEqual({ name: "Author", value: "<@?>", inline: true });
    expect(embed.fields![2]).toEqual({ name: "Content", value: "*Content not cached*" });
    expect(embed.fields![3]).toEqual({ name: "Reactions", value: "No reactions" });
    expect(embed.fields![4]).toEqual({ name: "Attachments", value: "No attachments" });
    expect(embed.fields![5]).toEqual({ name: "Stickers", value: "No stickers" });
    const idBlock = embed.fields![6].value;
    expect(idBlock).toContain("User: Unknown");
    expect(idBlock).toContain("Guild: Unknown");
  });

  it("cuts long content to the field limit and marks empty content", () => {
    const long = buildMessageDeletedEmbed(fakeMessage({ content: "x".repeat(2000) })).toJSON();
    const empty = buildMessageDeletedEmbed(fakeMessage({ content: "" })).toJSON();

    expect(long.fields![2].value).toBe("x".repeat(1024));
    expect(empty.fields![2].value).toBe("*Empty*");
  });
});
