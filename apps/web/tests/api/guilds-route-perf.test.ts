import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/guilds (P1) with the real lib/discord.ts: the full permission
// matrix, the 20-check cap, owner handling, fail-closed paths and the result
// order when Discord answers out of order. The "characterization" block was
// recorded on the sequential pre-P1 code and must pass unchanged after.

const USER = "111111111111111111";
const ROLE = "333333333333333333";
const N = (i: number) => `3000000000000000${String(i).padStart(2, "0")}`;
const C1 = "400000000000000001"; // custom admin, bot sees the guild
const C2 = "400000000000000002"; // custom admin, guild fetch fails (user not in it)
const FUTURE = "2999-01-01T00:00:00.000Z";

const state = vi.hoisted(() => ({
  allGuilds: [] as { guildId: string; guildName: string | null }[],
  customAdmin: [] as { guildId: string }[],
  adminLookups: 0,
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => "111111111111111111") }));
vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({
  db: {
    select: (fields?: Record<string, unknown>) => ({
      from: () => {
        const isAllGuilds = !!fields && "guildName" in fields;
        const base = Promise.resolve(isAllGuilds ? state.allGuilds : []);
        return Object.assign(base, {
          where: () =>
            Object.assign(Promise.resolve(state.customAdmin), {
              // checkGuildPermission's guild_admins lookup
              limit: async () => {
                state.adminLookups++;
                return [];
              },
            }),
        });
      },
    }),
  },
}));

type Kind =
  | "owner"
  | "admin"
  | "manage"
  | "timedOutManage"
  | "timedOutAdmin"
  | "member"
  | "nonMember"
  | "badGuildJson"
  | "badMemberJson"
  | "throws"
  | "guild500";

const KINDS: Kind[] = [
  "owner", "admin", "manage", "timedOutManage", "timedOutAdmin", "member", "nonMember",
  "badGuildJson", "badMemberJson", "throws", "guild500",
];

const kindOf = (i: number): Kind => (i > 20 ? "owner" : KINDS[(i - 1) % KINDS.length]!);
const iconOf = (i: number) => (i % 3 === 0 ? null : i % 3 === 1 ? `a_h${i}` : `h${i}`);

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const BASE = "https://discord.com/api/v10/guilds/";

function guildBody(g: string, icon: string | null, opts: { owner?: boolean; perms?: number }) {
  return {
    owner_id: opts.owner ? USER : "999",
    icon,
    roles: [
      { id: g, permissions: "0" },
      { id: ROLE, permissions: String(opts.perms ?? 0) },
    ],
  };
}

function respondFor(url: string): Response {
  if (!url.startsWith(BASE)) return new Response("", { status: 404 });
  const [g, , user] = url.slice(BASE.length).split("/");
  const isMember = user !== undefined;
  if (g === C1) return isMember ? new Response("", { status: 404 }) : json(guildBody(C1, "a_c1", {}));
  if (g === C2) return new Response("", { status: 403 });
  const i = Number(g!.slice(-2));
  const kind = kindOf(i);
  const icon = iconOf(i);
  const member = (until: string | null = null) => json({ user: { id: USER }, roles: [ROLE], communication_disabled_until: until });
  switch (kind) {
    case "owner":
      return isMember ? member() : json(guildBody(g!, icon, { owner: true }));
    case "admin":
      return isMember ? member() : json(guildBody(g!, icon, { perms: 8 }));
    case "manage":
      return isMember ? member() : json(guildBody(g!, icon, { perms: 32 }));
    case "timedOutManage":
      return isMember ? member(FUTURE) : json(guildBody(g!, icon, { perms: 32 }));
    case "timedOutAdmin":
      return isMember ? member(FUTURE) : json(guildBody(g!, icon, { perms: 8 }));
    case "member":
      return isMember ? member() : json(guildBody(g!, icon, {}));
    case "nonMember":
      return isMember ? new Response("", { status: 404 }) : json(guildBody(g!, icon, { perms: 8 }));
    case "badGuildJson":
      return isMember ? member() : new Response("{not json", { status: 200 });
    case "badMemberJson":
      return isMember ? new Response("{not json", { status: 200 }) : json(guildBody(g!, icon, { perms: 32 }));
    case "throws":
      throw new Error("network down");
    case "guild500":
      return isMember ? member() : new Response("", { status: 500 });
  }
}

const delays = { enabled: false };
const denyAll = { enabled: false };
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  state.inFlight++;
  state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
  try {
    if (delays.enabled) {
      // later guilds answer sooner, to scramble completion order
      const n = url.startsWith(BASE) ? Number(url.slice(BASE.length, BASE.length + 18).slice(-2)) : 0;
      await new Promise((r) => setTimeout(r, Math.max(0, 25 - n)));
    }
    return denyAll.enabled ? new Response("", { status: 404 }) : respondFor(url);
  } finally {
    state.inFlight--;
  }
});
vi.stubGlobal("fetch", fetchMock);

import { GET } from "@/app/api/guilds/route";

const cdn = (g: string, hash: string) =>
  `https://cdn.discordapp.com/icons/${g}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=128`;

