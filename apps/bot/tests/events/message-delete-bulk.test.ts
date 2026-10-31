import { describe, it, expect, vi } from "vitest";
import { Collection, type GuildTextBasedChannel, type Message } from "discord.js";
import event from "../../src/events/message-delete-bulk.js";
import type { BotContext } from "../../src/types/context.js";

/** The deleted messages, keyed by ID as discord.js keys them. With Partials.Message, an uncached one is a partial. */
function deletedMessages(ids: string[]) {
  return new Collection(ids.map((id): [string, Message<true>] => [id, { id, partial: true } as unknown as Message<true>]));
}

const channel = { id: "trap", guildId: "g1", guild: { id: "g1" } } as unknown as GuildTextBasedChannel;

/** The cached row stores warningMessageId as the honeypot warning. Only the settings read, the log sink and the warning sync are fakes. */
function setup(warningMessageId: string | null) {
  const guild = {
    getSettings: vi.fn().mockResolvedValue({ guildId: "g1", honeypotWarningMessageId: warningMessageId }),
  };
  const logging = { shouldLog: vi.fn().mockResolvedValue(true), sendLogEmbed: vi.fn().mockResolvedValue(undefined) };
  const honeypotWarning = { sync: vi.fn().mockResolvedValue(undefined) };
  const ctx = { logger: { warn: vi.fn() }, services: { guild, logging }, honeypotWarning } as unknown as BotContext;
  return { ctx, guild, logging, honeypotWarning };
}

describe("messageDeleteBulk event", () => {
  it("resyncs the warning when a bulk delete takes it", async () => {
    // A purge: Discord sends one bulk delete for the lot, and no messageDelete for the warning.
    const { ctx, guild, logging, honeypotWarning } = setup("w1");

    await event.execute(deletedMessages(["m1", "w1", "m2"]), channel, ctx);

    expect(guild.getSettings).toHaveBeenCalledWith("g1");
    expect(honeypotWarning.sync).toHaveBeenCalledTimes(1);
    // The sync takes the warning as gone, whatever a fetch of it would say.
    expect(honeypotWarning.sync).toHaveBeenCalledWith("g1", { goneMessageId: "w1" });
    // Bulk deletes aren't logged.
    expect(logging.shouldLog).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("ignores a bulk delete without the warning", async () => {
    // As in the honeypot sweep's own bulk delete: only the removed account's messages.
    const { ctx, logging, honeypotWarning } = setup("w1");

    await event.execute(deletedMessages(["m1", "m2"]), channel, ctx);

    expect(honeypotWarning.sync).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("ignores a bulk delete when no warning is stored", async () => {
    // The same purge as above, but the server stores no warning, so none of these messages is one.
    const { ctx, logging, honeypotWarning } = setup(null);

    await event.execute(deletedMessages(["m1", "w1", "m2"]), channel, ctx);

    expect(honeypotWarning.sync).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });
});
