import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of the GET /api/server/[guildId]/discord response (P15):
// channel and role order, ties, missing positions, duplicate ids, type and
// colour mapping, and the partial-failure paths. Recorded pre-refactor.

const GUILD = "222222222222222222";

const state = vi.hoisted(() => ({
  channels: { status: 200, body: [] as unknown } as { status: number; body: unknown } | "throw",
  roles: { status: 200, body: [] as unknown } as { status: number; body: unknown } | "throw",
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => "111111111111111111") }));
vi.mock("@/lib/discord", () => ({ checkGuildPermission: vi.fn(async () => true) }));
vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));

const fetchMock = vi.fn(async (url: string) => {
  const spec = url.endsWith("/channels") ? state.channels : state.roles;
  if (spec === "throw") throw new Error("network");
  return new Response(JSON.stringify(spec.body), { status: spec.status });
});
vi.stubGlobal("fetch", fetchMock);

import { GET } from "@/app/api/server/[guildId]/discord/route";

async function call() {
  const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ guildId: GUILD }) });
  return { status: res.status, body: await res.json() };
}

const ch = (id: string, position: number | undefined, type = 0, name = `c${id}`) => ({ id, name, type, position, parent_id: null });
const role = (id: string, position: number | undefined, color = 0, name = `r${id}`) => ({ id, name, color, position, managed: false });

beforeEach(() => {
  state.channels = { status: 200, body: [] };
  state.roles = { status: 200, body: [] };
  fetchMock.mockClear();
});

describe("/discord ordering and mapping", () => {
  it("channels ascending by position, ties keep raw order, missing position counts as 0, categories kept", async () => {
    state.channels = {
      status: 200,
      body: [ch("1", 5), ch("2", 0, 4), ch("3", undefined, 2), ch("4", 2, 5), ch("5", 0, 15), ch("6", -1, 13), ch("7", 2, 0)],
    };
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.channels).toEqual([
      { id: "6", name: "c6", type: "other" },
      { id: "2", name: "c2", type: "category" },
      { id: "3", name: "c3", type: "voice" },
      { id: "5", name: "c5", type: "forum" },
      { id: "4", name: "c4", type: "announcement" },
      { id: "7", name: "c7", type: "text" },
      { id: "1", name: "c1", type: "text" },
    ]);
  });

  it("duplicate channel ids use the first raw entry's position for both", async () => {
    state.channels = { status: 200, body: [ch("9", 10, 0, "first"), ch("8", 5), ch("9", 1, 0, "second")] };
    const { body } = await call();
    expect(body.channels.map((c: { name: string }) => c.name)).toEqual(["c8", "first", "second"]);
  });

  it("roles descending by position, @everyone dropped, ties keep raw order, colours mapped", async () => {
    state.roles = {
      status: 200,
      body: [
        role("1", 0, 0, "@everyone"),
        role("2", 3, 0xff0000),
        role("3", 7, 0x00ff),
        role("4", 3, 0),
        role("5", undefined, 1),
        role("6", 10, 0xabcdef),
      ],
    };
    const { body } = await call();
    expect(body.roles).toEqual([
      { id: "6", name: "r6", color: "#abcdef" },
      { id: "3", name: "r3", color: "#0000ff" },
      { id: "2", name: "r2", color: "#ff0000" },
      { id: "4", name: "r4", color: "#b5bac1" },
      { id: "5", name: "r5", color: "#000001" },
    ]);
  });

  it("duplicate role ids use the first raw entry's position", async () => {
    state.roles = { status: 200, body: [role("9", 1, 0, "first"), role("8", 5), role("9", 10, 0, "second")] };
    const { body } = await call();
    expect(body.roles.map((r: { name: string }) => r.name)).toEqual(["r8", "first", "second"]);
  });

  it("a failed channels fetch gives empty channels, roles still returned (and vice versa)", async () => {
    state.channels = { status: 403, body: {} };
    state.roles = { status: 200, body: [role("2", 1)] };
    expect((await call()).body).toEqual({ channels: [], roles: [{ id: "2", name: "r2", color: "#b5bac1" }] });
    state.channels = { status: 200, body: [ch("1", 1)] };
    state.roles = { status: 500, body: {} };
    expect((await call()).body).toEqual({ channels: [{ id: "1", name: "c1", type: "text" }], roles: [] });
  });

  it("a thrown fetch gives the 500 body", async () => {
    state.channels = "throw";
    expect(await call()).toEqual({ status: 500, body: { error: "Failed to fetch Discord data" } });
  });

  it("randomised: matches a reference stable sort", async () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let round = 0; round < 30; round++) {
      const rawCh = Array.from({ length: 40 }, (_, i) => ch(String(Math.floor(rnd() * 30)), rnd() < 0.1 ? undefined : Math.floor(rnd() * 8), 0, `n${i}`));
      const rawRoles = Array.from({ length: 40 }, (_, i) => role(String(Math.floor(rnd() * 30)), rnd() < 0.1 ? undefined : Math.floor(rnd() * 8), 0, `n${i}`));
      state.channels = { status: 200, body: rawCh };
      state.roles = { status: 200, body: rawRoles };
      const firstPos = (raw: { id: string; position?: number }[], id: string) => raw.find((r) => r.id === id)?.position ?? 0;
      const expCh = rawCh
        .map((c, i) => ({ c, i }))
        .sort((a, b) => firstPos(rawCh, a.c.id) - firstPos(rawCh, b.c.id) || a.i - b.i)
        .map(({ c }) => c.name);
      const expRoles = rawRoles
        .map((r, i) => ({ r, i }))
        .sort((a, b) => firstPos(rawRoles, b.r.id) - firstPos(rawRoles, a.r.id) || a.i - b.i)
        .map(({ r }) => r.name);
      const { body } = await call();
      expect(body.channels.map((c: { name: string }) => c.name)).toEqual(expCh);
      expect(body.roles.map((r: { name: string }) => r.name)).toEqual(expRoles);
    }
  });
});
