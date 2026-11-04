import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveDiscordUsers (P3): concurrency ceiling, call count, result order and
// the omitted failures. The first block is characterization (recorded on the
// fixed-wave code); the "sliding pool" test is new with the P3 change.

vi.mock("@/lib/env", () => ({ env: { DISCORD_API_TOKEN: "test-token" } }));
vi.mock("@/lib/db", () => ({ db: {} }));

type Responder = (url: string) => Response | Promise<Response>;
const fetchState = { respond: (() => new Response("", { status: 404 })) as Responder };
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => fetchState.respond(url));
vi.stubGlobal("fetch", fetchMock);

import { mapWithConcurrency, resolveDiscordUsers } from "@/lib/discord";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let seq = 0;
const freshIds = (n: number) =>
  Array.from({ length: n }, () => `6${String(Date.now()).slice(-8)}${String(++seq).padStart(8, "0")}`);

const idOf = (url: string) => url.split("/").pop()!;

beforeEach(() => {
  fetchMock.mockClear();
});

describe("resolveDiscordUsers (characterization)", () => {
  it("empty input: empty map, no fetch", async () => {
    const map = await resolveDiscordUsers([]);
    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("12 ids: 12 fetches, never more than 5 in flight, input-order map without failures", async () => {
    const ids = freshIds(12);
    const failing = new Set([ids[2], ids[7], ids[11]]);
    let inFlight = 0;
    let maxInFlight = 0;
    fetchState.respond = async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // finish in a scrambled order
      const id = idOf(url);
      await new Promise((r) => setTimeout(r, (ids.indexOf(id) * 7) % 5));
      inFlight--;
      if (failing.has(id)) return new Response("", { status: ids.indexOf(id) === 7 ? 429 : 404 });
      return json({ id, username: `u${id}`, global_name: null, avatar: null });
    };
    const map = await resolveDiscordUsers(ids);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBe(5);
    expect([...map.keys()]).toEqual(ids.filter((id) => !failing.has(id)));
    expect(map.get(ids[0]!)).toEqual({ username: `u${ids[0]}`, displayName: `u${ids[0]}`, avatarUrl: null });
    // each id is started exactly once, in input order
    expect(fetchMock.mock.calls.map((c) => idOf(c[0] as string))).toEqual(ids);
  });

  it("concurrency 1 runs one at a time", async () => {
    const ids = freshIds(3);
    let inFlight = 0;
    let maxInFlight = 0;
    fetchState.respond = async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const id = idOf(url);
      return json({ id, username: "x", global_name: null, avatar: null });
    };
    const map = await resolveDiscordUsers(ids, 1);
    expect(maxInFlight).toBe(1);
    expect(map.size).toBe(3);
  });
});

describe("resolveDiscordUsers sliding pool (P3)", () => {
  it("a slow lookup does not hold back the next ids", async () => {
    const ids = freshIds(7);
    const releaseSlow: (() => void)[] = [];
    fetchState.respond = async (url) => {
      const id = idOf(url);
      if (id === ids[0]) await new Promise<void>((r) => releaseSlow.push(r));
      return json({ id, username: "x", global_name: null, avatar: null });
    };
    const done = resolveDiscordUsers(ids);
    // let every fast lookup finish while ids[0] is still pending
    for (let i = 0; i < 50 && fetchMock.mock.calls.length < 7; i++) await new Promise((r) => setTimeout(r, 0));
    // with fixed waves of 5 only the first wave would have started
    expect(fetchMock).toHaveBeenCalledTimes(7);
    releaseSlow[0]!();
    const map = await done;
    expect([...map.keys()]).toEqual(ids);
  });
});

describe("mapWithConcurrency edge cases", () => {
  it("a NaN concurrency runs one call at a time instead of none", async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapWithConcurrency([1, 2, 3], Number.NaN, async (n) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6]);
    expect(max).toBe(1);
  });

  it("after a rejection no further calls start, and the error is passed on", async () => {
    const started: number[] = [];
    const err = new Error("boom");
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
        started.push(n);
        await new Promise((r) => setTimeout(r, n === 0 ? 1 : 5));
        if (n === 0) throw err;
        return n;
      }),
    ).rejects.toBe(err);
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toEqual([0, 1]);
  });
});
