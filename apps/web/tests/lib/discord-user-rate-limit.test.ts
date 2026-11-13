import { beforeEach, describe, expect, it, vi } from "vitest";

// Discord allows 30 GET /users/{id} per second. The leaderboard resolves 100 users at once, so rows past
// the 30th used to come back 429 and show as bare IDs. User lookups now wait for the bucket and retry a 429.

vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({ db: {} }));

type Responder = (url: string, call: number) => Response | Promise<Response>;
const fetchState = { respond: (() => new Response("", { status: 404 })) as Responder, calls: 0 };
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => fetchState.respond(url, ++fetchState.calls));
vi.stubGlobal("fetch", fetchMock);

import { resolveDiscordUsers } from "@/lib/discord";

const idOf = (url: string) => url.split("/").pop()!;
const user = (id: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ id, username: `u${id}`, global_name: null, avatar: null }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

let seq = 0;
const freshIds = (n: number) => Array.from({ length: n }, () => `7${String(Date.now()).slice(-8)}${String(++seq).padStart(8, "0")}`);

beforeEach(() => {
  fetchMock.mockClear();
  fetchState.calls = 0;
});

describe("user lookups and Discord's rate limit", () => {
  it("retries a 429 after its retry_after and resolves the user", async () => {
    const [id] = freshIds(1);
    fetchState.respond = (url, call) =>
      call === 1
        ? new Response(JSON.stringify({ retry_after: 0.02, global: false }), { status: 429, headers: { "content-type": "application/json" } })
        : user(idOf(url));
    const started = Date.now();
    const map = await resolveDiscordUsers([id!]);
    expect(map.get(id!)?.username).toBe(`u${id}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("gives up after two retries", async () => {
    const [id] = freshIds(1);
    fetchState.respond = () => new Response("", { status: 429, headers: { "retry-after": "0.01" } });
    const map = await resolveDiscordUsers([id!]);
    expect(map.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not wait on a 429 that asks for more than 5 seconds", async () => {
    const [id] = freshIds(1);
    fetchState.respond = () => new Response("", { status: 429, headers: { "retry-after": "60" } });
    const map = await resolveDiscordUsers([id!]);
    expect(map.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds later lookups when the bucket reports none remaining", async () => {
    const ids = freshIds(2);
    const startedAt: number[] = [];
    fetchState.respond = (url) => {
      startedAt.push(Date.now());
      return user(idOf(url), { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.05" });
    };
    const map = await resolveDiscordUsers(ids, 1);
    expect(map.size).toBe(2);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(40);
  });
});
