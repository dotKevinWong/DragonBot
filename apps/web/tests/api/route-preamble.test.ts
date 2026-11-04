import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of every guild route's preamble (D1): the exact 401, 404,
// 403 and "Invalid data" 400 bodies, their key order, the check order
// (auth -> params -> id check -> permission) and the permission call's
// arguments. Recorded on the pre-refactor code; must pass unchanged after.

const USER = "111111111111111111";
const GUILD = "222222222222222222";
const UUID = "123e4567-e89b-12d3-a456-426614174000";

const state = vi.hoisted(() => ({
  user: "111111111111111111" as string | null,
  allowed: true,
  perms: ["*"] as string[],
  member: true,
  log: [] as string[],
}));

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(async () => {
    state.log.push("auth");
    return state.user;
  }),
  checkGuildPermission: vi.fn(async (..._args: unknown[]) => {
    state.log.push("perm");
    return state.allowed;
  }),
  getUserGuildPermissions: vi.fn(async (..._args: unknown[]) => {
    state.log.push("perm");
    return state.perms;
  }),
  isGuildMember: vi.fn(async (..._args: unknown[]) => {
    state.log.push("perm");
    return state.member;
  }),
  resolveDiscordUsers: vi.fn(async () => new Map()),
  getGuildIconUrl: vi.fn(async () => null),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock("@/lib/discord", () => ({
  checkGuildPermission: mocks.checkGuildPermission,
  getUserGuildPermissions: mocks.getUserGuildPermissions,
  isGuildMember: mocks.isGuildMember,
  resolveDiscordUsers: mocks.resolveDiscordUsers,
  getGuildIconUrl: mocks.getGuildIconUrl,
}));
vi.mock("@/lib/bot-webhook", () => ({ notifyBotReload: vi.fn(async () => undefined) }));
vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));

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

vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })),
);

import * as guildRoute from "@/app/api/server/[guildId]/route";
import * as discordRoute from "@/app/api/server/[guildId]/discord/route";
import * as schedules from "@/app/api/server/[guildId]/schedules/route";
import * as schedule from "@/app/api/server/[guildId]/schedules/[scheduleId]/route";
import * as youtube from "@/app/api/server/[guildId]/youtube/route";
import * as youtubeResolve from "@/app/api/server/[guildId]/youtube/resolve/route";
import * as subscription from "@/app/api/server/[guildId]/youtube/[subscriptionId]/route";
import * as suggestionsList from "@/app/api/server/[guildId]/suggestions/route";
import * as suggestion from "@/app/api/server/[guildId]/suggestions/[suggestionId]/route";
import * as serverLeaderboard from "@/app/api/server/[guildId]/leaderboard/route";
import * as profile from "@/app/api/profile/route";
import * as guildsRoute from "@/app/api/guilds/route";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** A params "promise" that records when the handler awaits it. */
function trackedParams(values: Record<string, string>): Promise<Record<string, string>> {
  return {
    then(resolve: (v: Record<string, string>) => unknown, reject?: (e: unknown) => unknown) {
      state.log.push("params");
      return Promise.resolve(values).then(resolve, reject);
    },
  } as unknown as Promise<Record<string, string>>;
}

