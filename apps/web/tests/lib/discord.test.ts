import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of apps/web/src/lib/discord.ts (D3, D7, P6, X10): the
// permission matrix, Discord call counts and order, the two user fetchers and
// the guild icon URL. Recorded on the pre-refactor code.

const GUILD = "222222222222222222";
const USER = "111111111111111111";
const ROLE = "333333333333333333";
const ADMINISTRATOR = 8;
const MANAGE_GUILD = 32;

const state = vi.hoisted(() => ({
  adminRows: [] as { permissions: string[] }[],
  dbThrows: false,
  dbSelects: 0,
}));

vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      state.dbSelects++;
      return {
        from: () => ({
          where: () => ({
            limit: async () => {
              if (state.dbThrows) throw new Error("db down");
              return state.adminRows;
            },
          }),
        }),
      };
    },
  },
}));

type Responder = (url: string) => Response | Promise<Response>;
const fetchState = { respond: (() => new Response("", { status: 404 })) as Responder };
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => fetchState.respond(url));
vi.stubGlobal("fetch", fetchMock);

import {
  checkGuildPermission,
  getUserGuildPermissions,
  getDiscordUser,
  resolveDiscordUser,
  resolveDiscordUsers,
  getGuildIconUrl,
  isGuildMember,
  createDiscordLookupMemo,
} from "@/lib/discord";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface DiscordScenario {
  name: string;
  expected: boolean;
  fetches: number;
  respond: Responder;
}

function guildWith(roles: { id: string; permissions: string }[], ownerId = "999999999999999999") {
  return { owner_id: ownerId, icon: null, roles };
}

function scenario(
  name: string,
  expected: boolean,
  opts: { owner?: boolean; everyone?: number; role?: number; timedOut?: boolean; guildStatus?: number; memberStatus?: number; throws?: boolean; badJson?: boolean },
): DiscordScenario {
  const roles = [
    { id: GUILD, permissions: String(opts.everyone ?? 0) },
    { id: ROLE, permissions: String(opts.role ?? 0) },
  ];
  const fetches = opts.owner || opts.guildStatus || opts.throws || opts.badJson ? 1 : 2;
  return {
    name,
    expected,
    fetches,
    respond: (url) => {
      if (opts.throws) throw new Error("network");
      if (url.endsWith(`/members/${USER}`)) {
        if (opts.memberStatus) return new Response("", { status: opts.memberStatus });
        return json({
          user: { id: USER },
          roles: [ROLE, "444444444444444444"],
          communication_disabled_until: opts.timedOut ? new Date(Date.now() + 60_000).toISOString() : null,
        });
      }
      if (opts.guildStatus) return new Response("", { status: opts.guildStatus });
      if (opts.badJson) return new Response("not json", { status: 200 });
      return json(guildWith(roles, opts.owner ? USER : undefined));
    },
  };
}

const discordScenarios: DiscordScenario[] = [
  scenario("owner", true, { owner: true }),
  scenario("administrator role", true, { role: ADMINISTRATOR }),
  scenario("manage server role", true, { role: MANAGE_GUILD }),
  scenario("manage server via @everyone", true, { everyone: MANAGE_GUILD }),
  scenario("timed-out manage server", false, { role: MANAGE_GUILD, timedOut: true }),
  scenario("timed-out administrator", true, { role: ADMINISTRATOR, timedOut: true }),
  scenario("no permissions", false, {}),
  { ...scenario("member fetch 404", false, { memberStatus: 404 }), fetches: 2 },
  scenario("guild fetch 403", false, { guildStatus: 403 }),
  scenario("guild fetch 429", false, { guildStatus: 429 }),
  scenario("fetch throws", false, { throws: true }),
  scenario("guild json invalid", false, { badJson: true }),
];

interface DbScenario {
  name: string;
  rows: { permissions: string[] }[];
  throws?: boolean;
}

const dbScenarios: DbScenario[] = [
  { name: "no row", rows: [] },
  { name: "empty grants", rows: [{ permissions: [] }] },
  { name: "wildcard", rows: [{ permissions: ["*"] }] },
  { name: "schedules grant", rows: [{ permissions: ["schedules"] }] },
  { name: "two grants", rows: [{ permissions: ["welcome", "youtube"] }] },
  { name: "db throws", rows: [], throws: true },
];

const scopes: (string | undefined)[] = [undefined, "", "schedules", "youtube", "*"];

