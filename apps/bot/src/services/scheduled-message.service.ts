import { ScheduledMessageRepository } from "../repositories/scheduled-message.repository.js";
import { AppError, ErrorCode } from "../types/errors.js";

/** Parse human-friendly interval strings into cron expressions */
export function parseIntervalToCron(input: string): string {
  const trimmed = input.trim().toLowerCase();

  // Already a cron expression (5 fields separated by spaces)
  if (/^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+$/.test(trimmed)) {
    return trimmed;
  }

  // "every X minutes"
  const everyMinMatch = trimmed.match(/^every\s+(\d+)\s+min(ute)?s?$/);
  if (everyMinMatch) return `*/${everyMinMatch[1]} * * * *`;

  // "every minute"
  if (trimmed === "every minute") return "* * * * *";

  // "every hour"
  if (trimmed === "every hour" || trimmed === "hourly") return "0 * * * *";

  // "every X hours"
  const everyHourMatch = trimmed.match(/^every\s+(\d+)\s+hours?$/);
  if (everyHourMatch) return `0 */${everyHourMatch[1]} * * *`;

  // "daily at Xam/pm"
  const dailyMatch = trimmed.match(/^daily\s+at\s+(\d{1,2})(:\d{2})?\s*(am|pm)?$/);
  if (dailyMatch) {
    let hour = parseInt(dailyMatch[1]);
    const minute = dailyMatch[2] ? parseInt(dailyMatch[2].slice(1)) : 0;
    if (dailyMatch[3] === "pm" && hour < 12) hour += 12;
    if (dailyMatch[3] === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * *`;
  }

  // "weekdays at Xam/pm"
  const weekdayMatch = trimmed.match(/^weekdays\s+at\s+(\d{1,2})(:\d{2})?\s*(am|pm)?$/);
  if (weekdayMatch) {
    let hour = parseInt(weekdayMatch[1]);
    const minute = weekdayMatch[2] ? parseInt(weekdayMatch[2].slice(1)) : 0;
    if (weekdayMatch[3] === "pm" && hour < 12) hour += 12;
    if (weekdayMatch[3] === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * 1-5`;
  }

  // "weekly on X at Y"
  const weeklyMatch = trimmed.match(/^weekly\s+on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2})(:\d{2})?\s*(am|pm)?$/);
  if (weeklyMatch) {
    const days: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const day = days[weeklyMatch[1]];
    let hour = parseInt(weeklyMatch[2]);
    const minute = weeklyMatch[3] ? parseInt(weeklyMatch[3].slice(1)) : 0;
    if (weeklyMatch[4] === "pm" && hour < 12) hour += 12;
    if (weeklyMatch[4] === "am" && hour === 12) hour = 0;
    return `${minute} ${hour} * * ${day}`;
  }

  throw new AppError(ErrorCode.VALIDATION_ERROR, `Invalid interval: "${input}". Use formats like "every 30 minutes", "daily at 9am", "weekdays at 9am", or a cron expression.`);
}

/** Convert a cron expression to a human-readable description */
export function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} minutes`;
  if (min === "*" && hour === "*") return "Every minute";
  if (min === "0" && hour === "*") return "Every hour";
  if (min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;

  const h = parseInt(hour);
  const m = parseInt(min);
  if (!isNaN(h) && !isNaN(m)) {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const timeStr = m === 0 ? `${h12}${period}` : `${h12}:${m.toString().padStart(2, "0")}${period}`;

    if (dow === "*") return `Daily at ${timeStr}`;
    if (dow === "1-5") return `Weekdays at ${timeStr}`;
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayNum = parseInt(dow);
    if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) return `${dayNames[dayNum]}s at ${timeStr}`;
  }

  return cron;
}

export class ScheduledMessageService {
  constructor(private repo: ScheduledMessageRepository) {}

  async listByGuild(guildId: string) {
    return this.repo.findAllByGuild(guildId);
  }

  async getAllEnabled() {
    return this.repo.findAllEnabled();
  }

  async getById(id: string) {
    return this.repo.findById(id);
  }

  async create(data: {
    guildId: string;
    channelId: string;
    message: string;
    interval: string;
    timezone?: string;
    isEmbed?: boolean;
    embedColor?: string | null;
    embedTitle?: string | null;
    createdBy: string;
  }) {
    const cronExpression = parseIntervalToCron(data.interval);
    return this.repo.create({
      guildId: data.guildId,
      channelId: data.channelId,
      message: data.message,
      cronExpression,
      timezone: data.timezone,
      isEmbed: data.isEmbed,
      embedColor: data.embedColor,
      embedTitle: data.embedTitle,
      createdBy: data.createdBy,
    });
  }

  async update(id: string, guildId: string, data: {
    channelId?: string;
    message?: string;
    interval?: string;
    timezone?: string;
    isEnabled?: boolean;
    isEmbed?: boolean;
    embedColor?: string | null;
    embedTitle?: string | null;
  }) {
    const existing = await this.repo.findById(id);
    if (!existing || existing.guildId !== guildId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Scheduled message not found.");
    }

    const updateData: Record<string, unknown> = {};
    if (data.channelId !== undefined) updateData.channelId = data.channelId;
    if (data.message !== undefined) updateData.message = data.message;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
    if (data.isEmbed !== undefined) updateData.isEmbed = data.isEmbed;
    if (data.embedColor !== undefined) updateData.embedColor = data.embedColor;
    if (data.embedTitle !== undefined) updateData.embedTitle = data.embedTitle;
    if (data.interval !== undefined) {
      updateData.cronExpression = parseIntervalToCron(data.interval);
    }

    return this.repo.update(id, updateData);
  }

  async toggle(id: string, guildId: string) {
    const existing = await this.repo.findById(id);
    if (!existing || existing.guildId !== guildId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Scheduled message not found.");
    }
    return this.repo.update(id, { isEnabled: !existing.isEnabled });
  }

  async remove(id: string, guildId: string) {
    const existing = await this.repo.findById(id);
    if (!existing || existing.guildId !== guildId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Scheduled message not found.");
    }
    await this.repo.delete(id);
  }

  async updateLastRun(id: string, lastRunAt: Date, nextRunAt: Date | null) {
    await this.repo.updateLastRun(id, lastRunAt, nextRunAt);
  }
}
