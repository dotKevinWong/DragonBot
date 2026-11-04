import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/guilds with the real lib/discord.ts (P6): pins the response body
// and order, and the Discord calls one request makes.

const USER = "111111111111111111";
const G = (n: number) => `20000000000000000${n}`;
const ROLE = "333333333333333333";

const state = vi.hoisted(() => ({
  allGuilds: [] as { guildId: string; guildName: string | null }[],
  customAdmin: [] as { guildId: string }[],
  /** per-URL responses; a list is consumed in order, the last entry repeats */
  responses: {} as Record<string, (() => Response)[]>,
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
              // checkGuildPermission's guild_admins lookup: no rows
              limit: async () => [],
            }),
        });
      },
    }),
  },
}));

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  const list = state.responses[url];
  if (!list || list.length === 0) return new Response("", { status: 404 });
  const next = list.length > 1 ? list.shift()! : list[0]!;
  return next();
});
vi.stubGlobal("fetch", fetchMock);

import { GET } from "@/app/api/guilds/route";

const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const status = (s: number) => () => new Response("", { status: s });
const guildUrl = (g: string) => `https://discord.com/api/v10/guilds/${g}`;
const memberUrl = (g: string) => `https://discord.com/api/v10/guilds/${g}/members/${USER}`;
const guildBody = (g: string, opts: { owner?: boolean; perms?: number; icon?: string | null }) => ({
  owner_id: opts.owner ? USER : "999",
  icon: opts.icon ?? null,
  roles: [
    { id: g, permissions: "0" },
    { id: ROLE, permissions: String(opts.perms ?? 0) },
  ],
});
const memberBody = { user: { id: USER }, roles: [ROLE], communication_disabled_until: null };

beforeEach(() => {
  fetchMock.mockClear();
  state.allGuilds = [1, 2, 3, 4, 5, 6].map((n) => ({ guildId: G(n), guildName: `g${n}` }));
  state.customAdmin = [{ guildId: G(1) }];
  state.responses = {
    // G1: custom admin, icon only
    [guildUrl(G(1))]: [json(guildBody(G(1), { icon: "a_i1" }))],
    // G2: owner
    [guildUrl(G(2))]: [json(guildBody(G(2), { owner: true, icon: "i2" }))],
    // G3: plain member
    [guildUrl(G(3))]: [json(guildBody(G(3), { icon: "i3" }))],
    [memberUrl(G(3))]: [json(memberBody)],
    // G4: not a member
    [guildUrl(G(4))]: [json(guildBody(G(4), {}))],
    [memberUrl(G(4))]: [status(404)],
    // G5: Manage Server
    [guildUrl(G(5))]: [json(guildBody(G(5), { perms: 32, icon: "i5" }))],
    [memberUrl(G(5))]: [json(memberBody)],
    // G6: guild fetch fails (bot not in guild); member check still runs
    [guildUrl(G(6))]: [status(403)],
    [memberUrl(G(6))]: [json(memberBody)],
  };
});

const EXPECTED = [
  { guildId: G(1), guildName: "g1", iconUrl: `https://cdn.discordapp.com/icons/${G(1)}/a_i1.gif?size=128`, isAdmin: true },
  { guildId: G(2), guildName: "g2", iconUrl: `https://cdn.discordapp.com/icons/${G(2)}/i2.png?size=128`, isAdmin: true },
  { guildId: G(3), guildName: "g3", iconUrl: `https://cdn.discordapp.com/icons/${G(3)}/i3.png?size=128`, isAdmin: false },
  { guildId: G(5), guildName: "g5", iconUrl: `https://cdn.discordapp.com/icons/${G(5)}/i5.png?size=128`, isAdmin: true },
  { guildId: G(6), guildName: "g6", iconUrl: null, isAdmin: false },
];

describe("GET /api/guilds", () => {
  it("returns the same guilds, flags, icons and order", async () => {
    const res = await GET(new Request("http://localhost/api/guilds"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED);
  });

  it("a guild fetch that fails during the check is fetched again for the icon (not cached)", async () => {
    state.responses[guildUrl(G(6))] = [status(429), json(guildBody(G(6), { icon: "i6" }))];
    const res = await GET(new Request("http://localhost/api/guilds"));
    const body = (await res.json()) as typeof EXPECTED;
    expect(body.find((g) => g.guildId === G(6))).toEqual({
      guildId: G(6),
      guildName: "g6",
      iconUrl: `https://cdn.discordapp.com/icons/${G(6)}/i6.png?size=128`,
      isAdmin: false,
    });
  });

  it("a member fetch that fails during the check is fetched again by the member check", async () => {
    state.responses[memberUrl(G(4))] = [status(429), json(memberBody)];
    const res = await GET(new Request("http://localhost/api/guilds"));
    const body = (await res.json()) as typeof EXPECTED;
    expect(body.find((g) => g.guildId === G(4))).toEqual({ guildId: G(4), guildName: "g4", iconUrl: null, isAdmin: false });
  });

  it("Discord calls made by one request: each successful guild/member lookup once (P6)", async () => {
    // Before P6 (16 calls): G2 guild; G3 guild, member, member; G4 guild, member, member;
    // G5 guild, member; G6 guild, member; icons G1, G2, G3, G5, G6.
    await GET(new Request("http://localhost/api/guilds"));
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    // P1: the checks now run a few guilds at a time, so calls of different guilds interleave.
    // The calls themselves, each guild's own sequence, and icons-after-checks are unchanged.
    const checks = urls.slice(0, 10);
    const forGuild = (g: string) => checks.filter((u) => u === guildUrl(g) || u === memberUrl(g));
    expect(forGuild(G(2))).toEqual([guildUrl(G(2))]);
    expect(forGuild(G(3))).toEqual([guildUrl(G(3)), memberUrl(G(3))]);
    expect(forGuild(G(4))).toEqual([guildUrl(G(4)), memberUrl(G(4)), memberUrl(G(4))]);
    expect(forGuild(G(5))).toEqual([guildUrl(G(5)), memberUrl(G(5))]);
    expect(forGuild(G(6))).toEqual([guildUrl(G(6)), memberUrl(G(6))]);
    expect(urls.slice(10)).toEqual([guildUrl(G(1)), guildUrl(G(6))]);
    expect([...urls].sort()).toEqual([
      // permission checks (pre-P1 order, which was guild order)
      guildUrl(G(2)),
      guildUrl(G(3)), memberUrl(G(3)), // membership reuses the member lookup
      guildUrl(G(4)), memberUrl(G(4)), memberUrl(G(4)), // a failed member lookup is made again
      guildUrl(G(5)), memberUrl(G(5)),
      guildUrl(G(6)), memberUrl(G(6)),
      // icons: G1 was never checked, G6's guild lookup failed; G2, G3, G5 reuse the guild
      guildUrl(G(1)), guildUrl(G(6)),
    ].sort());
  });
});
