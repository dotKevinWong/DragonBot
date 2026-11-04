import { ScheduledMessageRepository } from "../repositories/scheduled-message.repository.js";

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

  async updateLastRun(id: string, lastRunAt: Date, nextRunAt: Date | null) {
    await this.repo.updateLastRun(id, lastRunAt, nextRunAt);
  }
}
