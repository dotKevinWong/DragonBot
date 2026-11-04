import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Characterization of the composition root (C4). Every module index.ts wires is mocked, so importing index.ts runs
// main() against fakes. The test pins construction order and arguments, the loader and login sequence, the
// clientReady startup order, the 4-hour sync timer, shutdown, the crash handlers and the fatal startup catch.

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => {
  const state = {
    calls: [] as string[],
    instances: {} as Record<string, any>,
    ctorArgs: {} as Record<string, unknown[]>,
    fail: new Set<string>(),
    logs: [] as { level: string; args: unknown[] }[],
    ready: undefined as undefined | ((c: unknown) => unknown),
    ctx: undefined as any,
    webhookOpts: undefined as any,
    intervalFn: undefined as undefined | (() => Promise<void>),
    deadlineFn: undefined as undefined | (() => void),
    config: {} as Record<string, unknown>,
    // Records "probe" state (ctx fields set yet?) at selected calls.
    probe: (label: string) => {
      const c = state.ctx;
      state.calls.push(`${label}[sched=${c?.scheduler ? 1 : 0},hw=${c?.honeypotWarning ? 1 : 0}]`);
    },
  };
  const methodImpl: Record<string, (self: any, ...args: unknown[]) => unknown> = {
    "GuildService.hydrateAll": () => 3,
  };
  const probed = new Set(["SchedulerManager.loadAll", "HoneypotWarningSync.syncAll"]);
  function mk(name: string, methods: string[] = []) {
    return class {
      constructor(...args: unknown[]) {
        state.calls.push(`new ${name}`);
        state.ctorArgs[name] = args;
        state.instances[name] = this;
        for (const m of methods) {
          const key = `${name}.${m}`;
          (this as any)[m] = vi.fn(async (...a: unknown[]) => {
            if (probed.has(key)) state.probe(key);
            else state.calls.push(key);
            if (state.fail.has(key)) throw new Error(`${key} failed`);
            return methodImpl[key]?.(this, ...a);
          });
        }
      }
    };
  }
  const logger: any = {};
  for (const level of ["info", "warn", "error", "fatal", "debug"]) {
    logger[level] = vi.fn((...args: unknown[]) => {
      state.logs.push({ level, args });
      const msg = typeof args[0] === "string" ? args[0] : args[1];
      state.calls.push(`log.${level}:${msg}`);
    });
  }
  const db = { tag: "db" };
  const client = {
    tag: "client",
    once: vi.fn((ev: string, fn: (c: unknown) => unknown) => {
      state.calls.push(`client.once:${ev}`);
      state.ready = fn;
    }),
    login: vi.fn(async (token: string) => void state.calls.push(`client.login:${token}`)),
    destroy: vi.fn(() => void state.calls.push("client.destroy")),
  };
  return { state, mk, logger, db, client };
});

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("@dragonbot/db", () => ({
  createBotClient: vi.fn((url: string) => {
    h.state.calls.push(`createBotClient:${url}`);
    return h.db;
  }),
}));
vi.mock("../src/config.js", () => ({ loadConfig: () => h.state.config }));
vi.mock("../src/lib/logger.js", () => ({ createLogger: () => h.logger }));
vi.mock("../src/client.js", () => ({ createClient: () => h.client }));
vi.mock("../src/lib/email.js", () => ({ EmailService: h.mk("EmailService") }));
vi.mock("../src/lib/openai.js", () => ({ AIService: h.mk("AIService") }));
vi.mock("../src/repositories/guild.repository.js", () => ({ GuildRepository: h.mk("GuildRepository") }));
vi.mock("../src/repositories/user.repository.js", () => ({ UserRepository: h.mk("UserRepository") }));
vi.mock("../src/repositories/verification.repository.js", () => ({
  VerificationRepository: h.mk("VerificationRepository"),
}));
vi.mock("../src/repositories/suggestion.repository.js", () => ({ SuggestionRepository: h.mk("SuggestionRepository") }));
vi.mock("../src/repositories/auth.repository.js", () => ({ AuthRepository: h.mk("AuthRepository") }));
vi.mock("../src/repositories/guild-admin.repository.js", () => ({ GuildAdminRepository: h.mk("GuildAdminRepository") }));
vi.mock("../src/repositories/scheduled-message.repository.js", () => ({
  ScheduledMessageRepository: h.mk("ScheduledMessageRepository"),
}));
vi.mock("../src/repositories/xp.repository.js", () => ({ XpRepository: h.mk("XpRepository") }));
vi.mock("../src/repositories/birthday.repository.js", () => ({ BirthdayRepository: h.mk("BirthdayRepository") }));
vi.mock("../src/repositories/xp-archive.repository.js", () => ({ XpArchiveRepository: h.mk("XpArchiveRepository") }));
vi.mock("../src/repositories/youtube.repository.js", () => ({ YouTubeRepository: h.mk("YouTubeRepository") }));
vi.mock("../src/services/guild.service.js", () => ({ GuildService: h.mk("GuildService", ["hydrateAll"]) }));
vi.mock("../src/services/user.service.js", () => ({ UserService: h.mk("UserService") }));
vi.mock("../src/services/verification.service.js", () => ({ VerificationService: h.mk("VerificationService") }));
vi.mock("../src/services/auth.service.js", () => ({ AuthService: h.mk("AuthService") }));
vi.mock("../src/services/suggestion.service.js", () => ({ SuggestionService: h.mk("SuggestionService") }));
vi.mock("../src/services/moderation.service.js", () => ({ ModerationService: h.mk("ModerationService") }));
vi.mock("../src/services/logging.service.js", () => ({ LoggingService: h.mk("LoggingService") }));
vi.mock("../src/services/guild-admin.service.js", () => ({ GuildAdminService: h.mk("GuildAdminService") }));
vi.mock("../src/services/scheduled-message.service.js", () => ({
  ScheduledMessageService: h.mk("ScheduledMessageService"),
}));
vi.mock("../src/services/xp.service.js", () => ({ XpService: h.mk("XpService", ["hydrate", "flush"]) }));
vi.mock("../src/services/xp-archive.service.js", () => ({ XpArchiveService: h.mk("XpArchiveService") }));
vi.mock("../src/services/birthday.service.js", () => ({ BirthdayService: h.mk("BirthdayService") }));
vi.mock("../src/services/youtube.service.js", () => ({ YouTubeService: h.mk("YouTubeService") }));
vi.mock("../src/services/honeypot.service.js", () => ({ HoneypotService: h.mk("HoneypotService", ["drain"]) }));
vi.mock("../src/lib/scheduler.js", () => ({ SchedulerManager: h.mk("SchedulerManager", ["loadAll", "reload"]) }));
vi.mock("../src/lib/birthday-checker.js", () => ({ BirthdayChecker: h.mk("BirthdayChecker", ["check"]) }));
vi.mock("../src/lib/youtube-checker.js", () => ({ YouTubeChecker: h.mk("YouTubeChecker", ["check"]) }));
vi.mock("../src/lib/honeypot-warning.js", () => ({
  HoneypotWarningSync: h.mk("HoneypotWarningSync", ["sync", "syncAll"]),
}));
vi.mock("../src/lib/webhook-server.js", () => ({
  startWebhookServer: vi.fn((opts: unknown) => {
    h.state.probe("startWebhookServer");
    h.state.webhookOpts = opts;
    return {};
  }),
}));
vi.mock("../src/loader.js", () => ({
  loadCommands: vi.fn(async (dir: string) => {
    h.state.calls.push(`loadCommands:${path.basename(dir)}`);
    if (h.state.fail.has("loadCommands")) throw new Error("loadCommands failed");
    return { tag: "commands" };
  }),
  registerCommands: vi.fn(async (_commands: unknown, clientId: string, token: string) => {
    h.state.calls.push(`registerCommands:${clientId}:${token}`);
  }),
  loadEvents: vi.fn(async (dir: string, _client: unknown, ctx: unknown) => {
    h.state.calls.push(`loadEvents:${path.basename(dir)}`);
    h.state.ctx = ctx;
  }),
  bindInteractionHandler: vi.fn(() => void h.state.calls.push("bindInteractionHandler")),
}));

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const PROCESS_EVENTS = ["SIGTERM", "SIGINT", "uncaughtException", "unhandledRejection"];
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const DEADLINE = { deadline: true };

