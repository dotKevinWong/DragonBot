import { describe, expect, it } from "vitest";
import { cronToHuman, describeCron, formatTime12h } from "@/lib/cron-text";
import { legacyCronToHuman, legacyDescribeCron } from "./legacy-cron-text";

// Audit D15 (web part). The schedules page's cronToHuman and CronBuilder's describeCron give
// different text for the same cron on purpose ("Daily 9AM" vs "At 9 AM, every day"), so they
// stay two functions. Only the 12-hour time formatting is shared. Every case runs through the
// HEAD copies (legacy-cron-text.ts) and the lib module.

const cronToHumanImpls: [string, (cron: string) => string][] = [["HEAD copy", legacyCronToHuman], ["lib", cronToHuman]];
const describeCronImpls: [string, (cron: string) => string][] = [["HEAD copy", legacyDescribeCron], ["lib", describeCron]];

const CRON_TO_HUMAN_CASES: [string, string][] = [
  ["0 9 * * *", "Daily 9AM"],
  ["30 17 * * 1-5", "Weekdays 5:30PM"],
  ["0 12 * * 1", "Mon 12PM"],
  ["0 0 * * 0", "Sun 12AM"],
  ["5 13 * * 6", "Sat 1:05PM"],
  ["*/15 * * * *", "Every 15 min"],
  ["0 * * * *", "Hourly"],
  ["0 */6 * * *", "Every 6h"],
  ["0 9 * * 7", "0 9 * * 7"],
  ["0 9 * * 1,3", "Mon 9AM"], // parseInt("1,3") is 1
  ["0 9 * * 0-6", "Sun 9AM"], // parseInt("0-6") is 0
  ["0  9 * * *", "0  9 * * *"], // split(" ") gives 6 parts
  ["0 9 * * 1-5 ", "0 9 * * 1-5 "],
  ["9abc 9 * * *", "Daily 9:09AM"], // parseInt("9abc") is 9
  ["0 25 * * *", "Daily 13PM"], // no range check
  ["0 9 1 * *", "Daily 9AM"], // day of month and month are ignored
  ["*/5 9 * * *", "*/5 9 * * *"],
  ["bad", "bad"],
  ["", ""],
];

const DESCRIBE_CRON_CASES: [string, string][] = [
  ["0 9 * * *", "At 9 AM, every day"],
  ["30 17 * * 1-5", "At 5:30 PM, weekdays"],
  ["0 0 * * *", "At 12 AM, every day"],
  ["0 12 * * *", "At 12 PM, every day"],
  ["5 0 * * *", "At 12:05 AM, every day"],
  ["0 9 * * 0,6", "At 9 AM, weekends"],
  ["0 9 * * 6,0", "At 9 AM, weekends"],
  ["0 9 * * 1,3,5", "At 9 AM, Mon, Wed, Fri"],
  ["0 9 * * 0-6", "At 9 AM, every day"],
  ["0 9 * * 1-5,0", "At 9 AM, Mon, Tue, Wed, Thu, Fri, Sun"],
  ["0 9 * * 8", "At 9 AM, 8"],
  ["*/15 * * * *", "Every 15 minutes, every day"],
  ["0 * * * 1-5", "Every hour, weekdays"],
  ["0 */6 * * *", "Every 6 hours, every day"],
  ["0 9 1 * *", "0 9 1 * *"],
  ["0 9 * 1 *", "0 9 * 1 *"],
  ["  0  9 * * * ", "At 9 AM, every day"], // trim().split(/\s+/)
  ["0 9 * *", "0 9 * *"],
  ["abc 9 * * *", "abc 9 * * *"],
  ["0 25 * * *", "At 13 PM, every day"], // no range check
];

