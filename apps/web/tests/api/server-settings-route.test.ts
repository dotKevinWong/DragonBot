import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of GET/PATCH /api/server/[guildId] and GET/PATCH
// /api/profile past their guards (D3, P13): the missing-scope message, the
// order of the xp and honeypot checks, the guild-row reads, the row-missing
// path, and the sensitive-field strip. Recorded on the pre-refactor code.

const USER = "111111111111111111";
const GUILD = "222222222222222222";
const CH1 = "300000000000000001";
const CH2 = "300000000000000002";

const state = vi.hoisted(() => ({
  perms: ["*"] as string[],
  selectQueue: [] as unknown[][],
  calls: [] as string[],
  updateResult: [] as unknown[],
  updateSet: undefined as Record<string, unknown> | undefined,
}));

const mocks = vi.hoisted(() => ({
  checkGuildPermission: vi.fn(async () => true),
  getUserGuildPermissions: vi.fn(async () => state.perms),
  notifyBotReload: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(async () => "111111111111111111") }));
vi.mock("@/lib/discord", () => ({
  checkGuildPermission: mocks.checkGuildPermission,
  getUserGuildPermissions: mocks.getUserGuildPermissions,
}));
vi.mock("@/lib/bot-webhook", () => ({ notifyBotReload: mocks.notifyBotReload }));
vi.mock("@/lib/db", () => {
  const db = {
    select: (fields?: Record<string, unknown>) => {
      const label = fields ? `select:${Object.keys(fields).join(",")}` : "select:*";
      return {
        from: () => ({
          where: () => ({
            limit: async () => {
              state.calls.push(label);
              return state.selectQueue.shift() ?? [];
            },
          }),
        }),
      };
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.updateSet = v;
        return {
          where: () => ({
            returning: async () => {
              state.calls.push("update");
              return state.updateResult;
            },
          }),
        };
      },
    }),
  };
  return { db };
});

import * as guildRoute from "@/app/api/server/[guildId]/route";
import * as profile from "@/app/api/profile/route";

function guildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-uuid",
    guildId: GUILD,
    guildName: "G",
    xpMin: 15,
    xpMax: 25,
    honeypotChannelId: null,
    welcomeChannelId: null,
    logChannelId: CH2,
    introChannelId: null,
    modNotesChannelId: null,
    xpLevelupChannelId: null,
    birthdayChannelId: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function patch(body: unknown) {
  const res = await guildRoute.PATCH(
    new Request(`http://localhost/api/server/${GUILD}`, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ guildId: GUILD }) },
  );
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  state.perms = ["*"];
  state.selectQueue = [];
  state.calls = [];
  state.updateResult = [];
  state.updateSet = undefined;
  for (const m of Object.values(mocks)) m.mockClear();
});

describe("GET /api/server/[guildId]", () => {
  it("strips only id and keeps key order", async () => {
    state.selectQueue = [[guildRow()]];
    const res = await guildRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ guildId: GUILD }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    const expected = guildRow() as Record<string, unknown>;
    delete expected.id;
    // B1 follow-up: the caller's grants are appended after the row's own keys
    expect(text).toBe(JSON.stringify({ ...expected, viewerScopes: ["*"] }));
  });

  it("viewerScopes is the caller's grant list from one permission lookup", async () => {
    for (const perms of [["*"], ["schedules"], ["welcome", "youtube"], ["suggestions", "*"]]) {
      state.perms = perms;
      state.selectQueue = [[guildRow()]];
      mocks.getUserGuildPermissions.mockClear();
      const res = await guildRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ guildId: GUILD }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.viewerScopes).toEqual(perms);
      expect(Object.keys(body).at(-1)).toBe("viewerScopes");
      expect(mocks.getUserGuildPermissions).toHaveBeenCalledTimes(1);
      expect(mocks.getUserGuildPermissions.mock.calls[0]).toEqual([GUILD, USER]);
      expect(mocks.checkGuildPermission).not.toHaveBeenCalled();
    }
  });

  it("no grants: 403 before the guild row is read", async () => {
    state.perms = [];
    state.selectQueue = [[guildRow()]];
    const res = await guildRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ guildId: GUILD }) });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('{"error":"Forbidden","code":"UNAUTHORIZED"}');
    expect(state.calls).toEqual([]);
  });

  it("missing row gives Server not found", async () => {
    const res = await guildRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ guildId: GUILD }) });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Server not found","code":"NOT_FOUND"}');
  });
});

