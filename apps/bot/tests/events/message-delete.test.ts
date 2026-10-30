import { describe, it, expect, vi } from "vitest";
import { Collection, type EmbedBuilder, type Message } from "discord.js";
import event from "../../src/events/message-delete.js";
import { HoneypotService } from "../../src/services/honeypot.service.js";
import type { BotContext } from "../../src/types/context.js";

function fakeMessage(overrides: Record<string, unknown> = {}): Message {
  return {
    id: "m1",
    guildId: "g1",
    guild: { id: "g1" },
    content: "hi",
    author: { id: "u1", bot: false, tag: "member#0001", displayAvatarURL: () => "https://cdn.example/u1.png" },
    channel: { id: "c1" },
    attachments: new Collection(),
    reactions: { cache: new Collection() },
    stickers: new Collection(),
    createdTimestamp: 1_700_000_000_000,
    editedTimestamp: null,
    nonce: null,
    client: { name: "fake client" },
    ...overrides,
  } as unknown as Message;
}

/** The honeypot is the real in-memory service. Only the log sink, the settings read and the warning sync are fakes. */
function setup(options: { shouldLog?: boolean; warningMessageId?: string } = {}) {
  const honeypot = new HoneypotService();
  const logging = {
    shouldLog: vi.fn().mockResolvedValue(options.shouldLog ?? true),
    sendLogEmbed: vi.fn().mockResolvedValue(undefined),
  };
  // A server with no stored honeypot warning, unless the test gives one.
  const guild = {
    getSettings: vi.fn().mockResolvedValue({ guildId: "g1", honeypotWarningMessageId: options.warningMessageId ?? null }),
  };
  const honeypotWarning = { sync: vi.fn().mockResolvedValue(undefined) };
  const ctx = { logger: { warn: vi.fn() }, services: { honeypot, logging, guild }, honeypotWarning } as unknown as BotContext;
  return { ctx, honeypot, logging, guild, honeypotWarning };
}

/** What a finished honeypot removal leaves behind: a confirmed action record for the account. */
function removeAccount(honeypot: HoneypotService, guildId: string, userId: string) {
  const started = honeypot.beginCase(guildId, userId, Date.now());
  if (started.kind !== "start") throw new Error("expected a new case");
  honeypot.recordAction(guildId, userId, started.caseId, {
    action: "ban",
    reason: "[Honeypot] posted in #trap (msg 1)",
    channelId: "trap",
  });
  honeypot.confirmAction(guildId, userId, started.caseId);
  honeypot.endCase(guildId, userId, started.caseId);
}

describe("messageDelete event", () => {
  it("does not log a message the honeypot deleted", async () => {
    const { ctx, honeypot, logging } = setup();
    honeypot.markOwnDeletion("m1");

    await event.execute(fakeMessage(), ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("does not log messages from an account the honeypot just removed", async () => {
    const { ctx, honeypot, logging } = setup();
    removeAccount(honeypot, "g1", "u1");

    await event.execute(fakeMessage({ id: "m2" }), ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("still logs ordinary deletions", async () => {
    const message = fakeMessage();
    const { ctx, honeypot, logging } = setup();
    // The honeypot has handled other messages and another account, but none of this one.
    honeypot.markOwnDeletion("other-message");
    removeAccount(honeypot, "g1", "other-account");

    await event.execute(message, ctx);

    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "message_delete");
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
    const [guildId, embed, client, logger] = logging.sendLogEmbed.mock.calls[0] as [string, EmbedBuilder, unknown, unknown];
    expect(guildId).toBe("g1");
    expect(embed.toJSON().title).toBe("Message Deleted");
    expect(client).toBe(message.client);
    expect(logger).toBe(ctx.logger);
  });

  it("takes the skip entry even when the author was also just removed", async () => {
    const { ctx, honeypot, logging } = setup();
    honeypot.markOwnDeletion("m1");
    removeAccount(honeypot, "g1", "u1");

    await event.execute(fakeMessage(), ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    expect(honeypot.consumeOwnDeletion("m1")).toBe(false);
  });

  it("logs nothing when the server doesn't log message deletions", async () => {
    const { ctx, logging } = setup({ shouldLog: false });

    await event.execute(fakeMessage(), ctx);

    expect(logging.shouldLog).toHaveBeenCalledWith("g1", "message_delete");
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("logs a deletion whose author and content were never cached", async () => {
    const { ctx, logging } = setup();

    await event.execute(fakeMessage({ author: null, content: null }), ctx);

    // With no author there is no account to look up, and nothing to crash on.
    expect(logging.sendLogEmbed).toHaveBeenCalledTimes(1);
    const embed = (logging.sendLogEmbed.mock.calls[0] as [string, EmbedBuilder])[1].toJSON();
    expect(embed.fields!.find((f) => f.name === "Content")!.value).toBe("*Content not cached*");
  });

  it("ignores deletions outside a server", async () => {
    const { ctx, logging } = setup();

    await event.execute(fakeMessage({ guild: null, guildId: null }), ctx);

    expect(logging.shouldLog).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("ignores messages from bots", async () => {
    const { ctx, logging } = setup();

    await event.execute(fakeMessage({ author: { id: "bot1", bot: true } }), ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("takes the honeypot's skip entry before ignoring a bot's message", async () => {
    const { ctx, honeypot, logging } = setup();
    honeypot.markOwnDeletion("m1");

    await event.execute(fakeMessage({ author: { id: "bot1", bot: true } }), ctx);

    // DragonBot's own warning is authored by the bot, so its skip entry has to be taken before the bot check.
    expect(honeypot.consumeOwnDeletion("m1")).toBe(false);
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("reposts when the stored warning is deleted", async () => {
    const deletions = [
      // Still cached: DragonBot wrote it, so this has to be caught before the bot check.
      fakeMessage({ id: "w1", author: { id: "bot-self", bot: true } }),
      // Not cached, for example after a restart: Discord only sends the ID.
      fakeMessage({ id: "w1", author: null, content: null }),
    ];
    for (const message of deletions) {
      const { ctx, logging, honeypotWarning } = setup({ warningMessageId: "w1" });

      await event.execute(message, ctx);

      expect(honeypotWarning.sync).toHaveBeenCalledTimes(1);
      expect(honeypotWarning.sync).toHaveBeenCalledWith("g1");
      expect(logging.shouldLog).not.toHaveBeenCalled();
      expect(logging.sendLogEmbed).not.toHaveBeenCalled();
    }
  });

  it("does not log the bot's own warning deletion", async () => {
    // DragonBot is removing its old warning, whose IDs are still stored until the removal finishes.
    const { ctx, honeypot, logging, honeypotWarning } = setup({ warningMessageId: "w1" });
    honeypot.markOwnDeletion("w1");

    await event.execute(fakeMessage({ id: "w1", author: null, content: null }), ctx);

    expect(honeypotWarning.sync).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });
});
