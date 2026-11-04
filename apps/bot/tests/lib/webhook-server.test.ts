import { afterEach, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "pino";
import { startWebhookServer } from "../../src/lib/webhook-server.js";
import type { GuildService } from "../../src/services/guild.service.js";
import type { SchedulerManager } from "../../src/lib/scheduler.js";

// The bot's webhook server (P16). The first block is characterization of the
// pre-P16 behaviour; the "scope hint" block is new with P16.

const SECRET = "s3cret-s3cret-s3cret";
const GUILD = "222222222222222222";

function setup(opts: { scheduler?: boolean; getSettingsFails?: boolean } = {}) {
  const calls: string[] = [];
  const guildService = {
    invalidateCache: vi.fn((id: string) => void calls.push(`invalidate:${id}`)),
    getSettings: vi.fn(async (id: string) => {
      calls.push(`getSettings:${id}`);
      if (opts.getSettingsFails) throw new Error("db down");
      return {};
    }),
    hydrateAll: vi.fn(async () => void calls.push("hydrateAll")),
  };
  const scheduler = { reload: vi.fn(async () => void calls.push("reload")) };
  const onGuildReload = vi.fn(async (id: string | null) => void calls.push(`onGuildReload:${id}`));
  const logs: { level: string; args: unknown[] }[] = [];
  const child = {
    info: (...args: unknown[]) => logs.push({ level: "info", args }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args }),
    error: (...args: unknown[]) => logs.push({ level: "error", args }),
  };
  const logger = { child: vi.fn(() => child) } as unknown as Logger;
  const server = startWebhookServer({
    port: 0,
    secret: SECRET,
    guildService: guildService as unknown as GuildService,
    logger,
    getScheduler: () => (opts.scheduler === false ? undefined : (scheduler as unknown as SchedulerManager)),
    onGuildReload,
  });
  return { server, guildService, scheduler, onGuildReload, calls, logs };
}

let current: http.Server | undefined;
afterEach(async () => {
  if (current) await new Promise<void>((r) => current!.close(() => r()));
  current = undefined;
});

async function request(server: http.Server, method: string, path: string, auth: string | null = `Bearer ${SECRET}`) {
  current = server;
  if (!server.listening) await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const headers: Record<string, string> = {};
  if (auth !== null) headers.authorization = auth;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
  return { status: res.status, body: await res.text(), type: res.headers.get("content-type") };
}

describe("webhook server (characterization)", () => {
  it("GET /health needs no auth", async () => {
    const { server } = setup();
    expect(await request(server, "GET", "/health", null)).toEqual({ status: 200, body: '{"status":"ok"}', type: "application/json" });
  });

  it("401 without or with a wrong bearer", async () => {
    const { server, scheduler } = setup();
    expect(await request(server, "POST", `/webhook/reload?guildId=${GUILD}`, null)).toEqual({ status: 401, body: '{"error":"Unauthorized"}', type: "application/json" });
    expect((await request(server, "POST", `/webhook/reload?guildId=${GUILD}`, "Bearer nope")).status).toBe(401);
    expect(scheduler.reload).not.toHaveBeenCalled();
  });

  it("reload one guild: invalidate, getSettings, scheduler.reload, honeypot sync, 200", async () => {
    const { server, calls, logs } = setup();
    const res = await request(server, "POST", `/webhook/reload?guildId=${GUILD}`);
    expect(res).toEqual({ status: 200, body: '{"success":true}', type: "application/json" });
    expect(calls).toEqual([`invalidate:${GUILD}`, `getSettings:${GUILD}`, "reload", `onGuildReload:${GUILD}`]);
    expect(logs.filter((l) => l.level === "info").map((l) => l.args)).toContainEqual([{ guildId: GUILD }, "Guild settings reloaded via webhook"]);
  });

  it("no guildId: hydrateAll, reload, honeypot sync for all", async () => {
    const { server, calls } = setup();
    expect((await request(server, "POST", "/webhook/reload")).status).toBe(200);
    expect(calls).toEqual(["hydrateAll", "reload", "onGuildReload:null"]);
  });

  it("invalid guildId: 400 and nothing reloaded", async () => {
    const { server, calls } = setup();
    expect(await request(server, "POST", "/webhook/reload?guildId=abc")).toEqual({ status: 400, body: '{"error":"Invalid guildId format"}', type: "application/json" });
    expect(calls).toEqual([]);
  });

  it("no scheduler yet: still 200", async () => {
    const { server, calls } = setup({ scheduler: false });
    expect((await request(server, "POST", `/webhook/reload?guildId=${GUILD}`)).status).toBe(200);
    expect(calls).toEqual([`invalidate:${GUILD}`, `getSettings:${GUILD}`, `onGuildReload:${GUILD}`]);
  });

  it("a failed getSettings: 500, no reload", async () => {
    const { server, calls, logs } = setup({ getSettingsFails: true });
    expect(await request(server, "POST", `/webhook/reload?guildId=${GUILD}`)).toEqual({ status: 500, body: '{"error":"Internal error"}', type: "application/json" });
    expect(calls).toEqual([`invalidate:${GUILD}`, `getSettings:${GUILD}`]);
    expect(logs.find((l) => l.level === "error")?.args[1]).toBe("Webhook reload failed");
  });

  it("other paths: 404", async () => {
    const { server } = setup();
    expect(await request(server, "GET", "/webhook/reload")).toEqual({ status: 404, body: '{"error":"Not found"}', type: "application/json" });
    expect((await request(server, "POST", "/other")).status).toBe(404);
  });

  it("unknown or empty scope values still reload schedules", async () => {
    for (const scope of ["", "schedules", "youtube", "garbage", "SETTINGS"]) {
      const { server, calls } = setup();
      expect((await request(server, "POST", `/webhook/reload?guildId=${GUILD}&scope=${scope}`)).status).toBe(200);
      expect(calls).toEqual([`invalidate:${GUILD}`, `getSettings:${GUILD}`, "reload", `onGuildReload:${GUILD}`]);
      await new Promise<void>((r) => server.close(() => r()));
      current = undefined;
    }
  });
});

describe("webhook server scope hint (P16)", () => {
  it("scope=settings reloads the guild and syncs the honeypot but skips scheduler.reload", async () => {
    const { server, calls } = setup();
    const res = await request(server, "POST", `/webhook/reload?guildId=${GUILD}&scope=settings`);
    expect(res).toEqual({ status: 200, body: '{"success":true}', type: "application/json" });
    expect(calls).toEqual([`invalidate:${GUILD}`, `getSettings:${GUILD}`, `onGuildReload:${GUILD}`]);
  });

  it("scope=settings with a bad guildId is still a 400", async () => {
    const { server, calls } = setup();
    expect((await request(server, "POST", "/webhook/reload?guildId=abc&scope=settings")).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