describe("PATCH /api/server/[guildId] scopes", () => {
  const msg = (s: string) =>
    JSON.stringify({ error: `You don't have permission to modify these settings. Missing scopes: ${s}`, code: "UNAUTHORIZED" });

  it("one missing scope", async () => {
    state.perms = ["welcome"];
    expect(await patch({ isLoggingEnabled: true })).toEqual({ status: 403, text: msg("logging") });
    expect(state.calls).toEqual([]);
  });

  it("several missing scopes in schema field order, deduplicated, '*' shown as full access", async () => {
    state.perms = ["welcome"];
    expect(
      await patch({ isXpEnabled: true, isWelcomeEnabled: true, honeypotChannelId: CH1, xpMin: 1, isLoggingEnabled: false }),
    ).toEqual({ status: 403, text: msg("logging, xp, full access") });
  });

  it("a granted scope and unmapped fields pass", async () => {
    state.perms = ["welcome"];
    state.updateResult = [guildRow()];
    const res = await patch({ isWelcomeEnabled: true });
    expect(res.status).toBe(200);
  });

  it("no grants: 403 before the body is parsed", async () => {
    state.perms = [];
    const res = await guildRoute.PATCH(
      new Request(`http://localhost/api/server/${GUILD}`, { method: "PATCH", body: "not json" }),
      { params: Promise.resolve({ guildId: GUILD }) },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('{"error":"Forbidden","code":"UNAUTHORIZED"}');
  });

  it("wildcard passes everything", async () => {
    state.perms = ["*"];
    state.updateResult = [guildRow()];
    expect((await patch({ honeypotChannelId: CH1, isLoggingEnabled: true })).status).toBe(200);
  });
});

describe("PATCH /api/server/[guildId] cross-field checks", () => {
  const XP_ERR = '{"error":"xpMin cannot be greater than xpMax","code":"VALIDATION_ERROR"}';
  const hp = (label: string) =>
    JSON.stringify({ error: `The honeypot channel can't be the same as the ${label} channel.`, code: "VALIDATION_ERROR" });

  it("xpMin above stored xpMax gives 400 after a narrow read", async () => {
    state.selectQueue = [[{ xpMin: 15, xpMax: 25 }]];
    expect(await patch({ xpMin: 30 })).toEqual({ status: 400, text: XP_ERR });
    expect(state.calls).toEqual(["select:xpMin,xpMax"]);
  });

  it("xpMax below stored xpMin gives 400", async () => {
    state.selectQueue = [[{ xpMin: 15, xpMax: 25 }]];
    expect(await patch({ xpMax: 10 })).toEqual({ status: 400, text: XP_ERR });
  });

  it("valid xp only: one narrow read then the update", async () => {
    state.selectQueue = [[{ xpMin: 15, xpMax: 25 }]];
    state.updateResult = [guildRow({ xpMax: 40 })];
    const res = await patch({ xpMax: 40 });
    expect(res.status).toBe(200);
    expect(state.calls).toEqual(["select:xpMin,xpMax", "update"]);
  });

  it("honeypot only: one full read; a stored conflict gives 400", async () => {
    state.selectQueue = [[guildRow()]];
    expect(await patch({ honeypotChannelId: CH2 })).toEqual({ status: 400, text: hp("log") });
    expect(state.calls).toEqual(["select:*"]);
  });

  it("clearing the conflicting channel with null in the same body passes", async () => {
    state.selectQueue = [[guildRow()]];
    state.updateResult = [guildRow()];
    expect((await patch({ honeypotChannelId: CH2, logChannelId: null })).status).toBe(200);
  });

  it("a conflict inside the body itself gives 400", async () => {
    state.selectQueue = [[guildRow({ logChannelId: null })]];
    expect(await patch({ honeypotChannelId: CH1, welcomeChannelId: CH1 })).toEqual({ status: 400, text: hp("welcome") });
  });

  it("setting a conflict field to the stored honeypot channel gives 400", async () => {
    state.selectQueue = [[guildRow({ honeypotChannelId: CH1 })]];
    expect(await patch({ birthdayChannelId: CH1 })).toEqual({ status: 400, text: hp("birthday") });
  });

  it("xp and honeypot both bad: the xp error wins", async () => {
    state.selectQueue = [[guildRow()], [guildRow()]];
    expect(await patch({ xpMin: 30, honeypotChannelId: CH2 })).toEqual({ status: 400, text: XP_ERR });
  });

  it("xp valid and honeypot bad: the honeypot error", async () => {
    state.selectQueue = [[guildRow()], [guildRow()]];
    expect(await patch({ xpMin: 20, honeypotChannelId: CH2 })).toEqual({ status: 400, text: hp("log") });
  });

  it("xp and honeypot both valid: one full guild-row read serves both checks (P13)", async () => {
    // Before P13 this read the row twice: ["select:xpMin,xpMax", "select:*", "update"]
    state.selectQueue = [[guildRow()], [guildRow()]];
    state.updateResult = [guildRow()];
    expect((await patch({ xpMin: 20, honeypotChannelId: CH1 })).status).toBe(200);
    expect(state.calls).toEqual(["select:*", "update"]);
  });

  it("row missing: both checks skipped, update returns nothing, 404, no reload", async () => {
    state.selectQueue = [[], []];
    state.updateResult = [];
    expect(await patch({ xpMin: 30, honeypotChannelId: CH2 })).toEqual({
      status: 404,
      text: '{"error":"Server not found","code":"NOT_FOUND"}',
    });
    expect(state.calls.at(-1)).toBe("update");
    expect(mocks.notifyBotReload).not.toHaveBeenCalled();
  });

  it("success: update gets the body plus updatedAt, reload once, id stripped", async () => {
    state.updateResult = [guildRow({ isWelcomeEnabled: true })];
    const res = await patch({ isWelcomeEnabled: true });
    expect(res.status).toBe(200);
    expect(Object.keys(state.updateSet!)).toEqual(["isWelcomeEnabled", "updatedAt"]);
    expect(mocks.notifyBotReload).toHaveBeenCalledTimes(1);
    expect(mocks.notifyBotReload).toHaveBeenCalledWith(GUILD);
    const expected = guildRow({ isWelcomeEnabled: true }) as Record<string, unknown>;
    delete expected.id;
    expect(res.text).toBe(JSON.stringify(expected));
  });
});

describe("/api/profile strip", () => {
  const userRow = () => ({
    id: "u-uuid",
    discordId: USER,
    email: "a@b.c",
    isVerified: true,
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    isBanned: false,
    banGuildId: null,
    bannedAt: null,
    isProfileDisabled: false,
    jwtInvalidBefore: null,
    name: "Kev",
    birthMonth: 1,
  });
  const safe = () => {
    const r = userRow() as Record<string, unknown>;
    for (const k of ["id", "email", "jwtInvalidBefore", "banGuildId", "bannedAt", "isBanned"]) delete r[k];
    return JSON.stringify(r);
  };

  it("GET strips the six sensitive fields", async () => {
    state.selectQueue = [[userRow()]];
    const res = await profile.GET(new Request("http://localhost/api/profile"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(safe());
  });

  it("GET missing row", async () => {
    const res = await profile.GET(new Request("http://localhost/api/profile"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Profile not found","code":"NOT_FOUND"}');
  });

  it("PATCH strips the same fields", async () => {
    state.updateResult = [userRow()];
    const res = await profile.PATCH(
      new Request("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify({ name: "Kev" }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(safe());
  });

  it("PATCH missing row", async () => {
    state.updateResult = [];
    const res = await profile.PATCH(
      new Request("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify({ name: "Kev" }) }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Profile not found","code":"NOT_FOUND"}');
  });
});
