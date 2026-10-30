import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLEANUP_SECONDS,
  HONEYPOT_REASON_MARKER,
  HoneypotService,
  IN_FLIGHT_TIMEOUT_MS,
  LATE_MESSAGE_WINDOW_MS,
  RECORD_TTL_MS,
  SWEEP_DELAY_MS,
  UNBAN_REASON,
  WARNING_COLOR,
  WARNING_TITLE,
  decideHoneypot,
  isHoneypotReason,
  isRealPost,
  removalReason,
  warningText,
  type ActionRecord,
} from "../../src/services/honeypot.service.js";

const rec: ActionRecord = { action: "kick", reason: "[Honeypot kick] posted in #trap (msg 111)", channelId: "c1" };

describe("honeypot rules", () => {
  it("words the warning for each action", () => {
    expect(warningText("kick")).toBe("If you send a message in this channel, you will be automatically kicked. There will be no exceptions.");
    expect(warningText("ban")).toBe("If you send a message in this channel, you will be automatically banned. There will be no exceptions.");
    expect(WARNING_TITLE).toBe("⚠️ Do not post in this channel");
    expect(WARNING_COLOR).toBe(0xf0b232);
  });

  it("builds marked, searchable reasons", () => {
    expect(removalReason("ban", "trap", "111")).toBe("[Honeypot] posted in #trap (msg 111)");
    expect(removalReason("kick", "trap", "111")).toBe("[Honeypot kick] posted in #trap (msg 111)");
    expect(UNBAN_REASON).toBe("[Honeypot kick] unban after message cleanup");
    expect(isHoneypotReason("[Honeypot kick] posted in #trap (msg 1)")).toBe(true);
    expect(isHoneypotReason("spamming")).toBe(false);
    expect(isHoneypotReason(null)).toBe(false);
    // Every reason DragonBot writes carries the marker that keeps it out of ban sync.
    expect(HONEYPOT_REASON_MARKER).toBe("[Honeypot");
    expect(isHoneypotReason(removalReason("ban", "trap", "111"))).toBe(true);
    expect(isHoneypotReason(UNBAN_REASON)).toBe(true);
    expect(isHoneypotReason(undefined)).toBe(false);
  });

  it("ignores system, webhook and bot messages", () => {
    expect(isRealPost({ system: true, webhookId: null, authorIsBot: false })).toBe(false);
    expect(isRealPost({ system: false, webhookId: "w", authorIsBot: false })).toBe(false);
    expect(isRealPost({ system: false, webhookId: null, authorIsBot: true })).toBe(false);
    expect(isRealPost({ system: false, webhookId: null, authorIsBot: false })).toBe(true);
  });

  it("decides by member status", () => {
    expect(decideHoneypot({ kind: "member", isStaff: true, isVerified: true })).toEqual({ type: "ignore" });
    expect(decideHoneypot({ kind: "member", isStaff: true, isVerified: false })).toEqual({ type: "ignore" });
    expect(decideHoneypot({ kind: "member", isStaff: false, isVerified: true })).toEqual({ type: "delete_only", why: "verified" });
    expect(decideHoneypot({ kind: "member", isStaff: false, isVerified: false })).toEqual({ type: "remove", memberLeft: false });
    expect(decideHoneypot({ kind: "left" })).toEqual({ type: "remove", memberLeft: true });
    expect(decideHoneypot({ kind: "lookup_failed" })).toEqual({ type: "delete_only", why: "lookup_failed" });
  });

  it("uses the agreed cleanup window and timings", () => {
    expect(CLEANUP_SECONDS).toBe(3600);
    expect(RECORD_TTL_MS).toBe(600_000);
    expect(LATE_MESSAGE_WINDOW_MS).toBe(120_000);
    expect(IN_FLIGHT_TIMEOUT_MS).toBe(120_000);
    expect(SWEEP_DELAY_MS).toBe(15_000);
  });
});

