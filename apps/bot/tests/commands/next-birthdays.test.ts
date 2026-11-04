import { describe, it, expect, vi, afterEach } from "vitest";
import type { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import command from "../../src/commands/next-birthdays.js";
import type { BotContext } from "../../src/types/context.js";
import type { BirthdayService } from "../../src/services/birthday.service.js";

type Upcoming = Awaited<ReturnType<BirthdayService["getUpcomingBirthdays"]>>;

function setup(options: {
  upcoming?: Upcoming;
  settings?: unknown;
  inGuild?: boolean;
  fetchError?: Error;
} = {}) {
  const members = new Map([
    ["u1", { displayName: "Alice" }],
    ["u2", { displayName: "Bob" }],
    ["u3", { displayName: "Cara" }],
  ]);
  const editReply = vi.fn(async (_reply: { embeds: EmbedBuilder[] }) => undefined);
  const inGuild = options.inGuild ?? true;
  const interaction = {
    guildId: inGuild ? "g1" : null,
    guild: inGuild
      ? {
          members: {
            fetch: vi.fn(async () => {
              if (options.fetchError) throw options.fetchError;
              return members;
            }),
          },
        }
      : null,
    editReply,
  } as unknown as ChatInputCommandInteraction;
  const getUpcomingBirthdays = vi.fn(async (_ids: string[], _count: number) => options.upcoming ?? []);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    logger,
    services: {
      guild: { getSettings: vi.fn(async () => ("settings" in options ? options.settings : { isBirthdayEnabled: true })) },
      birthday: { getUpcomingBirthdays },
    },
  } as unknown as BotContext;
  return { interaction, ctx, editReply, getUpcomingBirthdays, logger };
}

function reply(editReply: ReturnType<typeof setup>["editReply"]) {
  return editReply.mock.calls[0]![0].embeds[0]!.toJSON();
}

describe("/next-birthdays", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups by date with zero-padded day labels, the right year, and display names", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12)); // June 15, 2026, local time
    const { interaction, ctx, editReply, getUpcomingBirthdays } = setup({
      upcoming: [
        { discordId: "u1", month: 6, day: 15, year: null, daysUntil: 0 },
        { discordId: "u2", month: 6, day: 15, year: 1999, daysUntil: 0 },
        { discordId: "gone", month: 7, day: 4, year: null, daysUntil: 19 },
        { discordId: "u3", month: 3, day: 5, year: null, daysUntil: 263 },
      ],
    });

    await command.execute(interaction, ctx);

    expect(getUpcomingBirthdays).toHaveBeenCalledWith(["u1", "u2", "u3"], 15);
    expect(reply(editReply)).toEqual({
      title: "Upcoming birthdays",
      description: [
        "**June 15, 2026**",
        "> <@u1> (Alice)",
        "> <@u2> (Bob)",
        "**July 04, 2026**",
        "> <@gone>",
        "**March 05, 2027**",
        "> <@u3> (Cara)",
      ].join("\n"),
      color: 0xffd700,
      footer: { text: "Set yours with /birthday set" },
    });
  });

  it("labels Feb 29 in a non-leap year with this year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 1, 28, 12)); // Feb 28, 2027
    const { interaction, ctx, editReply } = setup({
      upcoming: [{ discordId: "u1", month: 2, day: 29, year: null, daysUntil: 1 }],
    });
    await command.execute(interaction, ctx);
    expect(reply(editReply).description).toBe("**February 29, 2027**\n> <@u1> (Alice)");
  });

  it("labels a Jan 1 birthday on Dec 31 with next year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 12));
    const { interaction, ctx, editReply } = setup({
      upcoming: [
        { discordId: "u1", month: 12, day: 31, year: null, daysUntil: 0 },
        { discordId: "u2", month: 1, day: 1, year: null, daysUntil: 1 },
      ],
    });
    await command.execute(interaction, ctx);
    expect(reply(editReply).description).toBe("**December 31, 2026**\n> <@u1> (Alice)\n**January 01, 2027**\n> <@u2> (Bob)");
  });

  it("says so when nobody has a birthday", async () => {
    const { interaction, ctx, editReply } = setup({ upcoming: [] });
    await command.execute(interaction, ctx);
    expect(reply(editReply)).toEqual({
      title: "Upcoming birthdays",
      description: "No birthdays registered in this server yet.",
      color: 0xffd700,
    });
  });

  it("refuses outside a server and when birthdays are off", async () => {
    const outside = setup({ inGuild: false });
    await command.execute(outside.interaction, outside.ctx);
    expect(reply(outside.editReply)).toEqual({ color: 0xff0000, description: "This command can only be used in a server." });

    for (const settings of [null, { isBirthdayEnabled: false }]) {
      const off = setup({ settings });
      await command.execute(off.interaction, off.ctx);
      expect(reply(off.editReply)).toEqual({ color: 0xff0000, description: "Birthdays are not enabled in this server." });
      expect(off.getUpcomingBirthdays).not.toHaveBeenCalled();
    }
  });

  it("logs and reports an error", async () => {
    const err = new Error("discord down");
    const { interaction, ctx, editReply, logger } = setup({ fetchError: err });
    await command.execute(interaction, ctx);
    expect(logger.error).toHaveBeenCalledWith({ err, command: "next-birthdays" }, "Unhandled error");
    expect(reply(editReply)).toEqual({ color: 0xff0000, description: "Something went wrong." });
  });
});
