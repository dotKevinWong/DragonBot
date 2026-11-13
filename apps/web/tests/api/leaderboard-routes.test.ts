import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of the two leaderboard routes (P3, D6), with the real
// lib/discord.ts and a mocked fetch: the exact response bodies, statuses, key
// order, the user_xp query shape and the per-user Discord resolution.
// Recorded on the pre-refactor code. Since November 2026 names also come from discord_user_cache
// (mocked here as state.cacheRows / state.upserts) and both routes take ?offset=&limit=.

const GUILD = "222222222222222222";
const USER = "111111111111111111";

const state = vi.hoisted(() => ({
  user: "111111111111111111" as string | null,
  guildRows: [{ guildName: "Dragon Den" }] as { guildName: string | null }[],
  xpRows: [] as Record<string, unknown>[],
  queries: [] as { fields: string[]; calls: string[]; limit?: number; offset?: number }[],
  cacheRows: [] as { discordId: string; username: string; displayName: string; avatarUrl: string | null; updatedAt: Date }[],
  cacheReads: [] as number[],
  upserts: [] as Record<string, unknown>[][],
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => state.user) }));
vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
      // The name cache read: select(...).from(discordUserCache).where(...), awaited directly
      if ("updatedAt" in fields) {
        const chain = {
          from: () => chain,
          where: async () => {
            state.cacheReads.push(1);
            return state.cacheRows;
          },
        };
        return chain;
      }
      const q = { fields: Object.keys(fields), calls: ["select"] as string[], limit: undefined as number | undefined } as {
        fields: string[]; calls: string[]; limit?: number; offset?: number;
      };
      state.queries.push(q);
      const isGuild = "guildName" in fields;
      const rows = () => (isGuild ? state.guildRows : state.xpRows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? Infinity)));
      const chain = {
        from: () => (q.calls.push("from"), chain),
        where: () => (q.calls.push("where"), chain),
        orderBy: () => (q.calls.push("orderBy"), chain),
        limit: (n: number) => {
          q.calls.push("limit");
          q.limit = n;
          // The guild query awaits limit(); the xp query adds offset()
          return {
            then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, bad),
            offset: async (o: number) => {
              q.calls.push("offset");
              q.offset = o;
              return rows();
            },
          };
        },
      };
      return chain;
    },
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: async () => {
          state.upserts.push(rows);
        },
      }),
    }),
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
  state.cacheRows = [];
  state.cacheReads = [];
  state.upserts = [];
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
const XP_CALLS = ["select", "from", "where", "orderBy", "limit", "offset"];

describe("GET /api/leaderboard/[guildId] (public)", () => {
  it("returns {guildName, entries} with the exact body text", async () => {
    const res = await publicGET(req(), params(GUILD));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ guildName: "Dragon Den", entries: expectedEntries() }));
    expect(state.queries).toHaveLength(2);
    expect(state.queries[0]).toEqual({ fields: ["guildName"], calls: ["select", "from", "where", "limit"], limit: 1 });
    expect(state.queries[1]).toEqual({ fields: XP_FIELDS, calls: XP_CALLS, limit: 100, offset: 0 });
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
    expect(state.queries).toEqual([{ fields: XP_FIELDS, calls: XP_CALLS, limit: 100, offset: 0 }]);
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

describe("stored names (discord_user_cache)", () => {
  const avatarOf = (id: string) => `https://cdn.discordapp.com/avatars/${id}/abc.png?size=64`;

  it("stores what it resolved, with no row for an unresolved user", async () => {
    await memberGET(req(), params(GUILD));
    expect(state.upserts).toHaveLength(1);
    const stored = state.upserts[0]!.map((r) => r.discordId);
    expect(stored).toEqual([ids.ok, ids.okNoGlobal, ids.okNoAvatar, ids.animated]);
    expect(state.upserts[0]![0]).toMatchObject({ discordId: ids.ok, username: "alice", displayName: "Alice", avatarUrl: avatarOf(ids.ok) });
  });

  it("uses a fresh stored name without calling Discord for it", async () => {
    state.xpRows = [xpRow(ids.gone, 10)];
    state.cacheRows = [{ discordId: ids.gone, username: "eve", displayName: "Eve", avatarUrl: null, updatedAt: new Date() }];
    const body = await (await memberGET(req(), params(GUILD))).json();
    expect(body[0].displayName).toBe("Eve");
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/users/"))).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });

  it("looks up a day-old name again, and keeps showing it if the lookup fails", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    state.xpRows = [xpRow(ids.ok, 20), xpRow(ids.throws, 10)];
    state.cacheRows = [
      { discordId: ids.ok, username: "old", displayName: "Old Alice", avatarUrl: null, updatedAt: old },
      { discordId: ids.throws, username: "fay", displayName: "Fay", avatarUrl: null, updatedAt: old },
    ];
    const body = await (await memberGET(req(), params(GUILD))).json();
    expect(body.map((e: { displayName: string }) => e.displayName)).toEqual(["Alice", "Fay"]);
    expect(state.upserts[0]!.map((r) => r.discordId)).toEqual([ids.ok]);
  });
});

describe("paging (?offset=&limit=)", () => {
  const paged = (q: string) => new Request(`http://localhost/x?${q}`);

  it("returns the requested slice and looks up names only for it", async () => {
    const res = await memberGET(paged("offset=2&limit=2"), params(GUILD));
    const body = await res.json();
    expect(body.map((e: { discordId: string }) => e.discordId)).toEqual([ids.okNoAvatar, ids.animated]);
    expect(state.queries[0]).toMatchObject({ limit: 2, offset: 2 });
    const userCalls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes("/users/"));
    expect(userCalls.map((u) => u.split("/").pop())).toEqual([ids.okNoAvatar, ids.animated]);
  });

  it("pages the public route too", async () => {
    const body = await (await publicGET(paged("offset=0&limit=1"), params(GUILD))).json();
    expect(body.entries).toHaveLength(1);
    expect(state.queries[1]).toMatchObject({ limit: 1, offset: 0 });
  });

  for (const q of ["limit=0", "limit=101", "offset=-1", "offset=abc", "limit=2.5"]) {
    it(`400 for ${q}, before any query`, async () => {
      const member = await memberGET(paged(q), params(GUILD));
      expect(member.status).toBe(400);
      expect(await member.json()).toEqual({ error: "Invalid data", code: "VALIDATION_ERROR" });
      const pub = await publicGET(paged(q), params(GUILD));
      expect(pub.status).toBe(400);
      expect(await pub.json()).toEqual({ error: "Invalid data" });
      expect(state.queries).toHaveLength(0);
    });
  }
});
