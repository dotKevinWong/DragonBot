import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of the two leaderboard routes (P3, D6), with the real
// lib/discord.ts and a mocked fetch: the exact response bodies, statuses, key
// order, the user_xp query shape and the per-user Discord resolution.
// Recorded on the pre-refactor code; must pass unchanged after.

const GUILD = "222222222222222222";
const USER = "111111111111111111";

const state = vi.hoisted(() => ({
  user: "111111111111111111" as string | null,
  guildRows: [{ guildName: "Dragon Den" }] as { guildName: string | null }[],
  xpRows: [] as Record<string, unknown>[],
  queries: [] as { fields: string[]; calls: string[]; limit?: number }[],
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => state.user) }));
vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
      const q = { fields: Object.keys(fields), calls: ["select"] as string[], limit: undefined as number | undefined };
      state.queries.push(q);
      const isGuild = "guildName" in fields;
      const chain = {
        from: () => (q.calls.push("from"), chain),
        where: () => (q.calls.push("where"), chain),
        orderBy: () => (q.calls.push("orderBy"), chain),
        limit: async (n: number) => {
          q.calls.push("limit");
          q.limit = n;
          return isGuild ? state.guildRows : state.xpRows;
        },
      };
      return chain;
    },
  },
}));

type Responder = (url: string) => Response | Promise<Response>;
const fetchState = { respond: (() => new Response("", { status: 404 })) as Responder };
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => fetchState.respond(url));
vi.stubGlobal("fetch", fetchMock);

import { GET as publicGET } from "@/app/api/leaderboard/[guildId]/route";
import { GET as memberGET } from "@/app/api/server/[guildId]/leaderboard/route";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const params = (guildId: string) => ({ params: Promise.resolve({ guildId }) });
const req = () => new Request("http://localhost/x");

let seq = 0;
/** A fresh id per test so the module-level user cache never leaks between tests. */
const freshId = () => `7${String(Date.now()).slice(-8)}${String(++seq).padStart(8, "0")}`;

function xpRow(discordId: string, totalXp: number) {
  // Deliberately not in the select's key order, to pin that the route keeps the row's own order
  return { discordId, totalXp, level: Math.floor(totalXp / 100), messageCount: totalXp + 1, xpMessageCount: totalXp + 2 };
}

let ids: { ok: string; okNoGlobal: string; okNoAvatar: string; animated: string; gone: string; limited: string; throws: string };

beforeEach(() => {
  fetchMock.mockClear();
  state.user = USER;
  state.guildRows = [{ guildName: "Dragon Den" }];
  state.queries = [];
  ids = {
    ok: freshId(),
    okNoGlobal: freshId(),
    okNoAvatar: freshId(),
    animated: freshId(),
    gone: freshId(),
    limited: freshId(),
    throws: freshId(),
  };
  state.xpRows = [
    xpRow(ids.ok, 900),
    xpRow(ids.okNoGlobal, 800),
    xpRow(ids.okNoAvatar, 700),
    xpRow(ids.animated, 600),
    xpRow(ids.gone, 500),
    xpRow(ids.limited, 400),
    xpRow(ids.throws, 300),
  ];
  fetchState.respond = (url) => {
    if (url === `https://discord.com/api/v10/guilds/${GUILD}/members/${USER}`) return json({ user: { id: USER }, roles: [] });
    const id = url.split("/").pop()!;
    if (id === ids.ok) return json({ id, username: "alice", global_name: "Alice", avatar: "abc" });
    if (id === ids.okNoGlobal) return json({ id, username: "bob", global_name: null, avatar: "def" });
    if (id === ids.okNoAvatar) return json({ id, username: "carol", global_name: "", avatar: null });
    if (id === ids.animated) return json({ id, username: "dan", global_name: "Dan", avatar: "a_xyz" });
    if (id === ids.gone) return new Response("", { status: 404 });
    if (id === ids.limited) return new Response("", { status: 429 });
    throw new Error("network down");
  };
});