/** The rules as documented in AGENTS.md and the audit: the oracle for the matrix. */
function expectedCheck(d: DiscordScenario, db: DbScenario, scope: string | undefined): boolean {
  if (d.expected) return true;
  if (db.throws) return false;
  const grants = db.rows[0]?.permissions ?? [];
  if (grants.length === 0) return false;
  if (grants.includes("*")) return true;
  if (!scope) return true;
  return grants.includes(scope);
}

function expectedPerms(d: DiscordScenario, db: DbScenario): string[] {
  if (d.expected) return ["*"];
  if (db.throws) return [];
  return db.rows[0]?.permissions ?? [];
}

beforeEach(() => {
  state.adminRows = [];
  state.dbThrows = false;
  state.dbSelects = 0;
  fetchMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkGuildPermission / getUserGuildPermissions matrix", () => {
  for (const d of discordScenarios) {
    for (const dbs of dbScenarios) {
      for (const scope of scopes) {
        it(`${d.name} x ${dbs.name} x scope ${JSON.stringify(scope)}`, async () => {
          fetchState.respond = d.respond;
          state.adminRows = dbs.rows;
          state.dbThrows = !!dbs.throws;
          const result = scope === undefined ? await checkGuildPermission(GUILD, USER) : await checkGuildPermission(GUILD, USER, scope);
          expect(result).toBe(expectedCheck(d, dbs, scope));
          // Discord first; the guild_admins query only when Discord says no
          expect(fetchMock).toHaveBeenCalledTimes(d.fetches);
          expect(state.dbSelects).toBe(d.expected ? 0 : 1);
        });
      }

      it(`getUserGuildPermissions: ${d.name} x ${dbs.name}`, async () => {
        fetchState.respond = d.respond;
        state.adminRows = dbs.rows;
        state.dbThrows = !!dbs.throws;
        expect(await getUserGuildPermissions(GUILD, USER)).toEqual(expectedPerms(d, dbs));
        expect(fetchMock).toHaveBeenCalledTimes(d.fetches);
        expect(state.dbSelects).toBe(d.expected ? 0 : 1);
      });
    }
  }

  it("returns the raw grants array from the row", async () => {
    fetchState.respond = scenario("none", false, {}).respond;
    const grants = ["welcome", "youtube"];
    state.adminRows = [{ permissions: grants }];
    expect(await getUserGuildPermissions(GUILD, USER)).toBe(grants);
  });

  it("calls Discord with the guild then the member URL and the Bot header", async () => {
    fetchState.respond = scenario("none", false, {}).respond;
    await checkGuildPermission(GUILD, USER);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `https://discord.com/api/v10/guilds/${GUILD}`,
      `https://discord.com/api/v10/guilds/${GUILD}/members/${USER}`,
    ]);
    for (const c of fetchMock.mock.calls) {
      expect(c[1]).toEqual({ headers: { Authorization: "Bot test-token" } });
    }
  });
});

describe("isGuildMember", () => {
  it("is true on an ok member response, false otherwise", async () => {
    fetchState.respond = () => json({});
    expect(await isGuildMember(GUILD, USER)).toBe(true);
    expect(fetchMock.mock.calls[0]).toEqual([
      `https://discord.com/api/v10/guilds/${GUILD}/members/${USER}`,
      { headers: { Authorization: "Bot test-token" } },
    ]);
    fetchState.respond = () => new Response("", { status: 404 });
    expect(await isGuildMember(GUILD, USER)).toBe(false);
    fetchState.respond = () => {
      throw new Error("network");
    };
    expect(await isGuildMember(GUILD, USER)).toBe(false);
  });
});

describe("getGuildIconUrl", () => {
  it("builds a gif URL for an animated icon, png otherwise, using the guildId argument", async () => {
    fetchState.respond = () => json({ id: "555555555555555555", owner_id: "1", roles: [], icon: "a_abc" });
    expect(await getGuildIconUrl(GUILD)).toBe(`https://cdn.discordapp.com/icons/${GUILD}/a_abc.gif?size=128`);
    fetchState.respond = () => json({ owner_id: "1", roles: [], icon: "abc" });
    expect(await getGuildIconUrl(GUILD)).toBe(`https://cdn.discordapp.com/icons/${GUILD}/abc.png?size=128`);
    expect(fetchMock.mock.calls[0]).toEqual([
      `https://discord.com/api/v10/guilds/${GUILD}`,
      { headers: { Authorization: "Bot test-token" } },
    ]);
  });

  it("is null for no icon, non-ok, a throw and bad json", async () => {
    fetchState.respond = () => json({ owner_id: "1", roles: [], icon: null });
    expect(await getGuildIconUrl(GUILD)).toBeNull();
    fetchState.respond = () => new Response("", { status: 404 });
    expect(await getGuildIconUrl(GUILD)).toBeNull();
    fetchState.respond = () => {
      throw new Error("network");
    };
    expect(await getGuildIconUrl(GUILD)).toBeNull();
    fetchState.respond = () => new Response("nope", { status: 200 });
    expect(await getGuildIconUrl(GUILD)).toBeNull();
  });
});

