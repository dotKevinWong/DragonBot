import { describe, expect, it, vi } from "vitest";
import type { EmbedBuilder, Message, PartialMessage } from "discord.js";
import event from "../../src/events/message-update.js";
import type { BotContext } from "../../src/types/context.js";

/** A cached message m1 by u1 in channel c1 of g1, with `overrides` applied. */
function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    partial: false,
    id: "m1",
    guild: { id: "g1" },
    content: "after",
    author: { id: "u1", bot: false, tag: "u1#0001", displayAvatarURL: () => "https://cdn.example/u1.png" },
    channel: { id: "c1" },
    client: {},
    createdTimestamp: 1_700_000_000_000,
    editedTimestamp: 1_700_000_100_000,
    nonce: null,
    ...overrides,
  } as unknown as Message;
}

/** An uncached new message, whose fetch resolves to `fetched` or fails. */
function partialMessage(fetched: Message | Error, overrides: Record<string, unknown> = {}) {
  return {
    partial: true,
    id: "m1",
    guild: { id: "g1" },
    author: null,
    content: null,
    fetch: vi.fn(async () => {
      if (fetched instanceof Error) throw fetched;
      return fetched;
    }),
    ...overrides,
  } as unknown as PartialMessage & { fetch: ReturnType<typeof vi.fn> };
}

const uncachedOld = { partial: true, content: null } as unknown as PartialMessage;

function setup(shouldLog = true) {
  const logging = {
    shouldLog: vi.fn(async (_guildId: string, _type: string) => shouldLog),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
  const ctx = { logger: {}, services: { logging } } as unknown as BotContext;
  return { logging, ctx };
}

function fieldsOf(logging: ReturnType<typeof setup>["logging"]) {
  return logging.sendLogEmbed.mock.calls.map(([, embed]) => embed.toJSON().fields);
}

describe("messageUpdate event", () => {
  it("logs an edit of a cached message with the old and new content", async () => {
    const { logging, ctx } = setup();

    await event.execute(fakeMessage({ content: "before" }), fakeMessage(), ctx);

    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "message_edit");
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
    expect(logging.sendLogEmbed.mock.calls[0][1].toJSON().title).toBe("Message Edited");
    expect(fieldsOf(logging)[0]).toEqual(
      expect.arrayContaining([
        { name: "Old Content", value: "before" },
        { name: "New Content", value: "after" },
      ]),
    );
  });

  it("logs nothing when the content didn't change", async () => {
    const { logging, ctx } = setup();

    await event.execute(fakeMessage(), fakeMessage(), ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("fetches an uncached new message and logs its edit", async () => {
    const { logging, ctx } = setup();
    const newMessage = partialMessage(fakeMessage());

    await event.execute(uncachedOld, newMessage, ctx);

    expect(newMessage.fetch).toHaveBeenCalledTimes(1);
    expect(fieldsOf(logging)[0]).toEqual(
      expect.arrayContaining([
        { name: "Old Content", value: "*Not cached*" },
        { name: "New Content", value: "after" },
      ]),
    );
  });

  it("doesn't fetch an uncached message when edits aren't logged", async () => {
    const { logging, ctx } = setup(false);
    const newMessage = partialMessage(fakeMessage());

    await event.execute(uncachedOld, newMessage, ctx);

    expect(newMessage.fetch).toHaveBeenCalledTimes(0);
    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "message_edit");
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("logs nothing for an uncached old message that was never edited", async () => {
    // Embed resolution and other non-content updates leave editedTimestamp null.
    const { logging, ctx } = setup();

    await event.execute(uncachedOld, fakeMessage({ editedTimestamp: null }), ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("logs nothing when fetching the uncached message fails", async () => {
    const { logging, ctx } = setup();
    const newMessage = partialMessage(new Error("Unknown Message"));

    await event.execute(uncachedOld, newMessage, ctx);

    expect(newMessage.fetch).toHaveBeenCalledTimes(1);
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("ignores a bot's edit before anything else", async () => {
    const { logging, ctx } = setup();
    const botAuthor = { id: "b1", bot: true, tag: "bot#0001", displayAvatarURL: () => "https://cdn.example/b1.png" };

    await event.execute(fakeMessage({ content: "before" }), fakeMessage({ author: botAuthor }), ctx);

    expect(logging.shouldLog).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("still logs an uncached bot message, whose author is unknown until fetched", async () => {
    // The bot check runs before the fetch, on purpose: today a bot's uncached message passes it.
    const { logging, ctx } = setup();
    const botAuthor = { id: "b1", bot: true, tag: "bot#0001", displayAvatarURL: () => "https://cdn.example/b1.png" };
    const newMessage = partialMessage(fakeMessage({ author: botAuthor }));

    await event.execute(uncachedOld, newMessage, ctx);

    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
  });

  it("ignores a message outside a server", async () => {
    const { logging, ctx } = setup();

    await event.execute(fakeMessage({ guild: null }), fakeMessage({ guild: null }), ctx);

    expect(logging.shouldLog).not.toHaveBeenCalled();
  });
});
