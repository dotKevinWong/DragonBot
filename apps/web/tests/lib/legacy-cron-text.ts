// Verbatim copies of the two cron-to-text formatters at git HEAD d09dc0c:
//   legacyCronToHuman: cronToHuman in apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx lines 41-63
//   legacyDescribeCron: describeCron in apps/web/src/components/cron-builder.tsx lines 142-196
// Only the function names changed (a "legacy" prefix) and "export" was added. Kept so the
// characterization tests can prove src/lib/cron-text.ts returns the same strings. Do not edit.

export function legacyCronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} min`;
  if (min === "0" && hour === "*") return "Hourly";
  if (min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)}h`;

  const h = parseInt(hour);
  const m = parseInt(min);
  if (!isNaN(h) && !isNaN(m)) {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const timeStr = m === 0 ? `${h12}${period}` : `${h12}:${m.toString().padStart(2, "0")}${period}`;
    if (dow === "*") return `Daily ${timeStr}`;
    if (dow === "1-5") return `Weekdays ${timeStr}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const d = parseInt(dow);
    if (!isNaN(d) && d >= 0 && d <= 6) return `${days[d]} ${timeStr}`;
  }
  return cron;
}

/** Describe a cron expression in plain English. */
export function legacyDescribeCron(cron: string): string {
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

  const formatTime = (h: number, m: number): string => {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
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
    return `At ${formatTime(hour, min)}, ${daysStr}`;
  }

  return cron;
}
