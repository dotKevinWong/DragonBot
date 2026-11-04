import { describe, it, expect, vi, afterEach } from "vitest";
import { TTLCache } from "../../src/utils/cache.js";

describe("TTLCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gets, sets, invalidates and expires entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new TTLCache<number>(10);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
    cache.invalidate("a");
    expect(cache.get("a")).toBeUndefined();

    vi.setSystemTime(10_000); // exactly at the TTL: still there
    expect(cache.get("b")).toBe(2);
    vi.setSystemTime(10_001);
    expect(cache.get("b")).toBeUndefined();
  });

  it("values() returns live values in insertion order and drops expired ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new TTLCache<string>(10);
    cache.set("old", "x");
    vi.setSystemTime(5_000);
    cache.set("new", "y");
    cache.set("newer", "z");
    expect(cache.values()).toEqual(["x", "y", "z"]);
    vi.setSystemTime(10_500);
    expect(cache.values()).toEqual(["y", "z"]);
    vi.setSystemTime(10_000_000);
    expect(cache.values()).toEqual([]);
  });

  it("re-setting a key refreshes its expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new TTLCache<number>(10);
    cache.set("a", 1);
    vi.setSystemTime(9_000);
    cache.set("a", 2);
    vi.setSystemTime(15_000);
    expect(cache.get("a")).toBe(2);
  });
});