let procHandlers: Record<string, (...args: unknown[]) => unknown>;
const tick = () => new Promise<void>((r) => setImmediate(r));

async function boot(config: Record<string, unknown> = {}) {
  h.state.config = {
    DATABASE_URL: "postgres://x",
    RESEND_API_KEY: "re_key",
    RESEND_FROM_EMAIL: "from@x",
    OPENAI_API_KEY: "sk",
    OPENAI_MODEL: "gpt",
    BOT_CLIENT_ID: "cid",
    DISCORD_API_TOKEN: "tok",
    BOT_WEBHOOK_PORT: 3001,
    BOT_WEBHOOK_SECRET: "whsecret",
    ...config,
  };
  await import("../src/index.js");
  for (let i = 0; i < 5; i++) await tick();
}

beforeEach(() => {
  vi.resetModules();
  h.state.calls.length = 0;
  h.state.logs.length = 0;
  h.state.fail.clear();
  h.state.instances = {};
  h.state.ctorArgs = {};
  h.state.ready = undefined;
  h.state.ctx = undefined;
  h.state.webhookOpts = undefined;
  h.state.intervalFn = undefined;
  h.state.deadlineFn = undefined;
  procHandlers = {};
  const origOn = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation(((ev: string, fn: (...args: unknown[]) => unknown) => {
    if (!PROCESS_EVENTS.includes(ev)) return origOn(ev as never, fn as never);
    h.state.calls.push(`process.on:${ev}`);
    procHandlers[ev] = fn;
    return process;
  }) as never);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    h.state.calls.push(`exit:${code}`);
  }) as never);
  vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => Promise<void>, ms: number) => {
    h.state.calls.push(`setInterval:${ms}`);
    h.state.intervalFn = fn;
    return { unref: () => void h.state.calls.push("timer.unref") };
  }) as never);
  const origSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number, ...rest: unknown[]) => {
    if (ms !== 8000) return origSetTimeout(fn, ms, ...rest);
    h.state.calls.push("setTimeout:8000");
    h.state.deadlineFn = fn;
    return DEADLINE;
  }) as never);
  const origClearTimeout = globalThis.clearTimeout;
  vi.spyOn(globalThis, "clearTimeout").mockImplementation(((t: unknown) => {
    if (t === DEADLINE) h.state.calls.push("clearTimeout:deadline");
    else origClearTimeout(t as never);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const readyClient = { user: { tag: "Dragon#0001" }, guilds: { cache: { size: 7 } } };

async function bootAndReady(config: Record<string, unknown> = {}) {
  await boot(config);
  const startAt = h.state.calls.length;
  const result = h.state.ready!(readyClient);
  return { result, startAt };
}

describe("index.ts wiring (before clientReady)", () => {
  it("constructs everything in order, loads commands and events, logs in, then installs process handlers", async () => {
    await boot();
    expect(h.state.calls).toEqual([
      "createBotClient:postgres://x",
      "new EmailService",
      "new AIService",
      "new GuildRepository",
      "new UserRepository",
      "new VerificationRepository",
      "new SuggestionRepository",
      "new AuthRepository",
      "new GuildAdminRepository",
      "new GuildService",
      "new UserService",
      "new VerificationService",
      "new AuthService",
      "new SuggestionService",
      "new ModerationService",
      "new LoggingService",
      "new GuildAdminService",
      "new ScheduledMessageRepository",
      "new ScheduledMessageService",
      "new XpRepository",
      "new XpService",
      "new BirthdayRepository",
      "new BirthdayService",
      "new YouTubeRepository",
      "new YouTubeService",
      "new HoneypotService",
      "new XpArchiveRepository",
      "new XpArchiveService",
      "loadCommands:commands",
      "registerCommands:cid:tok",
      "loadEvents:events",
      "bindInteractionHandler",
      "client.once:clientReady",
      "client.login:tok",
      "process.on:SIGTERM",
      "process.on:SIGINT",
      "process.on:uncaughtException",
      "process.on:unhandledRejection",
    ]);
    expect(h.state.ready).toBeTypeOf("function");
  });

  it("passes the same constructor arguments as before", async () => {
    await boot();
    const i = h.state.instances;
    const a = h.state.ctorArgs;
    expect(a.EmailService).toEqual(["re_key", "from@x"]);
    expect(a.AIService).toEqual(["sk", "gpt"]);
    for (const repo of [
      "GuildRepository",
      "UserRepository",
      "VerificationRepository",
      "SuggestionRepository",
      "AuthRepository",
      "GuildAdminRepository",
      "ScheduledMessageRepository",
      "XpRepository",
      "BirthdayRepository",
      "YouTubeRepository",
      "XpArchiveRepository",
    ]) {
      expect(a[repo]).toHaveLength(1);
      expect(a[repo][0]).toBe(h.db);
    }
    expect(a.GuildService[0]).toBe(i.GuildRepository);
    expect(a.UserService[0]).toBe(i.UserRepository);
    expect(a.VerificationService).toHaveLength(4);
    expect(a.VerificationService[0]).toBe(i.VerificationRepository);
    expect(a.VerificationService[1]).toBe(i.GuildRepository);
    expect(a.VerificationService[2]).toBe(i.UserRepository);
    expect(a.VerificationService[3]).toBe(i.EmailService);
    expect(a.AuthService).toHaveLength(1);
    expect(a.AuthService[0]).toBe(i.AuthRepository);
    expect(a.SuggestionService[0]).toBe(i.SuggestionRepository);
    expect(a.SuggestionService[1]).toBe(i.GuildRepository);
    expect(a.ModerationService[0]).toBe(i.GuildService);
    expect(a.LoggingService[0]).toBe(i.GuildService);
    expect(a.GuildAdminService[0]).toBe(i.GuildAdminRepository);
    expect(a.ScheduledMessageService[0]).toBe(i.ScheduledMessageRepository);
    expect(a.XpService[0]).toBe(i.XpRepository);
    expect(a.XpService[1]).toBe(h.logger);
    expect(a.BirthdayService[0]).toBe(i.BirthdayRepository);
    expect(a.YouTubeService).toEqual([]);
    expect(a.HoneypotService).toEqual([]);
    expect(a.XpArchiveService[0]).toBe(i.XpService);
    expect(a.XpArchiveService[1]).toBe(i.XpArchiveRepository);
  });

  it("builds the BotContext handed to events with the same services", async () => {
    await boot();
    const ctx = h.state.ctx;
    const i = h.state.instances;
    expect(Object.keys(ctx)).toEqual(["logger", "ai", "config", "services"]);
    expect(ctx.logger).toBe(h.logger);
    expect(ctx.ai).toBe(i.AIService);
    expect(ctx.config).toBe(h.state.config);
    expect(ctx.services).toEqual({
      user: i.UserService,
      guild: i.GuildService,
      verification: i.VerificationService,
      auth: i.AuthService,
      suggestion: i.SuggestionService,
      moderation: i.ModerationService,
      logging: i.LoggingService,
      guildAdmin: i.GuildAdminService,
      scheduledMessage: i.ScheduledMessageService,
      xp: i.XpService,
      xpArchive: i.XpArchiveService,
      birthday: i.BirthdayService,
      youtube: i.YouTubeService,
      honeypot: i.HoneypotService,
    });
    expect(Object.keys(ctx.services)).toEqual([
      "user",
      "guild",
      "verification",
      "auth",
      "suggestion",
      "moderation",
      "logging",
      "guildAdmin",
      "scheduledMessage",
      "xp",
      "xpArchive",
      "birthday",
      "youtube",
      "honeypot",
    ]);
  });

  it("logs a fatal startup error with console.error and exits 1", async () => {
    h.state.fail.add("loadCommands");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await boot();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toBe("Fatal error during startup:");
    expect((consoleError.mock.calls[0][1] as Error).message).toBe("loadCommands failed");
    expect(h.state.calls.slice(-2)).toEqual(["loadCommands:commands", "exit:1"]);
  });
});

describe("clientReady startup sequence", () => {
  const STARTUP_ORDER = [
    "log.info:Bot is online",
    "GuildService.hydrateAll",
    "log.info:Guild settings hydrated",
    "XpService.hydrate",
    "new SchedulerManager",
    "SchedulerManager.loadAll[sched=0,hw=0]",
    "new BirthdayChecker",
    "new YouTubeChecker",
    "new HoneypotWarningSync",
    "startWebhookServer[sched=1,hw=1]",
    `setInterval:${FOUR_HOURS_MS}`,
    "timer.unref",
    "BirthdayChecker.check",
    "log.info:Birthday checker initialized",
    "YouTubeChecker.check",
    "log.info:YouTube checker initialized",
    "HoneypotWarningSync.syncAll[sched=1,hw=1]",
  ];

  it("runs the steps in the established order", async () => {
    const { result, startAt } = await bootAndReady();
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(h.state.calls.slice(startAt)).toEqual(STARTUP_ORDER);
    expect(h.state.logs[0]).toEqual({ level: "info", args: [{ user: "Dragon#0001", guilds: 7 }, "Bot is online"] });
    expect(h.state.logs[1]).toEqual({ level: "info", args: [{ guildCount: 3 }, "Guild settings hydrated"] });
    expect(h.state.logs[2]).toEqual({ level: "info", args: ["Birthday checker initialized"] });
    expect(h.state.logs[3]).toEqual({ level: "info", args: ["YouTube checker initialized"] });
    expect(h.state.logs).toHaveLength(4);
  });

  it("calls hydrateAll synchronously in the same tick clientReady fires", async () => {
    await boot();
    const startAt = h.state.calls.length;
    const result = h.state.ready!(readyClient);
    // No await between emitting ready and this check: the first two steps must already have run.
    expect(h.state.calls.slice(startAt)).toEqual(["log.info:Bot is online", "GuildService.hydrateAll"]);
    await result;
  });

  it("constructs the background workers with the original arguments and sets ctx fields", async () => {
    const { result } = await bootAndReady();
    await result;
    const i = h.state.instances;
    const a = h.state.ctorArgs;
    expect(a.SchedulerManager).toEqual([h.client, i.ScheduledMessageService, h.logger]);
    expect(a.SchedulerManager[0]).toBe(h.client);
    expect(a.BirthdayChecker).toHaveLength(4);
    expect(a.BirthdayChecker[0]).toBe(h.client);
    expect(a.BirthdayChecker[1]).toBe(i.BirthdayService);
    expect(a.BirthdayChecker[2]).toBe(i.GuildService);
    expect(a.BirthdayChecker[3]).toBe(h.logger);
    expect(a.YouTubeChecker).toHaveLength(5);
    expect(a.YouTubeChecker[0]).toBe(h.client);
    expect(a.YouTubeChecker[1]).toBe(i.YouTubeService);
    expect(a.YouTubeChecker[2]).toBe(i.YouTubeRepository);
    expect(a.YouTubeChecker[3]).toBe(i.GuildService);
    expect(a.YouTubeChecker[4]).toBe(h.logger);
    expect(a.HoneypotWarningSync).toHaveLength(5);
    expect(a.HoneypotWarningSync[0]).toBe(h.client);
    expect(a.HoneypotWarningSync[1]).toBe(i.GuildService);
    expect(a.HoneypotWarningSync[2]).toBe(i.HoneypotService);
    expect(a.HoneypotWarningSync[3]).toBe(i.LoggingService);
    expect(a.HoneypotWarningSync[4]).toBe(h.logger);
    expect(h.state.ctx.scheduler).toBe(i.SchedulerManager);
    expect(h.state.ctx.honeypotWarning).toBe(i.HoneypotWarningSync);
  });

  it("starts the webhook server with a lazy scheduler getter and the honeypot reload hook", async () => {
    const { result } = await bootAndReady();
    await result;
    const opts = h.state.webhookOpts;
    expect(Object.keys(opts)).toEqual(["port", "secret", "guildService", "logger", "getScheduler", "onGuildReload"]);
    expect(opts.port).toBe(3001);
    expect(opts.secret).toBe("whsecret");
    expect(opts.guildService).toBe(h.state.instances.GuildService);
    expect(opts.logger).toBe(h.logger);
    expect(opts.getScheduler()).toBe(h.state.instances.SchedulerManager);
    const replacement = { tag: "other" };
    h.state.ctx.scheduler = replacement;
    expect(opts.getScheduler()).toBe(replacement);

    const hw = h.state.instances.HoneypotWarningSync;
    const p1 = opts.onGuildReload("g1");
    expect(p1).toBeInstanceOf(Promise);
    expect(hw.sync).toHaveBeenCalledWith("g1", { resetBudget: true });
    expect(hw.syncAll).toHaveBeenCalledTimes(1);
    await opts.onGuildReload(null);
    expect(hw.syncAll).toHaveBeenCalledTimes(2);
    expect(hw.sync).toHaveBeenCalledTimes(1);
  });

  it("skips the webhook server when BOT_WEBHOOK_SECRET is unset", async () => {
    const { result, startAt } = await bootAndReady({ BOT_WEBHOOK_SECRET: undefined });
    await result;
    expect(h.state.calls.slice(startAt)).toEqual(STARTUP_ORDER.filter((c) => !c.startsWith("startWebhookServer")));
  });

  it("logs and survives a failed startup honeypot sync", async () => {
    h.state.fail.add("HoneypotWarningSync.syncAll");
    const { result } = await bootAndReady();
    await expect(result).resolves.toBeUndefined();
    const last = h.state.logs.at(-1)!;
    expect(last.level).toBe("error");
    expect(last.args[1]).toBe("Startup honeypot warning sync failed");
    expect(Object.keys(last.args[0] as object)).toEqual(["err"]);
    expect(((last.args[0] as { err: Error }).err).message).toBe("HoneypotWarningSync.syncAll failed");
  });

  it("rejects (and stops) when the startup birthday check throws, after the webhook and timer started", async () => {
    h.state.fail.add("BirthdayChecker.check");
    const { result, startAt } = await bootAndReady();
    await expect(result).rejects.toThrow("BirthdayChecker.check failed");
    expect(h.state.calls.slice(startAt)).toEqual(STARTUP_ORDER.slice(0, STARTUP_ORDER.indexOf("BirthdayChecker.check") + 1));
  });

  it("rejects before anything else when hydrateAll throws", async () => {
    h.state.fail.add("GuildService.hydrateAll");
    const { result, startAt } = await bootAndReady();
    await expect(result).rejects.toThrow("GuildService.hydrateAll failed");
    expect(h.state.calls.slice(startAt)).toEqual(["log.info:Bot is online", "GuildService.hydrateAll"]);
  });
});

describe("4-hour sync timer", () => {
  async function armed() {
    const { result } = await bootAndReady();
    await result;
    const startAt = h.state.calls.length;
    h.state.logs.length = 0;
    return startAt;
  }

  it("flushes, rehydrates, reloads, checks, logs, then syncs honeypot warnings", async () => {
    const startAt = await armed();
    await h.state.intervalFn!();
    expect(h.state.calls.slice(startAt)).toEqual([
      "XpService.flush",
      "GuildService.hydrateAll",
      "SchedulerManager.reload",
      "BirthdayChecker.check",
      "YouTubeChecker.check",
      "log.info:Periodic sync complete (XP flush + guild settings + schedule reload + birthday check + YouTube check)",
      "HoneypotWarningSync.syncAll[sched=1,hw=1]",
    ]);
  });

  it("logs a failed step, skips the rest of the first block and still syncs honeypot warnings", async () => {
    const startAt = await armed();
    h.state.fail.add("SchedulerManager.reload");
    await h.state.intervalFn!();
    expect(h.state.calls.slice(startAt)).toEqual([
      "XpService.flush",
      "GuildService.hydrateAll",
      "SchedulerManager.reload",
      "log.error:Periodic sync failed",
      "HoneypotWarningSync.syncAll[sched=1,hw=1]",
    ]);
    expect(Object.keys(h.state.logs[0].args[0] as object)).toEqual(["err"]);
  });

  it("logs a failed honeypot sync separately", async () => {
    const startAt = await armed();
    h.state.fail.add("HoneypotWarningSync.syncAll");
    await expect(h.state.intervalFn!()).resolves.toBeUndefined();
    expect(h.state.calls.slice(startAt).at(-1)).toBe("log.error:Periodic honeypot warning sync failed");
    expect(Object.keys(h.state.logs.at(-1)!.args[0] as object)).toEqual(["err"]);
  });
});

describe("shutdown and crash handlers", () => {
  it("SIGTERM: deadline, drain, destroy, flush, log, clear deadline, exit 0; a second signal is ignored", async () => {
    await boot();
    const startAt = h.state.calls.length;
    expect(procHandlers.SIGTERM()).toBeUndefined();
    for (let n = 0; n < 3; n++) await tick();
    procHandlers.SIGINT();
    for (let n = 0; n < 3; n++) await tick();
    expect(h.state.calls.slice(startAt)).toEqual([
      "log.info:Shutting down...",
      "setTimeout:8000",
      "HoneypotService.drain",
      "client.destroy",
      "XpService.flush",
      "log.info:XP data flushed to database",
      "clearTimeout:deadline",
      "exit:0",
    ]);
    expect(h.state.logs[0].args).toEqual([{ signal: "SIGTERM" }, "Shutting down..."]);
    expect(h.state.instances.HoneypotService.drain).toHaveBeenCalledWith(5_000);
  });

  it("SIGINT passes its signal name", async () => {
    await boot();
    procHandlers.SIGINT();
    for (let n = 0; n < 3; n++) await tick();
    expect(h.state.logs[0].args).toEqual([{ signal: "SIGINT" }, "Shutting down..."]);
  });

  it("a failed flush during shutdown is logged and still exits 0", async () => {
    await boot();
    h.state.fail.add("XpService.flush");
    const startAt = h.state.calls.length;
    procHandlers.SIGTERM();
    for (let n = 0; n < 3; n++) await tick();
    expect(h.state.calls.slice(startAt)).toEqual([
      "log.info:Shutting down...",
      "setTimeout:8000",
      "HoneypotService.drain",
      "client.destroy",
      "XpService.flush",
      "log.error:Failed to flush XP during shutdown",
      "clearTimeout:deadline",
      "exit:0",
    ]);
    expect(Object.keys(h.state.logs.at(-1)!.args[0] as object)).toEqual(["err"]);
  });

  it("the shutdown deadline warns and exits 1", async () => {
    await boot();
    procHandlers.SIGTERM();
    const startAt = h.state.calls.length;
    h.state.deadlineFn!();
    expect(h.state.calls.slice(startAt, startAt + 2)).toEqual([
      "log.warn:Shutdown timed out — exiting without flush",
      "exit:1",
    ]);
  });

  it("uncaughtException logs fatal with err, flushes and exits 1", async () => {
    await boot();
    const startAt = h.state.calls.length;
    const err = new Error("boom");
    const ret = procHandlers.uncaughtException(err);
    expect(ret).toBeInstanceOf(Promise);
    await ret;
    expect(h.state.calls.slice(startAt)).toEqual([
      "log.fatal:Uncaught exception — flushing XP before exit",
      "XpService.flush",
      "exit:1",
    ]);
    expect(h.state.logs[0].args).toEqual([{ err }, "Uncaught exception — flushing XP before exit"]);
  });

  it("unhandledRejection logs fatal with reason, flushes and exits 1", async () => {
    await boot();
    const startAt = h.state.calls.length;
    const reason = "nope";
    await procHandlers.unhandledRejection(reason);
    expect(h.state.calls.slice(startAt)).toEqual([
      "log.fatal:Unhandled rejection — flushing XP before exit",
      "XpService.flush",
      "exit:1",
    ]);
    expect(h.state.logs[0].args).toEqual([{ reason }, "Unhandled rejection — flushing XP before exit"]);
  });

  it.each(["uncaughtException", "unhandledRejection"])("%s: a failed flush is logged and still exits 1", async (ev) => {
    await boot();
    h.state.fail.add("XpService.flush");
    const startAt = h.state.calls.length;
    await procHandlers[ev](new Error("x"));
    expect(h.state.calls.slice(startAt + 1)).toEqual([
      "XpService.flush",
      "log.error:Failed to flush XP during crash",
      "exit:1",
    ]);
    const errLog = h.state.logs.at(-1)!;
    expect(Object.keys(errLog.args[0] as object)).toEqual(["err"]);
    expect(((errLog.args[0] as { err: Error }).err).message).toBe("XpService.flush failed");
  });
});

void SRC_DIR;
