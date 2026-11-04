import { beforeEach, describe, expect, it, vi } from "vitest";

// A guild_admins manager's grants for the current test. The mocked
// checkGuildPermission applies the same rule as the real one: no scope means
// any grant is enough, otherwise the scope (or "*") must be granted.
const state = vi.hoisted(() => ({ grants: [] as string[] }));

const { checkGuildPermission } = vi.hoisted(() => ({
  checkGuildPermission: vi.fn(async (_guildId: string, _userId: string, scope?: string) => {
    if (state.grants.length === 0) return false;
    if (state.grants.includes("*")) return true;
    if (!scope) return true;
    return state.grants.includes(scope);
  }),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => "111111111111111111") }));
vi.mock("@/lib/discord", () => ({ checkGuildPermission }));
vi.mock("@/lib/bot-webhook", () => ({ notifyBotReload: vi.fn(async () => undefined) }));

vi.mock("@/lib/db", () => {
  // Any chain of query-builder calls resolves to an empty result set.
  const fn = () => proxy;
  const proxy: unknown = new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve([]);
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return { db: proxy };
});

const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
vi.stubGlobal("fetch", fetchMock);

import * as schedules from "@/app/api/server/[guildId]/schedules/route";
import * as schedule from "@/app/api/server/[guildId]/schedules/[scheduleId]/route";
import * as youtube from "@/app/api/server/[guildId]/youtube/route";
import * as youtubeResolve from "@/app/api/server/[guildId]/youtube/resolve/route";
import * as subscription from "@/app/api/server/[guildId]/youtube/[subscriptionId]/route";
import * as suggestionsList from "@/app/api/server/[guildId]/suggestions/route";
import * as suggestion from "@/app/api/server/[guildId]/suggestions/[suggestionId]/route";

const GUILD = "222222222222222222";
const UUID = "123e4567-e89b-12d3-a456-426614174000";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown) {
  const req = new Request(`http://localhost/api/server/${GUILD}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return (handler as Handler)(req, { params: Promise.resolve({ guildId: GUILD, ...params }) });
}

const writes: { name: string; scope: string; handler: unknown; method: string; params: Record<string, string>; afterGate: number }[] = [
  { name: "schedules POST", scope: "schedules", handler: schedules.POST, method: "POST", params: {}, afterGate: 400 },
  { name: "schedules/[id] PATCH", scope: "schedules", handler: schedule.PATCH, method: "PATCH", params: { scheduleId: UUID }, afterGate: 404 },
  { name: "schedules/[id] DELETE", scope: "schedules", handler: schedule.DELETE, method: "DELETE", params: { scheduleId: UUID }, afterGate: 404 },
  { name: "youtube POST", scope: "youtube", handler: youtube.POST, method: "POST", params: {}, afterGate: 400 },
  { name: "youtube/resolve POST", scope: "youtube", handler: youtubeResolve.POST, method: "POST", params: {}, afterGate: 400 },
  { name: "youtube/[id] PATCH", scope: "youtube", handler: subscription.PATCH, method: "PATCH", params: { subscriptionId: UUID }, afterGate: 404 },
  { name: "youtube/[id] DELETE", scope: "youtube", handler: subscription.DELETE, method: "DELETE", params: { subscriptionId: UUID }, afterGate: 404 },
  { name: "suggestions/[id] PATCH", scope: "suggestions", handler: suggestion.PATCH, method: "PATCH", params: { suggestionId: UUID }, afterGate: 400 },
  { name: "suggestions/[id] DELETE", scope: "suggestions", handler: suggestion.DELETE, method: "DELETE", params: { suggestionId: UUID }, afterGate: 404 },
];

const reads: { name: string; handler: unknown }[] = [
  { name: "schedules GET", handler: schedules.GET },
  { name: "youtube GET", handler: youtube.GET },
  { name: "suggestions GET", handler: suggestionsList.GET },
];

beforeEach(() => {
  state.grants = [];
  checkGuildPermission.mockClear();
});

describe("feature write routes require their own scope (B1)", () => {
  for (const w of writes) {
    it(`${w.name}: a manager without "${w.scope}" gets the unchanged 403`, async () => {
      state.grants = ["welcome"];
      // An empty body: a handler that passed the gate would answer 400, not 403.
      const res = await call(w.handler, w.method, w.params, w.method === "DELETE" ? undefined : {});
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
      expect(checkGuildPermission).toHaveBeenCalledWith(GUILD, "111111111111111111", w.scope);
    });

    it(`${w.name}: a manager with "${w.scope}" passes the permission gate`, async () => {
      state.grants = [w.scope];
      const res = await call(w.handler, w.method, w.params, w.method === "DELETE" ? undefined : {});
      // The empty body or the empty mocked db answers next: 400 or 404, never 403.
      expect(res.status).toBe(w.afterGate);
      expect(checkGuildPermission).toHaveBeenCalledWith(GUILD, "111111111111111111", w.scope);
    });

    it(`${w.name}: "*" passes the permission gate`, async () => {
      state.grants = ["*"];
      const res = await call(w.handler, w.method, w.params, w.method === "DELETE" ? undefined : {});
      // The empty body or the empty mocked db answers next: 400 or 404, never 403.
      expect(res.status).toBe(w.afterGate);
      expect(checkGuildPermission).toHaveBeenCalledWith(GUILD, "111111111111111111", w.scope);
    });
  }
});

describe("feature read routes accept any grant", () => {
  for (const r of reads) {
    it(`${r.name}: a manager with an unrelated scope can read`, async () => {
      state.grants = ["welcome"];
      const res = await call(r.handler, "GET", {});
      expect(res.status).toBe(200);
      expect(checkGuildPermission).toHaveBeenCalledWith(GUILD, "111111111111111111");
    });

    it(`${r.name}: a user with no grant gets 403`, async () => {
      state.grants = [];
      const res = await call(r.handler, "GET", {});
      expect(res.status).toBe(403);
    });
  }
});
