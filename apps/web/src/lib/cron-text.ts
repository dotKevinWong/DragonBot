// Cron-to-text for the dashboard. Two formatters on purpose: the schedules list uses the short
// form ("Daily 9AM", "Every 15 min") and CronBuilder the long form ("At 9 AM, every day",
// "Every 15 minutes, every day"). They also parse differently (split(" ") and parseInt versus
// trim().split(/\s+/) and Number), so only the 12-hour time formatting is shared. The bot's
// cronToHuman (apps/bot/src/services/scheduled-message.service.ts) is a third, separate copy.
// Pinned by tests/lib/cron-text.test.ts against the HEAD copies. No imports.

/**
 * 12-hour clock time: "9AM", "5:30PM" ("9 AM", "5:30 PM" when spaced). Midnight is 12AM and
 * noon 12PM. Takes already-parsed numbers and does no range check: 25 gives "13PM".
 */
export function formatTime12h(h: number, m: number, opts?: { spaced?: boolean }): string {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const sep = opts?.spaced ? " " : "";
  return m === 0 ? `${h12}${sep}${period}` : `${h12}:${String(m).padStart(2, "0")}${sep}${period}`;
}

/** The schedules list's short description of a cron; returns the cron itself when it cannot describe it. */
export function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} min`;
  if (min === "0" && hour === "*") return "Hourly";
  if (min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)}h`;

  const h = parseInt(hour);
  const m = parseInt(min);
  if (!isNaN(h) && !isNaN(m)) {
    const timeStr = formatTime12h(h, m);
    if (dow === "*") return `Daily ${timeStr}`;
    if (dow === "1-5") return `Weekdays ${timeStr}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const d = parseInt(dow);
    if (!isNaN(d) && d >= 0 && d <= 6) return `${days[d]} ${timeStr}`;
  }
  return cron;
}

/** CronBuilder's plain-English description of a cron; returns the cron itself when it cannot describe it. */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minField, hourField, domField, monthField, dowField] = parts;
  if (domField !== "*" || monthField !== "*") return cron;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const describeDays = (field: string): string => {
    if (field === "*") return "every day";
    if (field === "1-5") return "weekdays";
    if (field === "0,6" || field === "6,0") return "weekends";
    const nums: number[] = [];
    for (const p of field.split(",")) {
      if (p.includes("-")) {
        const [s, e] = p.split("-").map(Number);
        for (let i = s; i <= e; i++) nums.push(i);
      } else {
        nums.push(Number(p));
      }
    }
    if (nums.length === 7) return "every day";
    return nums.map((n) => dayNames[n] ?? String(n)).join(", ");
  };

  const daysStr = describeDays(dowField);

  // Interval patterns
  if (minField.startsWith("*/") && hourField === "*") {
    return `Every ${minField.slice(2)} minutes, ${daysStr}`;
  }
  if (minField === "0" && hourField === "*") {
    return `Every hour, ${daysStr}`;
  }
  if (minField === "0" && hourField.startsWith("*/")) {
    const h = Number(hourField.slice(2));
    return `Every ${h} hours, ${daysStr}`;
  }

  // Specific time
  const min = Number(minField);
  const hour = Number(hourField);
  if (!isNaN(min) && !isNaN(hour)) {
    return `At ${formatTime12h(hour, min, { spaced: true })}, ${daysStr}`;
  }

  return cron;
}
