import { beforeEach, describe, expect, it, vi } from "vitest";

const GUILD = "222222222222222222";
const OTHER_GUILD = "333333333333333333";
const USER = "111111111111111111";

type AdminRow = { guildId: string; discordId: string; permissions: string[] };

const state = vi.hoisted(() => ({
  rows: [] as AdminRow[],
  discordAccess: false,
}));

const { checkGuildPermission } = vi.hoisted(() => ({
  checkGuildPermission: vi.fn(async () => state.discordAccess),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => "111111111111111111") }));
vi.mock("@/lib/discord", () => ({ checkGuildPermission }));
vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));

// A tiny fake of drizzle's select().from().where().limit() that evaluates the
// where clause against state.rows. drizzle-orm's eq/and are mocked so the
// condition is a plain object we can evaluate.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name: string }, value: unknown) => ({ kind: "eq", col: col.name, value }),
    and: (...conds: unknown[]) => ({ kind: "and", conds }),
  };
});

vi.mock("@/lib/db", () => {
  type Cond = { kind: "eq"; col: string; value: unknown } | { kind: "and"; conds: Cond[] };
  const colKey: Record<string, keyof AdminRow> = { guild_id: "guildId", discord_id: "discordId" };
  const matches = (row: AdminRow, c: Cond): boolean =>
    c.kind === "and" ? c.conds.every((x) => matches(row, x)) : row[colKey[c.col]] === c.value;
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (cond: Cond) => {
            const filtered = () => state.rows.filter((r) => matches(r, cond));
            const result = Object.assign(Promise.resolve().then(filtered), {
              limit: (n: number) => Promise.resolve().then(() => filtered().slice(0, n)),
            });
            return result;
          },
        }),
      }),
    },
  };
});

vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })),
);

import { GET } from "@/app/api/server/[guildId]/discord/route";

function call() {
  return GET(new Request(`http://localhost/api/server/${GUILD}/discord`), {
    params: Promise.resolve({ guildId: GUILD }),
  });
}

beforeEach(() => {
  state.rows = [];
  state.discordAccess = false;
  checkGuildPermission.mockClear();
});

describe("GET /api/server/[guildId]/discord access shortcut (B4)", () => {
  it("denies a guild_admins row with an empty permission list", async () => {
    state.rows = [{ guildId: GUILD, discordId: USER, permissions: [] }];
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden", code: "UNAUTHORIZED" });
  });

  it("accepts a manager of several guilds whose first row is another guild", async () => {
    state.rows = [
      { guildId: OTHER_GUILD, discordId: USER, permissions: ["welcome"] },
      { guildId: GUILD, discordId: USER, permissions: ["schedules"] },
    ];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ channels: [], roles: [] });
    expect(checkGuildPermission).not.toHaveBeenCalled();
  });

  it("falls through to checkGuildPermission when there is no row", async () => {
    state.discordAccess = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(checkGuildPermission).toHaveBeenCalledWith(GUILD, USER);
  });

  it("returns the unchanged 403 when the fallback also denies", async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden", code: "UNAUTHORIZED" });
  });
});
