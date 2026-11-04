import { describe, it, expect } from "vitest";
import { cronToHuman } from "../../src/services/scheduled-message.service.js";

describe("cronToHuman", () => {
  it.each([
    ["0 9 * * *", "Daily at 9AM"],
    ["30 17 * * 1-5", "Weekdays at 5:30PM"],
    ["0 0 * * 0", "Sundays at 12AM"],
    ["0 12 * * 6", "Saturdays at 12PM"],
    ["5 13 * * *", "Daily at 1:05PM"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["* * * * *", "Every minute"],
    ["0 * * * *", "Every hour"],
    ["0 */2 * * *", "Every 2 hours"],
    ["0 9 * * 7", "0 9 * * 7"],
    ["0 9 * * 1,3", "Mondays at 9AM"],
    ["0 9 * *", "0 9 * *"],
    ["0  9 * * *", "0  9 * * *"],
    ["x y * * *", "x y * * *"],
  ])("%s -> %s", (cron, text) => {
    expect(cronToHuman(cron)).toBe(text);
  });
});
