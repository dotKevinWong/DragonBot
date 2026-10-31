import { describe, it, expect, vi } from "vitest";
import { Collection, type Client } from "discord.js";
import type { Logger } from "pino";
import { BirthdayChecker } from "../../src/lib/birthday-checker.js";
import type { BirthdayService } from "../../src/services/birthday.service.js";
import type { GuildService } from "../../src/services/guild.service.js";

/** Member u1 of server g1 has a birthday today. g1's birthday channel c1 resolves to a text channel in `channelGuildId`. */
function setup(channelGuildId: string) {
  const send = vi.fn(async (_content: unknown) => ({}));
  const fetch = vi.fn(async (_channelId: string) => ({
    id: "c1",
    guildId: channelGuildId,
    isDMBased: () => false,
    isTextBased: () => true,
    send,
  }));
  const member = { id: "u1", roles: { add: vi.fn(async () => undefined) } };
  const discordGuild = { id: "g1", members: { fetch: vi.fn(async () => new Collection([["u1", member]])) } };
  const client = {
    channels: { fetch },
    guilds: { cache: new Collection([["g1", discordGuild]]) },
  } as unknown as Client;
  const birthdayService = {
    getTodaysBirthdays: vi.fn(async () => [{ discordId: "u1", birthYear: null }]),
    buildAnnouncementMessage: vi.fn(() => "Happy birthday <@u1>!"),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const logger = { ...log, child: vi.fn(() => log) } as unknown as Logger;
  const checker = new BirthdayChecker(
    client,
    birthdayService as unknown as BirthdayService,
    {} as GuildService,
    logger,
  );
  return { checker, send, log, logger };
}

describe("BirthdayChecker.announceForGuild", () => {
  it("never announces in a birthday channel in another server", async () => {
    const { checker, send, log, logger } = setup("g2");

    await checker["announceForGuild"]("g1", "c1", null, null, 10, 30, logger);

    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", channelId: "c1", channelGuildId: "g2" }),
      expect.any(String),
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it("announces in a birthday channel in the same server", async () => {
    const { checker, send, log, logger } = setup("g1");

    await checker["announceForGuild"]("g1", "c1", null, null, 10, 30, logger);

    expect(send).toHaveBeenCalledWith("Happy birthday <@u1>!");
    expect(log.error).not.toHaveBeenCalled();
  });
});