async function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown) {
  const req = new Request(`http://localhost/api/server/${GUILD}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await (handler as Handler)(req, { params: trackedParams(params) });
  return { status: res.status, text: await res.text() };
}

const A401 = '{"error":"Unauthorized"}';
const A403 = '{"error":"Forbidden"}';
const B401 = '{"error":"Unauthorized","code":"UNAUTHORIZED"}';
const B403 = '{"error":"Forbidden","code":"UNAUTHORIZED"}';
const NOT_FOUND = '{"error":"Not found","code":"NOT_FOUND"}';
const SERVER_NOT_FOUND = '{"error":"Server not found","code":"NOT_FOUND"}';

interface RouteCase {
  name: string;
  handler: unknown;
  method: string;
  extra?: string; // name of the extra UUID param
  unauthorized: string;
  notFound: string;
  forbidden: string;
  /** The permission check the route makes: which mock, and its exact args after (guildId, user). */
  perm: "check" | "perms" | "member";
  scope?: string;
  /** Body sent past the guard to reach a 400 "Invalid data" (undefined: none). */
  invalid?: { body: unknown; withCode: boolean };
}

const routes: RouteCase[] = [
  // [guildId] GET calls getUserGuildPermissions itself (B1 follow-up, to return viewerScopes): the same
  // lookup checkGuildPermission(guildId, user) made, which is grantsScope(getUserGuildPermissions(...)).
  { name: "[guildId] GET", handler: guildRoute.GET, method: "GET", unauthorized: B401, notFound: SERVER_NOT_FOUND, forbidden: B403, perm: "perms" },
  { name: "[guildId] PATCH", handler: guildRoute.PATCH, method: "PATCH", unauthorized: B401, notFound: SERVER_NOT_FOUND, forbidden: B403, perm: "perms", invalid: { body: { xpMin: "x" }, withCode: true } },
  { name: "discord GET", handler: discordRoute.GET, method: "GET", unauthorized: B401, notFound: NOT_FOUND, forbidden: B403, perm: "check" },
  { name: "schedules GET", handler: schedules.GET, method: "GET", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check" },
  { name: "schedules POST", handler: schedules.POST, method: "POST", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "schedules", invalid: { body: {}, withCode: false } },
  { name: "schedules/[id] PATCH", handler: schedule.PATCH, method: "PATCH", extra: "scheduleId", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "schedules", invalid: { body: { message: "" }, withCode: false } },
  { name: "schedules/[id] DELETE", handler: schedule.DELETE, method: "DELETE", extra: "scheduleId", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "schedules" },
  { name: "youtube GET", handler: youtube.GET, method: "GET", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check" },
  { name: "youtube POST", handler: youtube.POST, method: "POST", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "youtube", invalid: { body: {}, withCode: false } },
  { name: "youtube/resolve POST", handler: youtubeResolve.POST, method: "POST", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "youtube" },
  { name: "youtube/[id] PATCH", handler: subscription.PATCH, method: "PATCH", extra: "subscriptionId", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "youtube", invalid: { body: { isEnabled: "x" }, withCode: false } },
  { name: "youtube/[id] DELETE", handler: subscription.DELETE, method: "DELETE", extra: "subscriptionId", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "youtube" },
  { name: "suggestions GET", handler: suggestionsList.GET, method: "GET", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check" },
  { name: "suggestions/[id] PATCH", handler: suggestion.PATCH, method: "PATCH", extra: "suggestionId", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "suggestions", invalid: { body: { status: "nope" }, withCode: false } },
  { name: "suggestions/[id] DELETE", handler: suggestion.DELETE, method: "DELETE", extra: "suggestionId", unauthorized: A401, notFound: NOT_FOUND, forbidden: A403, perm: "check", scope: "suggestions" },
  { name: "leaderboard GET", handler: serverLeaderboard.GET, method: "GET", unauthorized: B401, notFound: NOT_FOUND, forbidden: '{"error":"Forbidden","code":"FORBIDDEN"}', perm: "member" },
];

function deny() {
  state.allowed = false;
  state.perms = [];
  state.member = false;
}

function permMock(perm: RouteCase["perm"]) {
  return perm === "check" ? mocks.checkGuildPermission : perm === "perms" ? mocks.getUserGuildPermissions : mocks.isGuildMember;
}

function validParams(r: RouteCase) {
  return { guildId: GUILD, ...(r.extra && { [r.extra]: UUID }) };
}

function bodyFor(r: RouteCase) {
  return r.method === "GET" || r.method === "DELETE" ? undefined : {};
}

beforeEach(() => {
  state.user = USER;
  state.allowed = true;
  state.perms = ["*"];
  state.member = true;
  state.log = [];
  for (const m of Object.values(mocks)) m.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guild route preamble bodies and order (D1)", () => {
  for (const r of routes) {
    describe(r.name, () => {
      it("401: exact body, params never awaited, no permission check", async () => {
        state.user = null;
        const res = await call(r.handler, r.method, validParams(r), bodyFor(r));
        expect(res).toEqual({ status: 401, text: r.unauthorized });
        expect(state.log).toEqual(["auth"]);
      });

      it("404: malformed guildId, exact body, no permission check", async () => {
        const res = await call(r.handler, r.method, { ...validParams(r), guildId: "abc" }, bodyFor(r));
        expect(res).toEqual({ status: 404, text: r.notFound });
        expect(state.log).toEqual(["auth", "params"]);
      });

      if (r.extra) {
        it(`404: malformed ${r.extra}, exact body, no permission check`, async () => {
          const res = await call(r.handler, r.method, { ...validParams(r), [r.extra!]: "not-a-uuid" }, bodyFor(r));
          expect(res).toEqual({ status: 404, text: r.notFound });
          expect(state.log).toEqual(["auth", "params"]);
        });

        it(`${r.extra} UUID check is case-insensitive`, async () => {
          deny();
          const res = await call(r.handler, r.method, { ...validParams(r), [r.extra!]: UUID.toUpperCase() }, bodyFor(r));
          expect(res.status).toBe(403);
        });
      }

      it("403: exact body, order auth -> params -> permission", async () => {
        deny();
        const res = await call(r.handler, r.method, validParams(r), bodyFor(r));
        expect(res).toEqual({ status: 403, text: r.forbidden });
        // discord GET looks up guild_admins (mocked db, no log entry) before the check
        expect(state.log).toEqual(["auth", "params", "perm"]);
      });

      it("permission check gets exactly (guildId, user[, scope])", async () => {
        deny();
        await call(r.handler, r.method, validParams(r), bodyFor(r));
        const m = permMock(r.perm);
        expect(m).toHaveBeenCalledTimes(1);
        expect(m.mock.calls[0]).toEqual(r.scope ? [GUILD, USER, r.scope] : [GUILD, USER]);
      });

      if (r.invalid) {
        const inv = r.invalid;
        it("400 Invalid data in development: error, [code], details in that order", async () => {
          vi.stubEnv("NODE_ENV", "development");
          const res = await call(r.handler, r.method, validParams(r), inv.body);
          expect(res.status).toBe(400);
          const parsed = JSON.parse(res.text);
          expect(Object.keys(parsed)).toEqual(inv.withCode ? ["error", "code", "details"] : ["error", "details"]);
          expect(parsed.error).toBe("Invalid data");
          if (inv.withCode) expect(parsed.code).toBe("VALIDATION_ERROR");
          expect(Array.isArray(parsed.details)).toBe(true);
          expect(parsed.details.length).toBeGreaterThan(0);
        });

        it("400 Invalid data in production: no details", async () => {
          vi.stubEnv("NODE_ENV", "production");
          const res = await call(r.handler, r.method, validParams(r), inv.body);
          expect(res).toEqual({
            status: 400,
            text: inv.withCode ? '{"error":"Invalid data","code":"VALIDATION_ERROR"}' : '{"error":"Invalid data"}',
          });
        });
      }
    });
  }
});

describe("profile and guilds routes", () => {
  it("profile GET 401", async () => {
    state.user = null;
    const res = await (profile.GET as (r: Request) => Promise<Response>)(new Request("http://localhost/api/profile"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(B401);
  });

  it("profile PATCH 401", async () => {
    state.user = null;
    const res = await profile.PATCH(new Request("http://localhost/api/profile", { method: "PATCH", body: "{}" }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(B401);
  });

  it("profile PATCH invalid data (development) keeps error, code, details", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await profile.PATCH(
      new Request("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify({ birthMonth: 13 }) }),
    );
    expect(res.status).toBe(400);
    const parsed = JSON.parse(await res.text());
    expect(Object.keys(parsed)).toEqual(["error", "code", "details"]);
    expect(parsed.error).toBe("Invalid data");
    expect(parsed.code).toBe("VALIDATION_ERROR");
  });

  it("profile PATCH invalid data (production) has no details", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await profile.PATCH(
      new Request("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify({ birthMonth: 13 }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"Invalid data","code":"VALIDATION_ERROR"}');
  });

  it("guilds GET 401", async () => {
    state.user = null;
    const res = await guildsRoute.GET(new Request("http://localhost/api/guilds"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(B401);
  });
});
