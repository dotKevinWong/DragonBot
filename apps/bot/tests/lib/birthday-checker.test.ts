import { describe, it, expect, vi, afterEach } from "vitest";
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

interface CheckGuild {
  guildId: string;
  isBirthdayEnabled: boolean;
  birthdayChannelId: string | null;
  birthdayRoleId: string | null;
  birthdayMessage: string | null;
  birthdayTimezone: string | null;
  lastBirthdayCheckDate: string | null;
}

function checkGuild(guildId: string, overrides: Partial<CheckGuild> = {}): CheckGuild {
  return {
    guildId,
    isBirthdayEnabled: true,
    birthdayChannelId: `c-${guildId}`,
    birthdayRoleId: null,
    birthdayMessage: null,
    birthdayTimezone: "America/New_York",
    lastBirthdayCheckDate: null,
    ...overrides,
  };
}

/**
 * Every listed guild is in Discord's cache, with members u1 and u2 and a text birthday channel `c-<guildId>`.
 * `events` records the side effects in order.
 */
function setupCheck(guilds: CheckGuild[], birthdays: Array<{ discordId: string; birthYear: number | null }>) {
  const events: string[] = [];
  const sends: Array<[string, unknown]> = [];
  const discordGuilds = new Collection(
    guilds.map((g) => {
      const members = new Collection(
        ["u1", "u2"].map((id) => [id, { id, roles: { add: vi.fn(async () => undefined) } }] as const),
      );
      return [
        g.guildId,
        {
          id: g.guildId,
          members: {
            cache: new Collection<string, unknown>(),
            fetch: vi.fn(async () => {
              events.push(`members.fetch ${g.guildId}`);
              return members;
            }),
          },
        },
      ] as const;
    }),
  );
  const client = {
    channels: {
      fetch: vi.fn(async (channelId: string) => ({
        id: channelId,
        guildId: channelId.slice(2),
        isDMBased: () => false,
        isTextBased: () => true,
        send: vi.fn(async (content: unknown) => {
          sends.push([channelId, content]);
          return {};
        }),
      })),
    },
    guilds: { cache: discordGuilds },
  } as unknown as Client;
  const birthdayService = {
    getTodaysBirthdays: vi.fn(async (month: number, day: number) => {
      events.push(`getTodaysBirthdays ${month}-${day}`);
      return birthdays;
    }),
    buildAnnouncementMessage: vi.fn((userId: string) => `Happy birthday <@${userId}>!`),
  };
  const guildService = {
    getAllCached: vi.fn(() => guilds),
    updateSettings: vi.fn(async (guildId: string, settings: unknown) => {
      events.push(`updateSettings ${guildId} ${JSON.stringify(settings)}`);
      return null;
    }),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  log.child.mockReturnValue(log);
  const checker = new BirthdayChecker(
    client,
    birthdayService as unknown as BirthdayService,
    guildService as unknown as GuildService,
    log as unknown as Logger,
  );
  return { checker, birthdayService, guildService, log, events, sends };
}

describe("BirthdayChecker.check", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads today's birthdays once for guilds on the same date, and announces in each in order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T15:00:00Z")); // 11 AM in New York
    const { checker, birthdayService, events, sends, log } = setupCheck(
      [checkGuild("g1"), checkGuild("g2")],
      [{ discordId: "u1", birthYear: null }, { discordId: "u2", birthYear: 2000 }],
    );

    await checker.check();

    expect(birthdayService.getTodaysBirthdays).toHaveBeenCalledTimes(1);
    expect(birthdayService.getTodaysBirthdays).toHaveBeenCalledWith(6, 15);
    expect(events).toEqual([
      "getTodaysBirthdays 6-15",
      "members.fetch g1",
      'updateSettings g1 {"lastBirthdayCheckDate":"6-15"}',
      "members.fetch g2",
      'updateSettings g2 {"lastBirthdayCheckDate":"6-15"}',
    ]);
    expect(sends).toEqual([
      ["c-g1", "Happy birthday <@u1>!"],
      ["c-g1", "Happy birthday <@u2>!"],
      ["c-g2", "Happy birthday <@u1>!"],
      ["c-g2", "Happy birthday <@u2>!"],
    ]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("reads once per distinct date when guilds' time zones are on different dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T20:00:00Z")); // 4 PM June 15 in New York, 10 AM June 16 in Kiritimati
    const { checker, birthdayService } = setupCheck(
      [
        checkGuild("g1"),
        checkGuild("g2", { birthdayTimezone: "Pacific/Kiritimati" }),
        checkGuild("g3", { birthdayTimezone: null }),
        checkGuild("g4", { birthdayTimezone: "Pacific/Kiritimati" }),
      ],
      [{ discordId: "u1", birthYear: null }],
    );

    await checker.check();

    expect(birthdayService.getTodaysBirthdays.mock.calls).toEqual([
      [6, 15],
      [6, 16],
    ]);
  });

  it("logs a failed read, still records the check, and retries the read for the next guild", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T15:00:00Z"));
    const { checker, birthdayService, guildService, log, sends } = setupCheck(
      [checkGuild("g1"), checkGuild("g2")],
      [{ discordId: "u1", birthYear: null }],
    );
    birthdayService.getTodaysBirthdays.mockRejectedValueOnce(new Error("db down"));

    await checker.check();

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith({ err: expect.any(Error) }, "Failed to announce birthdays for guild");
    expect(guildService.updateSettings).toHaveBeenCalledTimes(2);
    expect(birthdayService.getTodaysBirthdays).toHaveBeenCalledTimes(2);
    expect(sends).toEqual([["c-g2", "Happy birthday <@u1>!"]]);
  });

  it("doesn't read birthdays for a guild before 9 AM, one already checked today, or one turned off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T11:00:00Z")); // 7 AM in New York
    const { checker, birthdayService, guildService } = setupCheck(
      [
        checkGuild("g1"),
        checkGuild("g2", { birthdayTimezone: "UTC", lastBirthdayCheckDate: "6-15" }),
        checkGuild("g3", { birthdayTimezone: "UTC", isBirthdayEnabled: false }),
        checkGuild("g4", { birthdayTimezone: "UTC", birthdayChannelId: null }),
      ],
      [{ discordId: "u1", birthYear: null }],
    );

    await checker.check();

    expect(birthdayService.getTodaysBirthdays).not.toHaveBeenCalled();
    expect(guildService.updateSettings).not.toHaveBeenCalled();
  });

  it("records the check without fetching members when nobody has a birthday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T15:00:00Z"));
    const { checker, events } = setupCheck([checkGuild("g1"), checkGuild("g2")], []);

    await checker.check();

    expect(events).toEqual([
      "getTodaysBirthdays 6-15",
      'updateSettings g1 {"lastBirthdayCheckDate":"6-15"}',
      'updateSettings g2 {"lastBirthdayCheckDate":"6-15"}',
    ]);
  });
});
