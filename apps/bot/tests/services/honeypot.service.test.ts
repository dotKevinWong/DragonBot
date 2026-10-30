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
  UNCERTAIN_RECORD_TTL_MS,
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
    expect(UNCERTAIN_RECORD_TTL_MS).toBe(60_000);
    expect(LATE_MESSAGE_WINDOW_MS).toBe(120_000);
    expect(IN_FLIGHT_TIMEOUT_MS).toBe(900_000);
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

  /** The ID of a case that beginCase started. */
  function caseIdOf(started: ReturnType<HoneypotService["beginCase"]>): number {
    if (started.kind !== "start") throw new Error("expected a new case");
    return started.caseId;
  }

  /** Starts a case for "g"/"u" with a message sent now, and returns its ID. */
  function startCase(): number {
    return caseIdOf(svc.beginCase("g", "u", Date.now()));
  }

  it("groups messages into one case until the action ends, then by timestamp", () => {
    const first = svc.beginCase("g", "u", 1000);
    expect(first.kind).toBe("start");
    expect(svc.beginCase("g", "u", 1001).kind).toBe("same_case");      // in flight
    vi.setSystemTime(5000); svc.endCase("g", "u", caseIdOf(first));
    expect(svc.beginCase("g", "u", 4999).kind).toBe("same_case");      // sent before the action finished
    expect(svc.beginCase("g", "u", 6000).kind).toBe("start");          // rejoined and posted again
    expect(svc.beginCase("g2", "u", 6000).kind).toBe("start");         // other server is independent
  });

  it("treats a stuck in-flight case as over after the in-flight timeout", () => {
    expect(svc.beginCase("g", "u", Date.now()).kind).toBe("start");
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS - 1);
    expect(svc.beginCase("g", "u", Date.now()).kind).toBe("same_case");
    vi.advanceTimersByTime(2);
    expect(svc.beginCase("g", "u", Date.now()).kind).toBe("start");
  });

  it("ignores calls from a case that timed out", () => {
    const first = startCase();
    expect(svc.recordAction("g", "u", first, rec)).toBe(true);
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS + 1);                    // the first case's ban is still queued
    const second = startCase();
    const rec2 = { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" };
    expect(svc.recordAction("g", "u", second, rec2)).toBe(true);
    expect(svc.recordAction("g", "u", first, rec)).toBe(false);
    svc.confirmAction("g", "u", second);
    vi.advanceTimersByTime(60_000);
    svc.dropAction("g", "u", first);                                     // the first case's late calls
    svc.confirmAction("g", "u", first);
    svc.confirmAction("g", "u", first, { uncertain: true });
    svc.endCase("g", "u", first);
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);
    expect(svc.beginCase("g", "u", Date.now()).kind).toBe("same_case"); // the second case is still in flight
    expect(svc.takeBanEvent("g", "u")).toEqual(rec2);
    vi.advanceTimersByTime(LATE_MESSAGE_WINDOW_MS - 60_000 + 1);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);                // still timed from the second case's confirm
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);                // and its record still lives RECORD_TTL_MS from it
  });

  it("returns false from recordAction once the case has timed out", () => {
    const id = startCase();
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS + 1);                    // the message delete or the ban check hung
    expect(svc.recordAction("g", "u", id, rec)).toBe(false);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("leaves no finish time behind when a case that timed out calls endCase", () => {
    const id = startCase();
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS + 1);                    // no method has swept since
    svc.endCase("g", "u", id);
    expect(svc.beginCase("g", "u", Date.now() - 1).kind).toBe("start");
  });

  it("keeps a record alive until the ban resolves, then for RECORD_TTL_MS", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec); vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS - 1);   // still pending
    svc.confirmAction("g", "u", id); vi.advanceTimersByTime(RECORD_TTL_MS - 1);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec);
  });

  it("expires a record that is never confirmed when its case times out", () => {
    const id = startCase();
    vi.advanceTimersByTime(60_000);                                      // the message delete and the ban check took a minute
    svc.recordAction("g", "u", id, rec);
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS - 60_000 - 1);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
    vi.advanceTimersByTime(2);                                           // IN_FLIGHT_TIMEOUT_MS + 1 after beginCase; no confirm or drop came
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
    expect(svc.takeBanEvent("g", "u")).toBeNull();
  });

  it("doesn't bring an expired pending record back when confirmAction arrives after its case timed out", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec);
    vi.advanceTimersByTime(IN_FLIGHT_TIMEOUT_MS + 1);                    // no method has swept since
    svc.confirmAction("g", "u", id);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("expires a confirmed record after RECORD_TTL_MS", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec); svc.confirmAction("g", "u", id);
    vi.advanceTimersByTime(RECORD_TTL_MS + 1);
    expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toBeNull();
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("matches each event type at most once per record", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec); svc.confirmAction("g", "u", id);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec); expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec); expect(svc.takeRemoveEvent("g", "u")).toBeNull();
  });

  it("matches ban and remove events to a record that is still pending", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec);                                 // the gateway events can beat the ban call's response
    expect(svc.takeBanEvent("g", "u")).toEqual(rec); expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec); expect(svc.takeRemoveEvent("g", "u")).toBeNull();
  });

  it("drops a record when the ban fails", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec);
    svc.dropAction("g", "u", id);
    expect(svc.takeBanEvent("g", "u")).toBeNull();
    expect(svc.takeRemoveEvent("g", "u")).toBeNull();
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("reports recent action from recordAction until RECORD_TTL_MS after confirm, and the late window for 2 minutes", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec); expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);          // not confirmed yet
    svc.confirmAction("g", "u", id); expect(svc.isWithinLateWindow("g", "u")).toBe(true);
    vi.advanceTimersByTime(LATE_MESSAGE_WINDOW_MS + 1); expect(svc.isWithinLateWindow("g", "u")).toBe(false);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
  });

  it("opens no late window when confirmAction finds no record", () => {
    const id = startCase();
    svc.confirmAction("g", "u", id);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);
  });

  it("keeps an uncertain confirmation for a minute and opens no late window", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec);
    vi.advanceTimersByTime(90_000);                                      // the ban and the ban-list check both failed, after retries
    svc.confirmAction("g", "u", id, { uncertain: true });                // nobody can tell whether the ban happened
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);                // the account may still be a member
    vi.advanceTimersByTime(UNCERTAIN_RECORD_TTL_MS);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);                // counted from the confirmation, not from beginCase
    expect(svc.takeBanEvent("g", "u")).toEqual(rec);                     // a ban that landed late still stays out of ban sync
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec);
    vi.advanceTimersByTime(1);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);               // gone, so a moderator's ban or kick from now on is handled normally
  });

  it("keeps the recent-action and late windows after both events are taken", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec); svc.confirmAction("g", "u", id);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec); expect(svc.takeRemoveEvent("g", "u")).toEqual(rec);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);
  });

  it("replaces the record when the same account is actioned again", () => {
    const first = startCase();
    svc.recordAction("g", "u", first, rec); svc.confirmAction("g", "u", first);
    svc.takeBanEvent("g", "u"); svc.takeRemoveEvent("g", "u");
    svc.endCase("g", "u", first);
    const rec2 = { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" };
    const second = startCase();
    svc.recordAction("g", "u", second, rec2); svc.confirmAction("g", "u", second);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec2);
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec2);
  });

  it("never matches a remove event to an action on an account that had already left", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec, { memberLeft: true });
    expect(svc.takeRemoveEvent("g", "u")).toBeNull();               // the departure before the ban, if its event comes in late
    svc.confirmAction("g", "u", id);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec);                // a ban by ID sends only the ban event
    vi.advanceTimersByTime(9 * 60_000);                             // rejoined, then left or was kicked again
    expect(svc.takeRemoveEvent("g", "u")).toBeNull();
    expect(svc.wasRecentlyActioned("g", "u")).toBe(true);
  });

  it("matches the remove event again when the rejoined account is actioned as a member", () => {
    const first = startCase();
    svc.recordAction("g", "u", first, rec, { memberLeft: true }); svc.confirmAction("g", "u", first);
    svc.takeBanEvent("g", "u");
    svc.endCase("g", "u", first);
    const rec2 = { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" };
    const second = startCase();                                                                       // rejoined and posted again
    svc.recordAction("g", "u", second, rec2, { memberLeft: false }); svc.confirmAction("g", "u", second);
    expect(svc.takeBanEvent("g", "u")).toEqual(rec2);
    expect(svc.takeRemoveEvent("g", "u")).toEqual(rec2);
  });

  it("closes the late window it opened when the same case's ban is dropped", () => {
    const id = startCase();
    svc.recordAction("g", "u", id, rec); svc.confirmAction("g", "u", id);
    svc.dropAction("g", "u", id);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
  });

  it("keeps the late window running while a new case is pending, even when the new ban fails", () => {
    const first = startCase();
    svc.recordAction("g", "u", first, rec); svc.confirmAction("g", "u", first); svc.endCase("g", "u", first);
    vi.advanceTimersByTime(30_000);
    const second = startCase();                                                                       // rejoined and posted again
    svc.recordAction("g", "u", second, { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" });
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);
    svc.dropAction("g", "u", second);                                                                 // the new ban failed
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);                                              // the first case opened it
    expect(svc.wasRecentlyActioned("g", "u")).toBe(false);
    vi.advanceTimersByTime(LATE_MESSAGE_WINDOW_MS - 30_000 + 1);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);
  });

  it("leaves an earlier case's late window alone when a new case's confirmation is uncertain", () => {
    const first = startCase();
    svc.recordAction("g", "u", first, rec); svc.confirmAction("g", "u", first); svc.endCase("g", "u", first);
    vi.advanceTimersByTime(30_000);
    const second = startCase();                                                                       // rejoined and posted again
    svc.recordAction("g", "u", second, { ...rec, reason: "[Honeypot kick] posted in #trap (msg 222)" });
    svc.confirmAction("g", "u", second, { uncertain: true });
    expect(svc.isWithinLateWindow("g", "u")).toBe(true);                                              // the first case opened it
    vi.advanceTimersByTime(LATE_MESSAGE_WINDOW_MS - 30_000 + 1);
    expect(svc.isWithinLateWindow("g", "u")).toBe(false);                                             // the uncertain one opened none
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

  it("leaves no chain entry behind once runExclusive work settles", async () => {
    vi.useRealTimers();                                              // so the setImmediate below is a real macrotask
    const chains = (svc as unknown as { exclusiveChains: Map<string, unknown> }).exclusiveChains;
    const succeeded = svc.runExclusive("g", async () => "ok");
    const failed = svc.runExclusive("g", async () => { throw new Error("boom"); });
    const otherKey = svc.runExclusive("h", async () => "other");
    expect(chains.size).toBe(2);                                     // one chain per key while work is queued
    await expect(succeeded).resolves.toBe("ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(otherKey).resolves.toBe("other");
    await new Promise((resolve) => setImmediate(resolve));
    expect(chains.size).toBe(0);
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

  it("doesn't raise an unhandled rejection when a tracked promise rejects unobserved", async () => {
    vi.useRealTimers();                                              // so the setImmediate below is a real macrotask
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let fail!: (err: Error) => void;
      const work = new Promise<never>((_, reject) => { fail = reject; });
      svc.track(work);                                               // registered for the drain; the result is ignored
      const handled = work.catch((err: Error) => err.message);       // the caller handles its own handle
      fail(new Error("ban failed"));
      await expect(handled).resolves.toBe("ban failed");
      await new Promise((resolve) => setImmediate(resolve));         // Node reports unhandled rejections before this runs
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
