import { describe, it, expect, vi, afterEach } from "vitest";
import { BirthdayService } from "../../src/services/birthday.service.js";
import type { BirthdayRepository, BirthdayRow } from "../../src/repositories/birthday.repository.js";

function b(discordId: string, birthMonth: number, birthDay: number, birthYear: number | null = null): BirthdayRow {
  return { discordId, birthMonth, birthDay, birthYear };
}

function setup(rows: BirthdayRow[]) {
  const repo = { getAllBirthdays: vi.fn(async () => rows) };
  return new BirthdayService(repo as unknown as BirthdayRepository);
}

/** Local time, as the service uses local-time Date getters. */
function at(year: number, monthIndex: number, day: number, hour = 12) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, monthIndex, day, hour));
}

describe("BirthdayService.getUpcomingBirthdays", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts days to today's, tomorrow's and yesterday's birthdays", async () => {
    at(2026, 5, 15); // June 15, 2026
    const service = setup([b("today", 6, 15, 2000), b("tomorrow", 6, 16), b("yesterday", 6, 14)]);
    const result = await service.getUpcomingBirthdays(["today", "tomorrow", "yesterday"], 15);
    expect(result).toEqual([
      { discordId: "today", month: 6, day: 15, year: 2000, daysUntil: 0 },
      { discordId: "tomorrow", month: 6, day: 16, year: null, daysUntil: 1 },
      { discordId: "yesterday", month: 6, day: 14, year: null, daysUntil: 364 },
    ]);
  });

  it("handles the year end", async () => {
    at(2026, 11, 31); // Dec 31, 2026
    const service = setup([b("jan1", 1, 1), b("dec31", 12, 31)]);
    expect(await service.getUpcomingBirthdays(["jan1", "dec31"], 15)).toEqual([
      { discordId: "dec31", month: 12, day: 31, year: null, daysUntil: 0 },
      { discordId: "jan1", month: 1, day: 1, year: null, daysUntil: 1 },
    ]);

    at(2027, 0, 1); // Jan 1, 2027
    expect(await service.getUpcomingBirthdays(["jan1", "dec31"], 15)).toEqual([
      { discordId: "jan1", month: 1, day: 1, year: null, daysUntil: 0 },
      { discordId: "dec31", month: 12, day: 31, year: null, daysUntil: 364 },
    ]);
  });

  it("rolls Feb 29 to Mar 1 in a non-leap year", async () => {
    const service = setup([b("leap", 2, 29)]);
    at(2027, 1, 28); // Feb 28, 2027
    expect((await service.getUpcomingBirthdays(["leap"], 15))[0]!.daysUntil).toBe(1);
    at(2027, 2, 1); // Mar 1, 2027: next is Feb 29, 2028
    expect((await service.getUpcomingBirthdays(["leap"], 15))[0]!.daysUntil).toBe(365);
  });

  it("keeps only members, sorts ascending, keeps repository order for ties, and truncates to count", async () => {
    at(2026, 5, 15);
    const service = setup([
      b("far", 12, 1),
      b("tieB", 7, 1),
      b("stranger", 6, 16),
      b("tieA", 7, 1),
      b("near", 6, 20),
    ]);
    const members = ["far", "tieB", "tieA", "near"];
    expect((await service.getUpcomingBirthdays(members, 15)).map((r) => r.discordId)).toEqual([
      "near",
      "tieB",
      "tieA",
      "far",
    ]);
    expect((await service.getUpcomingBirthdays(members, 2)).map((r) => r.discordId)).toEqual(["near", "tieB"]);
  });
});

describe("BirthdayService.formatBirthday", () => {
  it("doesn't pad the day, and falls back to Unknown", () => {
    const service = setup([]);
    expect(service.formatBirthday(3, 5, 2001)).toBe("March 5, 2001");
    expect(service.formatBirthday(12, 25, null)).toBe("December 25");
    expect(service.formatBirthday(13, 1, null)).toBe("Unknown 1");
  });
});

describe("BirthdayService.setBirthday validation", () => {
  it("names the month in the day-range error", async () => {
    const service = setup([]);
    await expect(service.setBirthday("u1", 2, 30, null)).rejects.toThrow("Day must be between 1 and 29 for February.");
    await expect(service.setBirthday("u1", 13, 1, null)).rejects.toThrow("Month must be between 1 and 12.");
  });
});