// A generated matrix of five-field (and some malformed) crons. The two formatters must each
// match their HEAD copy for every one.
function cronMatrix(): string[] {
  const mins = ["0", "5", "30", "59", "*/15", "*/1", "x", "", "9abc", "-1", "1.5"];
  const hours = ["0", "9", "11", "12", "13", "23", "24", "*", "*/2", "*/abc", "x", "-3", "12.5"];
  const doms = ["*", "1"];
  const dows = ["*", "1-5", "0", "6", "7", "0,6", "6,0", "1,3", "0-6", "1-3,5", "abc", "1-abc", ""];
  const out: string[] = [];
  for (const m of mins) for (const h of hours) for (const dom of doms) for (const dow of dows) {
    out.push([m, h, dom, "*", dow].join(" "));
    out.push([m, h, "*", dom, dow].join(" "));
  }
  out.push("", " ", "*", "* * * *", "* * * * * *", "\t0 9 * * *", "0\t9 * * *");
  return out;
}

describe("schedules page cronToHuman", () => {
  for (const [name, fn] of cronToHumanImpls) {
    it.each(CRON_TO_HUMAN_CASES)(`${name}: %j -> %j`, (cron, expected) => {
      expect(fn(cron)).toBe(expected);
    });
  }

  it("every implementation matches the HEAD copy over the generated matrix", () => {
    const crons = cronMatrix();
    expect(crons.length).toBeGreaterThan(3000);
    for (const [, fn] of cronToHumanImpls) {
      for (const cron of crons) expect(fn(cron)).toBe(legacyCronToHuman(cron));
    }
  });
});

describe("CronBuilder describeCron", () => {
  for (const [name, fn] of describeCronImpls) {
    it.each(DESCRIBE_CRON_CASES)(`${name}: %j -> %j`, (cron, expected) => {
      expect(fn(cron)).toBe(expected);
    });
  }

  it("every implementation matches the HEAD copy over the generated matrix", () => {
    const crons = cronMatrix();
    for (const [, fn] of describeCronImpls) {
      for (const cron of crons) expect(fn(cron)).toBe(legacyDescribeCron(cron));
    }
  });
});

describe("the two formatters are not interchangeable", () => {
  it("give different text for the same cron, so they stay separate functions", () => {
    const differing = ["0 9 * * *", "30 17 * * 1-5", "*/15 * * * *", "0 * * * *", "0 */6 * * *", "0 12 * * 1"];
    for (const cron of differing) expect(legacyCronToHuman(cron)).not.toBe(legacyDescribeCron(cron));
  });
});

describe("formatTime12h", () => {
  // The two formulas it replaced, written out as they were at HEAD.
  const headPage = (h: number, m: number) => {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12}${period}` : `${h12}:${m.toString().padStart(2, "0")}${period}`;
  };
  const headBuilder = (h: number, m: number) => {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
  };

  it("matches both HEAD formulas for every hour and a spread of minutes, in range and out", () => {
    const hours = [...Array.from({ length: 24 }, (_, i) => i), 24, 25, -1, -13, 0.5, 12.5, -0];
    const mins = [0, 5, 30, 59, 60, 123, -5, 1.5, -0];
    for (const h of hours) for (const m of mins) {
      expect(formatTime12h(h, m)).toBe(headPage(h, m));
      expect(formatTime12h(h, m, {})).toBe(headPage(h, m));
      expect(formatTime12h(h, m, { spaced: false })).toBe(headPage(h, m));
      expect(formatTime12h(h, m, { spaced: true })).toBe(headBuilder(h, m));
    }
  });

  it.each([
    [0, 0, "12AM", "12 AM"],
    [9, 0, "9AM", "9 AM"],
    [12, 0, "12PM", "12 PM"],
    [13, 5, "1:05PM", "1:05 PM"],
    [17, 30, "5:30PM", "5:30 PM"],
    [23, 59, "11:59PM", "11:59 PM"],
    [25, 0, "13PM", "13 PM"],
  ])("%i:%i -> %s / %s", (h, m, plain, spaced) => {
    expect(formatTime12h(h, m)).toBe(plain);
    expect(formatTime12h(h, m, { spaced: true })).toBe(spaced);
  });
});