function expectedEntries() {
  const avatar = (id: string, hash: string) => `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
  return [
    { ...xpRow(ids.ok, 900), displayName: "Alice", avatarUrl: avatar(ids.ok, "abc") },
    { ...xpRow(ids.okNoGlobal, 800), displayName: "bob", avatarUrl: avatar(ids.okNoGlobal, "def") },
    { ...xpRow(ids.okNoAvatar, 700), displayName: "", avatarUrl: null },
    { ...xpRow(ids.animated, 600), displayName: "Dan", avatarUrl: avatar(ids.animated, "a_xyz") },
    { ...xpRow(ids.gone, 500), displayName: ids.gone, avatarUrl: null },
    { ...xpRow(ids.limited, 400), displayName: ids.limited, avatarUrl: null },
    { ...xpRow(ids.throws, 300), displayName: ids.throws, avatarUrl: null },
  ];
}

const XP_FIELDS = ["discordId", "totalXp", "level", "messageCount", "xpMessageCount"];
const XP_CALLS = ["select", "from", "where", "orderBy", "limit"];

describe("GET /api/leaderboard/[guildId] (public)", () => {
  it("returns {guildName, entries} with the exact body text", async () => {
    const res = await publicGET(req(), params(GUILD));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ guildName: "Dragon Den", entries: expectedEntries() }));
    expect(state.queries).toHaveLength(2);
    expect(state.queries[0]).toEqual({ fields: ["guildName"], calls: ["select", "from", "where", "limit"], limit: 1 });
    expect(state.queries[1]).toEqual({ fields: XP_FIELDS, calls: XP_CALLS, limit: 100 });
  });

  it("404 Guild not found for a bad snowflake, before any query", async () => {
    const res = await publicGET(req(), params("not-a-snowflake"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Guild not found"}');
    expect(state.queries).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404 Guild not found for an unknown guild, without the xp query", async () => {
    state.guildRows = [];
    const res = await publicGET(req(), params(GUILD));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Guild not found"}');
    expect(state.queries).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("null guildName and no rows", async () => {
    state.guildRows = [{ guildName: null }];
    state.xpRows = [];
    const res = await publicGET(req(), params(GUILD));
    expect(await res.text()).toBe('{"guildName":null,"entries":[]}');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/server/[guildId]/leaderboard (member)", () => {
  it("returns the bare array with the exact body text", async () => {
    const res = await memberGET(req(), params(GUILD));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedEntries()));
    expect(state.queries).toEqual([{ fields: XP_FIELDS, calls: XP_CALLS, limit: 100 }]);
    // member check first, then one GET /users/{id} per row
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://discord.com/api/v10/guilds/${GUILD}/members/${USER}`);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 7);
  });

  it("401, then 404, then 403, each with its code", async () => {
    state.user = null;
    let res = await memberGET(req(), params(GUILD));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"error":"Unauthorized","code":"UNAUTHORIZED"}');

    state.user = USER;
    res = await memberGET(req(), params("nope"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Not found","code":"NOT_FOUND"}');

    fetchState.respond = () => new Response("", { status: 404 });
    res = await memberGET(req(), params(GUILD));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('{"error":"Forbidden","code":"FORBIDDEN"}');
    expect(state.queries).toHaveLength(0);
  });

  it("cache: a 404 user is cached as null, a 429 or thrown lookup is retried", async () => {
    await memberGET(req(), params(GUILD));
    fetchMock.mockClear();
    await memberGET(req(), params(GUILD));
    const userCalls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes("/users/"));
    expect(userCalls.map((u) => u.split("/").pop())).toEqual([ids.limited, ids.throws]);
  });

  it("sends the bot token to /users/{id}", async () => {
    state.xpRows = [xpRow(ids.ok, 1)];
    await memberGET(req(), params(GUILD));
    const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes("/users/"))!;
    expect(call[0]).toBe(`https://discord.com/api/v10/users/${ids.ok}`);
    expect(call[1]).toEqual({ headers: { Authorization: "Bot test-token" } });
  });
});
