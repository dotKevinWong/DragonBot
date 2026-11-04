import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client } from "discord.js";
import type { Logger } from "pino";

const cronMock = vi.hoisted(() => ({
  validate: vi.fn((expr: string) => expr !== "bad"),
  schedule: vi.fn(),
}));
vi.mock("node-cron", () => ({ default: cronMock }));

import { SchedulerManager } from "../../src/lib/scheduler.js";
import type { ScheduledMessageService } from "../../src/services/scheduled-message.service.js";

function schedule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    guildId: "g1",
    channelId: "c1",
    message: "hi",
    cronExpression: "0 9 * * *",
    timezone: "UTC",
    isEnabled: true,
    isEmbed: false,
    embedColor: null,
    embedTitle: null,
    updatedAt: new Date(1000),
    ...overrides,
  };
}

function setup() {
  const tasks: Array<{ expr: string; stop: ReturnType<typeof vi.fn> }> = [];
  cronMock.schedule.mockImplementation((expr: string) => {
    const task = { expr, stop: vi.fn() };
    tasks.push(task);
    return task;
  });
  const service = { getAllEnabled: vi.fn(), getById: vi.fn(), updateLastRun: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  const scheduler = new SchedulerManager(
    {} as Client,
    service as unknown as ScheduledMessageService,
    logger as unknown as Logger,
  );
  return { scheduler, service, logger, tasks };
}

describe("SchedulerManager.reload", () => {
  beforeEach(() => {
    cronMock.schedule.mockReset();
    cronMock.validate.mockClear();
  });

  it("adds, updates and removes jobs to match the enabled schedules", async () => {
    const { scheduler, service, logger, tasks } = setup();
    service.getAllEnabled.mockResolvedValueOnce([schedule("a"), schedule("b"), schedule("c")]);
    await scheduler.loadAll();
    expect(scheduler.activeJobCount).toBe(3);
    expect(logger.info).toHaveBeenLastCalledWith({ added: 3, updated: 0, total: 3 }, "Schedules synced");
    expect(cronMock.schedule).toHaveBeenCalledWith("0 9 * * *", expect.any(Function), { timezone: "UTC" });

    // a unchanged; b's cron, c's timezone and d's updatedAt change; e new; the removed one is gone
    service.getAllEnabled.mockResolvedValueOnce([
      schedule("a"),
      schedule("b", { cronExpression: "0 10 * * *" }),
      schedule("c", { timezone: "America/New_York" }),
      schedule("e"),
    ]);
    await scheduler.reload();
    expect(logger.info).toHaveBeenLastCalledWith({ added: 1, updated: 2, total: 4 }, "Schedules synced");
    expect(tasks[1]!.stop).toHaveBeenCalledTimes(1); // old b
    expect(tasks[2]!.stop).toHaveBeenCalledTimes(1); // old c
    expect(tasks[0]!.stop).not.toHaveBeenCalled(); // a kept

    service.getAllEnabled.mockResolvedValueOnce([schedule("a", { updatedAt: new Date(2000) })]);
    await scheduler.reload();
    expect(logger.info).toHaveBeenLastCalledWith({ added: 0, updated: 1, total: 1 }, "Schedules synced");
    expect(scheduler.activeJobCount).toBe(1);
  });

  it("warns about and skips an invalid cron expression", async () => {
    const { scheduler, service, logger } = setup();
    service.getAllEnabled.mockResolvedValueOnce([schedule("a", { cronExpression: "bad" })]);
    await scheduler.reload();
    expect(logger.warn).toHaveBeenCalledWith({ scheduleId: "a", cron: "bad" }, "Invalid cron expression");
    expect(scheduler.activeJobCount).toBe(0);
    expect(logger.info).toHaveBeenLastCalledWith({ added: 1, updated: 0, total: 0 }, "Schedules synced");
  });
});