/** The expected body, written out per kind. */
function expected() {
  const rows: { guildId: string; guildName: string | null; iconUrl: string | null; isAdmin: boolean }[] = [
    { guildId: C1, guildName: "custom one", iconUrl: cdn(C1, "a_c1"), isAdmin: true },
    { guildId: C2, guildName: null, iconUrl: null, isAdmin: true },
  ];
  for (let i = 1; i <= 25; i++) {
    if (i > 20) continue; // past the cap: never checked
    const g = N(i);
    const icon = iconOf(i);
    const iconUrl = icon ? cdn(g, icon) : null;
    const name = `n${i}`;
    switch (kindOf(i)) {
      case "owner":
      case "admin":
      case "manage":
      case "timedOutAdmin":
        rows.push({ guildId: g, guildName: name, iconUrl, isAdmin: true });
        break;
      case "timedOutManage":
      case "member":
        rows.push({ guildId: g, guildName: name, iconUrl, isAdmin: false });
        break;
      case "badMemberJson": // not admin (member unreadable) but listed as a member
        rows.push({ guildId: g, guildName: name, iconUrl, isAdmin: false });
        break;
      case "badGuildJson":
      case "guild500": // guild unreadable: not admin, member, no icon
        rows.push({ guildId: g, guildName: name, iconUrl: null, isAdmin: false });
        break;
      case "nonMember":
      case "throws":
        break;
    }
  }
  return rows;
}

beforeEach(() => {
  fetchMock.mockClear();
  delays.enabled = false;
  denyAll.enabled = false;
  state.adminLookups = 0;
  state.inFlight = 0;
  state.maxInFlight = 0;
  const nonCustom = Array.from({ length: 25 }, (_, k) => ({ guildId: N(k + 1), guildName: `n${k + 1}` }));
  // custom-admin guilds sit in the middle and at the end of allGuilds
  state.allGuilds = [
    ...nonCustom.slice(0, 3),
    { guildId: C1, guildName: "custom one" },
    ...nonCustom.slice(3),
    { guildId: C2, guildName: null },
  ];
  state.customAdmin = [{ guildId: C2 }, { guildId: C1 }];
});

describe("GET /api/guilds (characterization)", () => {
  it("returns the exact body: custom admins first, then checked guilds in allGuilds order", async () => {
    const res = await GET(new Request("http://localhost/api/guilds"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expected()));
  });

  it("same body when Discord answers out of order", async () => {
    delays.enabled = true;
    const res = await GET(new Request("http://localhost/api/guilds"));
    expect(await res.text()).toBe(JSON.stringify(expected()));
  });

  it("checks at most 20 non-custom guilds; guilds 21+ are never fetched", async () => {
    await GET(new Request("http://localhost/api/guilds"));
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    for (let i = 21; i <= 25; i++) {
      expect(urls.some((u) => u.includes(N(i)))).toBe(false);
    }
    for (let i = 1; i <= 20; i++) {
      expect(urls.some((u) => u.includes(N(i)))).toBe(true);
    }
    // custom-admin guilds: one icon fetch each, no member fetch
    expect(urls.filter((u) => u.includes(C1))).toEqual([`${BASE}${C1}`]);
    expect(urls.filter((u) => u.includes(C2))).toEqual([`${BASE}${C2}`]);
  });

  it("the set of Discord calls is unchanged (order aside)", async () => {
    await GET(new Request("http://localhost/api/guilds"));
    const urls = fetchMock.mock.calls.map((c) => c[0] as string).sort();
    const want: string[] = [`${BASE}${C1}`, `${BASE}${C2}`];
    for (let i = 1; i <= 20; i++) {
      const g = `${BASE}${N(i)}`;
      const m = `${g}/members/${USER}`;
      switch (kindOf(i)) {
        case "owner":
          want.push(g);
          break;
        case "admin":
        case "manage":
        case "timedOutAdmin":
        case "timedOutManage":
        case "member":
          want.push(g, m);
          break;
        case "nonMember":
          want.push(g, m, m);
          break;
        case "badGuildJson":
        case "guild500":
          want.push(g, m, g); // icon refetches the unread guild; member memoised
          break;
        case "badMemberJson":
          want.push(g, m, m);
          break;
        case "throws":
          want.push(g, m);
          break;
      }
    }
    expect(urls).toEqual(want.sort());
  });

  it("only custom-admin guilds: no Discord check at all, icons only", async () => {
    state.allGuilds = [{ guildId: C1, guildName: "custom one" }];
    state.customAdmin = [{ guildId: C1 }];
    const res = await GET(new Request("http://localhost/api/guilds"));
    expect(await res.json()).toEqual([{ guildId: C1, guildName: "custom one", iconUrl: cdn(C1, "a_c1"), isAdmin: true }]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${BASE}${C1}`]);
  });

  it("no guilds: empty array", async () => {
    state.allGuilds = [];
    state.customAdmin = [];
    const res = await GET(new Request("http://localhost/api/guilds"));
    expect(await res.text()).toBe("[]");
  });
});

describe("GET /api/guilds after P1", () => {
  it("still runs checkGuildPermission's guild_admins lookup once per checked guild Discord refuses, as HEAD did", async () => {
    // Each query is a 'DB query executed' log line on the web db, so the count must match HEAD.
    // Guilds 1-20: 7 refused kinds among 1-11, 5 among 12-20 (timedOutManage, member, nonMember,
    // badGuildJson, badMemberJson).
    await GET(new Request("http://localhost/api/guilds"));
    expect(state.adminLookups).toBe(12);
  });

  it("keeps at most 4 guild checks in flight, still in guild order", async () => {
    delays.enabled = true;
    denyAll.enabled = true;
    state.allGuilds = state.allGuilds.filter((g) => g.guildId !== C1 && g.guildId !== C2);
    state.customAdmin = [];
    const res = await GET(new Request("http://localhost/api/guilds"));
    expect(await res.text()).toBe("[]");
    // nothing accessible, so no icon fetches: every call is a check (guild, then member, per guild)
    expect(fetchMock).toHaveBeenCalledTimes(40);
    expect(state.maxInFlight).toBe(4);
    // every check is refused by Discord, so each one also queried guild_admins
    expect(state.adminLookups).toBe(20);
  });
});
