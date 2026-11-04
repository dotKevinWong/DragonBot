import { describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { runStartup, type StartupFactories } from "../../src/bootstrap/startup.js";
import type { BotContext } from "../../src/types/context.js";
import type { YouTubeRepository } from "../../src/repositories/youtube.repository.js";

// runStartup with injected factories (C4). The order is the one AGENTS.md "Startup Sequence" documents; the same
// order is also pinned end to end through index.ts in tests/index.test.ts.

function setup(opts: { webhookSecret?: string; fail?: string[] } = {}) {
  const calls: string[] = [];
  const fail = new Set(opts.fail ?? []);
  const step = (name: string, result?: unknown) =>
    vi.fn(async (..._args: unknown[]) => {
      calls.push(name);
      if (fail.has(name)) throw new Error(`${name} failed`);
      return result;
    });
  const logger = {
    info: vi.fn((...args: unknown[]) => void calls.push(`info:${typeof args[0] === "string" ? args[0] : args[1]}`)),
    error: vi.fn((...args: unknown[]) => void calls.push(`error:${args[1]}`)),
  };
  const services = {
    guild: { hydrateAll: step("hydrateAll", 5) },
    xp: { hydrate: step("xp.hydrate") },
    scheduledMessage: { tag: "scheduledMessage" },
    birthday: { tag: "birthday" },
    youtube: { tag: "youtube" },
    honeypot: { tag: "honeypot" },
    logging: { tag: "logging" },
  };
  const config = { BOT_WEBHOOK_SECRET: opts.webhookSecret, BOT_WEBHOOK_PORT: 4000 };
  const ctx = { logger, config, services } as unknown as BotContext;
  const client = { tag: "client" } as unknown as Client;
  const youtubeRepo = { tag: "youtubeRepo" } as unknown as YouTubeRepository;
  const scheduler = { loadAll: step("scheduler.loadAll") };
  const birthdayChecker = { check: step("birthday.check") };
  const youtubeChecker = { check: step("youtube.check") };
  const honeypotWarning = { sync: step("hw.sync"), syncAll: step("hw.syncAll") };
  const factories = {
    createScheduler: vi.fn(() => {
      calls.push("createScheduler");
      return scheduler;
    }),
    createBirthdayChecker: vi.fn(() => {
      calls.push("createBirthdayChecker");
      return birthdayChecker;
    }),
    createYouTubeChecker: vi.fn(() => {
      calls.push("createYouTubeChecker");
      return youtubeChecker;
    }),
    createHoneypotWarning: vi.fn(() => {
      calls.push(`createHoneypotWarning[hw=${ctx.honeypotWarning ? 1 : 0}]`);
      return honeypotWarning;
    }),
    startWebhookServer: vi.fn(() => {
      calls.push(`startWebhookServer[sched=${ctx.scheduler ? 1 : 0},hw=${ctx.honeypotWarning ? 1 : 0}]`);
      return {};
    }),
    startPeriodicSync: vi.fn(() => {
      calls.push("startPeriodicSync");
      return {};
    }),
  } as unknown as StartupFactories;
  const readyClient = { user: { tag: "Bot#1" }, guilds: { cache: { size: 2 } } } as unknown as Client<true>;
  const run = () => runStartup(readyClient, { client, ctx, youtubeRepo }, factories);
  return { calls, run, ctx, client, youtubeRepo, services, logger, factories, scheduler, birthdayChecker, youtubeChecker, honeypotWarning };
}

const ORDER = [
  "info:Bot is online",
  "hydrateAll",
  "info:Guild settings hydrated",
  "xp.hydrate",
  "createScheduler",
  "scheduler.loadAll",
  "createBirthdayChecker",
  "createYouTubeChecker",
  "createHoneypotWarning[hw=0]",
  "startWebhookServer[sched=1,hw=1]",
  "startPeriodicSync",
  "birthday.check",
  "info:Birthday checker initialized",
  "youtube.check",
  "info:YouTube checker initialized",
  "hw.syncAll",
];

describe("runStartup", () => {
  it("runs the startup steps in order", async () => {
    const s = setup({ webhookSecret: "x" });
    await s.run();
    expect(s.calls).toEqual(ORDER);
    expect(s.logger.info).toHaveBeenNthCalledWith(1, { user: "Bot#1", guilds: 2 }, "Bot is online");
    expect(s.logger.info).toHaveBeenNthCalledWith(2, { guildCount: 5 }, "Guild settings hydrated");
  });

  it("does not start the webhook server without a secret", async () => {
    const s = setup();
    await s.run();
    expect(s.calls).toEqual(ORDER.filter((c) => !c.startsWith("startWebhookServer")));
  });

  it("passes the injected client and services to the factories", async () => {
    const s = setup({ webhookSecret: "x" });
    await s.run();
    const f = s.factories as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(f.createScheduler).toHaveBeenCalledWith(s.client, s.services.scheduledMessage, s.logger);
    expect(f.createBirthdayChecker).toHaveBeenCalledWith(s.client, s.services.birthday, s.services.guild, s.logger);
    expect(f.createYouTubeChecker).toHaveBeenCalledWith(
      s.client,
      s.services.youtube,
      s.youtubeRepo,
      s.services.guild,
      s.logger,
    );
    expect(f.createHoneypotWarning).toHaveBeenCalledWith(
      s.client,
      s.services.guild,
      s.services.honeypot,
      s.services.logging,
      s.logger,
    );
    expect(f.startPeriodicSync).toHaveBeenCalledWith({
      xpService: s.services.xp,
      guildService: s.services.guild,
      scheduler: s.scheduler,
      birthdayChecker: s.birthdayChecker,
      youtubeChecker: s.youtubeChecker,
      honeypotWarning: s.honeypotWarning,
      logger: s.logger,
    });
    const opts = f.startWebhookServer.mock.calls[0][0] as {
      port: number;
      secret: string;
      getScheduler: () => unknown;
      onGuildReload: (id: string | null) => Promise<void>;
    };
    expect(opts.port).toBe(4000);
    expect(opts.secret).toBe("x");
    expect(opts.getScheduler()).toBe(s.scheduler);
    await opts.onGuildReload("g");
    expect(s.honeypotWarning.sync).toHaveBeenCalledWith("g", { resetBudget: true });
    expect(s.ctx.scheduler).toBe(s.scheduler);
    expect(s.ctx.honeypotWarning).toBe(s.honeypotWarning);
  });

  it("propagates a failed YouTube check and skips the final sync", async () => {
    const s = setup({ fail: ["youtube.check"] });
    await expect(s.run()).rejects.toThrow("youtube.check failed");
    expect(s.calls.at(-1)).toBe("youtube.check");
    expect(s.calls).not.toContain("hw.syncAll");
  });

  it("catches and logs a failed final honeypot sync", async () => {
    const s = setup({ fail: ["hw.syncAll"] });
    await expect(s.run()).resolves.toBeUndefined();
    expect(s.calls.at(-1)).toBe("error:Startup honeypot warning sync failed");
  });
});