describe("HoneypotService", () => {
  let svc: HoneypotService;

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    svc = new HoneypotService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups messages into one case until the action ends, then by timestamp", () => {
    expect(svc.beginCase("g", "u", 1000)).toBe("start");
    expect(svc.beginCase("g", "u", 1001)).toBe("same_case");      // in flight
    vi.setSystemTime(5000); svc.endCase("g", "u");
    expect(svc.beginCase("g", "u", 4999)).toBe("same_case");      // sent before the action finished
    expect(svc.beginCase("g", "u", 6000)).toBe("start");          // rejoined and posted again
    expect(svc.beginCase("g2", "u", 6000)).toBe("start");         // other server is independent
  });

  it("treats a stuck in-flight case as over after the in-flight timeout", () => {
    expect(svc.beginCase("g", "u", Date.now())).toBe("start");
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS - 1);
    expect(svc.beginCase("g", "u", Date.now())).toBe("same_case");
    vi.advanceTimersByTime(2);
    expect(svc.beginCase("g", "u", Date.now())).toBe("start");
  });

  it("keeps a record alive until the ban resolves, then for RECORD_TTL_MS", () => {
    svc.recordAction("g", "u", rec); vi.advanceTimersByTime(RECORD_TTL_MS * 3);   // still pending
    svc.confirmAction("g", "u"); vi.advanceTimersByTime(RECORD_TTL_MS - 1);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec);
  });

  it("expires a confirmed record after RECORD_TTL_MS", () => {
    svc.recordAction("g", "u", rec); svc.confirmAction("g", "u");
    vi.advanceTimersByTime(RECORD_TTL_MS + 1);
    expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toBeNull();
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("matches each event type at most once per record", () => {
    svc.recordAction("g", "u", rec); svc.confirmAction("g", "u");
    expect(svc.takeBanEvent("g", "u")).toEqual(rec); expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec); expect(svc.takeRemoveEvent("g", "u")).toBeNull();
  });

  it("drops a record when the ban fails", () => {
    svc.recordAction("g", "u", rec);
    svc.dropAction("g", "u");
    expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toBeNull();
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("reports recent action from recordAction until RECORD_TTL_MS after confirm, and the late window for 2 minutes", () => {
    svc.recordAction("g", "u", rec); expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);          // not confirmed yet
    svc.confirmAction("g", "u"); expect(svc.isWithinLateWindow("g", "u")).toBe(true);
    vi.advanceTimersByTime(LATE_MESSAGE_WINDOW_MS + 1); expect(svc.isWithinLateWindow("g", "u")).toBe(false);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
  });

  it("keeps the recent-action and late windows after both events are taken", () => {
    svc.recordAction("g", "u", rec); svc.confirmAction("g", "u");
    expect(svc.takeBanEvent("g", "u")).toEqual(rec); expect(svc.takeRemoveEvent("g", "u")).toEqual(rec);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);
  });

  it("replaces the record when the same account is actioned again", () => {
    svc.recordAction("g", "u", rec); svc.confirmAction("g", "u");
    svc.takeBanEvent("g", "u"); svc.takeRemoveEvent("g", "u");
    const rec2 = { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" };
    svc.recordAction("g", "u", rec2); svc.confirmAction("g", "u");
    expect(svc.takeBanEvent("g", "u")).toEqual(rec2);
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec2);
  });

  it("keeps the late window running while a new case is pending, until dropAction", () => {
    svc.recordAction("g", "u", rec); svc.confirmAction("g", "u");
    vi.advanceTimersByTime(30_000);
    svc.recordAction("g", "u", { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" }); // rejoined and posted again
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);
    svc.dropAction("g", "u");                                                                    // the new ban failed
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("consumes own deletions once", () => {
    svc.markOwnDeletion("m1");
    expect(svc.consumeOwnDeletion("m1")).toBe(true);
    expect(svc.consumeOwnDeletion("m1")).toBe(false);
    expect(svc.consumeOwnDeletion("m2")).toBe(false);
    svc.markOwnDeletion("m3");
    vi.advanceTimersByTime(10 * 60_000 + 1);                        // skip-set entries last 10 minutes
    expect(svc.consumeOwnDeletion("m3")).toBe(false);
  });

  it("runs work for the same key one at a time", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = svc.runExclusive("g", async () => {
      events.push("first start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push("first end");
      return 1;
    });
    const second = svc.runExclusive("g", async () => {
      events.push("second start");
      return 2;
    });
    const other = svc.runExclusive("h", async () => {
      events.push("other start");
      return 3;
    });

    await expect(other).resolves.toBe(3);                         // another key isn't held up by "g"
    expect(events).toEqual(["first start", "other start"]);        // second waits for first

    releaseFirst();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(["first start", "other start", "first end", "second start"]);
  });

  it("keeps running work for a key after an earlier call fails", async () => {
    const failing = svc.runExclusive("g", async () => { throw new Error("boom"); });
    const next = svc.runExclusive("g", async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
    await expect(svc.runExclusive("g", async () => "idle again")).resolves.toBe("idle again");
  });

  it("drain waits for tracked work but not past the timeout", async () => {
    const work = svc.track(new Promise<string>((resolve) => setTimeout(() => resolve("done"), 1000)));
    let drained = false;
    void svc.drain(5000).then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(drained).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(drained).toBe(true);
    await expect(work).resolves.toBe("done");

    svc.track(new Promise<never>(() => {}));
    let stuckDrained = false;
    void svc.drain(5000).then(() => { stuckDrained = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(stuckDrained).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stuckDrained).toBe(true);
  });

  it("drain also waits for work tracked while it is draining", async () => {
    svc.track(new Promise<void>((resolve) => setTimeout(resolve, 1000)));
    let drained = false;
    void svc.drain(5000).then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(500);
    svc.track(new Promise<void>((resolve) => setTimeout(resolve, 2000)));   // started during shutdown, done at 2500
    await vi.advanceTimersByTimeAsync(1000);
    expect(drained).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(drained).toBe(true);
  });

  it("drain finishes without waiting out the timeout when tracked work fails", async () => {
    let fail!: (err: Error) => void;
    const failing = svc.track(new Promise<never>((_, reject) => { fail = reject; }));
    const failingChecked = expect(failing).rejects.toThrow("ban failed");
    const drained = svc.drain(5000);
    fail(new Error("ban failed"));
    await failingChecked;
    await expect(drained).resolves.toBeUndefined();               // no timers advanced, so the work settling ended it
  });
});
