import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of the API routes that use the shared contracts (D4, P17):
// suggestion statuses, the UUID path check and the YouTube channel-id check.
// Pins status codes and JSON bodies so moving the constants changes nothing.

const state = vi.hoisted(() => ({ grants: ["*"] as string[] }));

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

import * as schedule from "@/app/api/server/[guildId]/schedules/[scheduleId]/route";
import * as youtube from "@/app/api/server/[guildId]/youtube/route";
import * as youtubeResolve from "@/app/api/server/[guildId]/youtube/resolve/route";
import * as subscription from "@/app/api/server/[guildId]/youtube/[subscriptionId]/route";
import * as suggestion from "@/app/api/server/[guildId]/suggestions/[suggestionId]/route";

const GUILD = "222222222222222222";
const UUID = "123e4567-e89b-12d3-a456-426614174000";
const STATUSES = ["pending", "approved", "rejected", "completed", "archived"];

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown) {
  const req = new Request(`http://localhost/api/server/${GUILD}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve({ guildId: GUILD, ...params }) });
  return { status: res.status, body: await res.json().catch(() => "<no json>") };
}

beforeEach(() => {
  state.grants = ["*"];
  fetchMock.mockClear();
});

describe("suggestion PATCH status enum", () => {
  for (const s of STATUSES) {
    it(`accepts "${s}" (reaches the db, which finds nothing)`, async () => {
      expect(await call(suggestion.PATCH, "PATCH", { suggestionId: UUID }, { status: s })).toEqual({
        status: 404,
        body: { error: "Not found" },
      });
    });
  }

  it("rejects an unknown status with the pinned 400 body", async () => {
    expect(await call(suggestion.PATCH, "PATCH", { suggestionId: UUID }, { status: "bogus" })).toEqual({
      status: 400,
      body: {
        error: "Invalid data",
        details: [
          {
            received: "bogus",
            code: "invalid_enum_value",
            options: STATUSES,
            path: ["status"],
            message: `Invalid enum value. Expected ${STATUSES.map((s) => `'${s}'`).join(" | ")}, received 'bogus'`,
          },
        ],
      },
    });
  });
});

const uuidRoutes: [string, unknown, string, string][] = [
  ["schedules/[id] DELETE", schedule.DELETE, "DELETE", "scheduleId"],
  ["youtube/[id] DELETE", subscription.DELETE, "DELETE", "subscriptionId"],
  ["suggestions/[id] DELETE", suggestion.DELETE, "DELETE", "suggestionId"],
];

describe("UUID path check", () => {
  for (const [name, handler, method, key] of uuidRoutes) {
    it(`${name}: a malformed id gets 404 with code NOT_FOUND`, async () => {
      for (const bad of ["not-a-uuid", `${UUID}0`, UUID.replace(/-/g, ""), ` ${UUID}`]) {
        expect(await call(handler, method, { [key]: bad })).toEqual({
          status: 404,
          body: { error: "Not found", code: "NOT_FOUND" },
        });
      }
    });

    it(`${name}: lower- and upper-case UUIDs pass the check`, async () => {
      for (const ok of [UUID, UUID.toUpperCase()]) {
        expect(await call(handler, method, { [key]: ok })).toEqual({ status: 404, body: { error: "Not found" } });
      }
    });

    it(`${name}: repeated calls give the same answer (no regex state)`, async () => {
      for (let i = 0; i < 3; i++) {
        expect((await call(handler, method, { [key]: UUID })).body).toEqual({ error: "Not found" });
      }
    });
  }
});

describe("youtube POST channel id", () => {
  const notify = "333333333333333333";
  const invalid = (id: string) => ({
    status: 400,
    body: {
      error: "Invalid data",
      details: [
        {
          validation: "regex",
          code: "invalid_string",
          message: "Invalid YouTube channel ID (must start with UC)",
          path: ["youtubeChannelId"],
        },
      ],
    },
    id,
  });

  for (const bad of [`UC${"a".repeat(21)}`, `UC${"a".repeat(23)}`, `UX${"a".repeat(22)}`, `uc${"a".repeat(22)}`, `UC${"a".repeat(21)}!`]) {
    it(`rejects ${bad}`, async () => {
      const { id: _id, ...expected } = invalid(bad);
      expect(await call(youtube.POST, "POST", {}, { youtubeChannelId: bad, notifyChannelId: notify })).toEqual(expected);
    });
  }

  it("accepts UC plus 22 word or dash characters (passes validation)", async () => {
    // The mocked insert returns no row, so the handler fails only after validation,
    // when it serialises rows[0] (undefined) into the 201 response.
    await expect(
      call(youtube.POST, "POST", {}, { youtubeChannelId: `UC${"a_-".repeat(7)}z`, notifyChannelId: notify }),
    ).rejects.toThrow("Value is not JSON serializable");
  });
});

describe("youtube/resolve POST with a bare channel id", () => {
  it("treats UC plus 22 characters as a channel id", async () => {
    const id = `UC${"x".repeat(22)}`;
    expect(await call(youtubeResolve.POST, "POST", {}, { query: id })).toEqual({
      status: 200,
      body: { channelId: id, channelName: id },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(`https://www.youtube.com/channel/${id}`);
  });

  it("does not treat UC plus 21 characters as a channel id", async () => {
    const id = `UC${"x".repeat(21)}`;
    const res = await call(youtubeResolve.POST, "POST", {}, { query: id });
    expect(res).toEqual({
      status: 404,
      body: { error: "Could not find a YouTube channel. Try pasting the full channel URL." },
    });
    expect((fetchMock.mock.calls[0] as unknown[])[0]).not.toBe(`https://www.youtube.com/channel/${id}`);
  });
});
