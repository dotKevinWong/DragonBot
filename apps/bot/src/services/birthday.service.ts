import type { BirthdayRepository, BirthdayRow } from "../repositories/birthday.repository.js";
import { AppError, ErrorCode } from "../types/errors.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export interface UpcomingBirthday {
  discordId: string;
  month: number;
  day: number;
  year: number | null;
  daysUntil: number;
}

export class BirthdayService {
  constructor(private repo: BirthdayRepository) {}

  async setBirthday(discordId: string, month: number, day: number, year: number | null): Promise<void> {
    if (month < 1 || month > 12) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Month must be between 1 and 12.");
    }
    const maxDay = DAYS_IN_MONTH[month - 1]!;
    if (day < 1 || day > maxDay) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Day must be between 1 and ${maxDay} for ${MONTH_NAMES[month - 1]}.`);
    }
    if (year !== null) {
      const currentYear = new Date().getFullYear();
      if (year < 1900 || year > currentYear) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `Year must be between 1900 and ${currentYear}.`);
      }
    }
    await this.repo.setBirthday(discordId, month, day, year);
  }

  async removeBirthday(discordId: string): Promise<void> {
    await this.repo.removeBirthday(discordId);
  }

  async getBirthday(discordId: string): Promise<BirthdayRow | null> {
    return this.repo.getUserBirthday(discordId);
  }

  async getTodaysBirthdays(month: number, day: number): Promise<BirthdayRow[]> {
    return this.repo.getBirthdaysByDate(month, day);
  }

  async getUpcomingBirthdays(memberIds: string[], count: number): Promise<UpcomingBirthday[]> {
    const allBirthdays = await this.repo.getAllBirthdays();

    // Filter to only members in the guild
    const memberSet = new Set(memberIds);
    const guildBirthdays = allBirthdays.filter((b) => memberSet.has(b.discordId));

    const now = new Date();
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();

    // Calculate days until each birthday
    const withDays: UpcomingBirthday[] = guildBirthdays.map((b) => {
      const thisYear = now.getFullYear();
      // Try this year first, then next year
      let targetDate = new Date(thisYear, b.birthMonth - 1, b.birthDay);
      if (
        b.birthMonth < todayMonth ||
        (b.birthMonth === todayMonth && b.birthDay < todayDay)
      ) {
        targetDate = new Date(thisYear + 1, b.birthMonth - 1, b.birthDay);
      }
      const diffMs = targetDate.getTime() - new Date(thisYear, todayMonth - 1, todayDay).getTime();
      const daysUntil = Math.round(diffMs / (1000 * 60 * 60 * 24));

      return {
        discordId: b.discordId,
        month: b.birthMonth,
        day: b.birthDay,
        year: b.birthYear,
        daysUntil,
      };
    });

    // Sort by daysUntil ascending, take the first N
    withDays.sort((a, b) => a.daysUntil - b.daysUntil);
    return withDays.slice(0, count);
  }

  formatBirthday(month: number, day: number, year: number | null): string {
    const monthName = MONTH_NAMES[month - 1] ?? "Unknown";
    if (year) {
      return `${monthName} ${day}, ${year}`;
    }
    return `${monthName} ${day}`;
  }

  formatAge(birthYear: number | null): string | null {
    if (birthYear === null) return null;
    const age = new Date().getFullYear() - birthYear;
    if (age < 0 || age > 150) return null;
    return ordinal(age);
  }

  buildAnnouncementMessage(
    userId: string,
    birthYear: number | null,
    customMessage: string | null,
  ): string {
    const age = this.formatAge(birthYear);

    if (customMessage) {
      return customMessage
        .replace(/\{user}/g, `<@${userId}>`)
        .replace(/\{age}/g, age ?? "")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (age) {
      return `Happy ${age} birthday <@${userId}>! 🎂🎉`;
    }
    return `Happy birthday <@${userId}>! 🎂🎉`;
  }
}