describe("getDiscordUser", () => {
  const userUrl = (id: string) => `https://discord.com/api/v10/users/${id}`;

  it("animated avatar: gif at size 128, displayName is global_name, avatar uses the response id", async () => {
    fetchState.respond = () => json({ id: "777", username: "kev", global_name: "Kevin", avatar: "a_hash" });
    expect(await getDiscordUser("100")).toEqual({
      username: "kev",
      displayName: "Kevin",
      avatarUrl: "https://cdn.discordapp.com/avatars/777/a_hash.gif?size=128",
    });
    expect(fetchMock.mock.calls[0]).toEqual([userUrl("100"), { headers: { Authorization: "Bot test-token" } }]);
  });

  it("plain avatar png; null global_name stays null; null avatar gives null URL", async () => {
    fetchState.respond = () => json({ id: "777", username: "kev", global_name: null, avatar: "hash" });
    expect(await getDiscordUser("100")).toEqual({
      username: "kev",
      displayName: null,
      avatarUrl: "https://cdn.discordapp.com/avatars/777/hash.png?size=128",
    });
    fetchState.respond = () => json({ id: "777", username: "kev", global_name: "K", avatar: null });
    expect(await getDiscordUser("100")).toEqual({ username: "kev", displayName: "K", avatarUrl: null });
  });

  it("is null on 404, 429, a throw and bad json, and never caches", async () => {
    for (const respond of [
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 429 }),
      () => {
        throw new Error("network");
      },
      () => new Response("nope", { status: 200 }),
    ] as Responder[]) {
      fetchState.respond = respond;
      expect(await getDiscordUser("100")).toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchState.respond = () => json({ id: "1", username: "a", global_name: null, avatar: null });
    await getDiscordUser("100");
    await getDiscordUser("100");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("resolveDiscordUser", () => {
  let n = 0;
  const freshId = () => `9000000000000${n++}`;

  it("png at size 64 even for an animated hash; displayName falls back to username", async () => {
    const id = freshId();
    fetchState.respond = () => json({ id: "888", username: "kev", global_name: null, avatar: "a_hash" });
    expect(await resolveDiscordUser(id)).toEqual({
      username: "kev",
      displayName: "kev",
      avatarUrl: "https://cdn.discordapp.com/avatars/888/a_hash.png?size=64",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `https://discord.com/api/v10/users/${id}`,
      { headers: { Authorization: "Bot test-token" } },
    ]);
  });

  it("caches a success for 10 minutes, refetches after", async () => {
    vi.useFakeTimers();
    const id = freshId();
    fetchState.respond = () => json({ id, username: "kev", global_name: "K", avatar: null });
    const first = await resolveDiscordUser(id);
    expect(first).toEqual({ username: "kev", displayName: "K", avatarUrl: null });
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(await resolveDiscordUser(id)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await resolveDiscordUser(id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a 429, a throw or bad json", async () => {
    for (const respond of [
      () => new Response("", { status: 429 }),
      () => {
        throw new Error("network");
      },
      () => new Response("nope", { status: 200 }),
    ] as Responder[]) {
      const id = freshId();
      fetchState.respond = respond;
      expect(await resolveDiscordUser(id)).toBeNull();
      fetchState.respond = () => json({ id, username: "u", global_name: null, avatar: null });
      expect(await resolveDiscordUser(id)).toEqual({ username: "u", displayName: "u", avatarUrl: null });
    }
  });

  it("caches null on another non-ok status (404, 403)", async () => {
    for (const status of [404, 403, 500]) {
      const id = freshId();
      fetchState.respond = () => new Response("", { status });
      expect(await resolveDiscordUser(id)).toBeNull();
      fetchState.respond = () => json({ id, username: "u", global_name: null, avatar: null });
      expect(await resolveDiscordUser(id)).toBeNull();
    }
  });
});

describe("resolveDiscordUsers", () => {
  it("omits failures, keeps input order in the map, and batches by concurrency", async () => {
    const ids = ["8100000000000001", "8100000000000002", "8100000000000003", "8100000000000004"];
    let inFlight = 0;
    let maxInFlight = 0;
    fetchState.respond = async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const id = url.split("/").pop()!;
      if (id === ids[1]) return new Response("", { status: 404 });
      return json({ id, username: `u${id}`, global_name: null, avatar: null });
    };
    const map = await resolveDiscordUsers(ids, 2);
    expect([...map.keys()]).toEqual([ids[0], ids[2], ids[3]]);
    expect(maxInFlight).toBe(2);
  });
});

describe("request-scoped lookup memo (P6)", () => {
  const manage = () => scenario("manage", true, { role: MANAGE_GUILD });

  it("without a memo nothing is shared between calls", async () => {
    fetchState.respond = manage().respond;
    await checkGuildPermission(GUILD, USER);
    await checkGuildPermission(GUILD, USER);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("with a memo the guild and member are fetched once, same results", async () => {
    for (const d of discordScenarios) {
      fetchMock.mockClear();
      fetchState.respond = d.respond;
      const memo = createDiscordLookupMemo();
      const first = await checkGuildPermission(GUILD, USER, undefined, memo);
      const second = await getUserGuildPermissions(GUILD, USER, memo);
      expect(first).toBe(d.expected);
      expect(second).toEqual(d.expected ? ["*"] : []);
      // successful lookups are not repeated; failed ones are
      const okFetches = d.name === "member fetch 404" ? 1 : d.fetches === 2 || d.name === "owner" ? d.fetches : 0;
      expect(fetchMock).toHaveBeenCalledTimes(2 * d.fetches - okFetches);
    }
  });

  it("a failed guild lookup is retried and its later success used", async () => {
    const memo = createDiscordLookupMemo();
    let calls = 0;
    fetchState.respond = (url) => {
      if (url.endsWith(`/guilds/${GUILD}`) && calls++ === 0) return new Response("", { status: 429 });
      return manage().respond(url);
    };
    expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(false);
    expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a not-ok guild or member response with a JSON body is refused and never memoised", async () => {
    for (const status of [404, 429]) {
      const memo = createDiscordLookupMemo();
      fetchMock.mockClear();
      fetchState.respond = () => json({ message: "Unknown Guild", code: 10004 }, status);
      expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(memo.guilds.size).toBe(0);
      expect(memo.members.size).toBe(0);

      const memo2 = createDiscordLookupMemo();
      fetchMock.mockClear();
      fetchState.respond = (url) =>
        url.endsWith(`/guilds/${GUILD}`)
          ? manage().respond(url)
          : json({ roles: [ROLE], communication_disabled_until: null, message: "Unknown Member" }, status);
      expect(await checkGuildPermission(GUILD, USER, undefined, memo2)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(memo2.members.size).toBe(0);
      expect(await isGuildMember(GUILD, USER, memo2)).toBe(false);
    }
  });

  it("isGuildMember answers true from a memoised member, otherwise fetches", async () => {
    const memo = createDiscordLookupMemo();
    fetchState.respond = scenario("none", false, {}).respond;
    expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(false);
    fetchMock.mockClear();
    expect(await isGuildMember(GUILD, USER, memo)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchState.respond = () => new Response("", { status: 404 });
    expect(await isGuildMember(GUILD, "555555555555555555", memo)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isGuildMember is not answered from a failed member lookup", async () => {
    const memo = createDiscordLookupMemo();
    fetchState.respond = scenario("member 404", false, { memberStatus: 404 }).respond;
    await checkGuildPermission(GUILD, USER, undefined, memo);
    fetchMock.mockClear();
    expect(await isGuildMember(GUILD, USER, memo)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("getGuildIconUrl reuses a memoised guild", async () => {
    const memo = createDiscordLookupMemo();
    fetchState.respond = (url) =>
      url.endsWith(`/guilds/${GUILD}`) ? json({ ...guildWith([], USER), icon: "a_x" }) : new Response("", { status: 404 });
    expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(true);
    fetchMock.mockClear();
    expect(await getGuildIconUrl(GUILD, memo)).toBe(`https://cdn.discordapp.com/icons/${GUILD}/a_x.gif?size=128`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a timed-out member stays refused on the memoised path", async () => {
    const memo = createDiscordLookupMemo();
    fetchState.respond = scenario("to", false, { role: MANAGE_GUILD, timedOut: true }).respond;
    expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(false);
    expect(await checkGuildPermission(GUILD, USER, undefined, memo)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
