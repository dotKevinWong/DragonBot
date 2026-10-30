import type { HoneypotAction } from "@dragonbot/db";
import { TTLCache } from "../utils/cache.js";

export const WARNING_TITLE = "⚠️ Do not post in this channel";
export const WARNING_COLOR = 0xf0b232;

/** How far back a honeypot ban deletes the account's messages (Discord's deleteMessageSeconds). */
export const CLEANUP_SECONDS = 3600;

/** Every reason DragonBot writes for the honeypot carries this; ban sync skips any ban whose reason does. */
export const HONEYPOT_REASON_MARKER = "[Honeypot";

export const UNBAN_REASON = "[Honeypot kick] unban after message cleanup";

/** How long an action record lives, counted from when the ban call resolves. */
export const RECORD_TTL_MS = 600_000;

/** How long after the ban resolves the account's new messages are deleted on arrival. */
export const LATE_MESSAGE_WINDOW_MS = 120_000;

/** A case still in flight after this long is treated as over, so a stuck action can't hold an account forever. */
export const IN_FLIGHT_TIMEOUT_MS = 120_000;

/** How long after a removal DragonBot sweeps the account's leftovers from its own message cache. */
export const SWEEP_DELAY_MS = 15_000;

const OWN_DELETION_TTL_SECONDS = 600;
const CASE_END_TTL_SECONDS = 600;

export type MemberStatus =
  | { kind: "member"; isStaff: boolean; isVerified: boolean }
  | { kind: "left" }
  | { kind: "lookup_failed" };

export type HoneypotDecision =
  | { type: "ignore" }
  | { type: "delete_only"; why: "verified" | "lookup_failed" }
  | { type: "remove"; memberLeft: boolean };

export interface ActionRecord {
  action: HoneypotAction;
  reason: string;
  channelId: string;
}

export function warningText(action: HoneypotAction): string {
  const outcome = action === "ban" ? "banned" : "kicked";
  return `If you send a message in this channel, you will be automatically ${outcome}. There will be no exceptions.`;
}

/** The ban reason. A kick is a ban followed by an unban, so it gets its own tag. */
export function removalReason(action: HoneypotAction, channelName: string, messageId: string): string {
  const tag = action === "ban" ? "[Honeypot]" : "[Honeypot kick]";
  return `${tag} posted in #${channelName} (msg ${messageId})`;
}

export function isHoneypotReason(reason: string | null | undefined): boolean {
  return reason?.includes(HONEYPOT_REASON_MARKER) ?? false;
}

/** System notices, webhook posts and bot posts never trigger the honeypot. */
export function isRealPost(post: { system: boolean; webhookId: string | null; authorIsBot: boolean }): boolean {
  return !post.system && !post.webhookId && !post.authorIsBot;
}

/**
 * Staff are left alone and verified members only lose the message. Everyone else is removed,
 * including an account that already left, since a ban by user ID still works on a non-member.
 * When the member lookup fails, nobody is removed, because the author might be staff.
 */
export function decideHoneypot(status: MemberStatus): HoneypotDecision {
  switch (status.kind) {
    case "member":
      if (status.isStaff) return { type: "ignore" };
      if (status.isVerified) return { type: "delete_only", why: "verified" };
      return { type: "remove", memberLeft: false };
    case "left":
      return { type: "remove", memberLeft: true };
    case "lookup_failed":
      return { type: "delete_only", why: "lookup_failed" };
  }
}

interface RecordEntry {
  record: ActionRecord;
  /** Infinity until the ban call resolves, then RECORD_TTL_MS after that. */
  expiresAt: number;
  banEventTaken: boolean;
  /** Starts true when the account had already left, because banning a non-member sends no remove event. */
  removeEventTaken: boolean;
}

function accountKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * In-memory bookkeeping for the honeypot: cases in flight, action records for the ban and leave
 * handlers, messages DragonBot deleted itself, per-key locks, and the work shutdown waits for.
 * Nothing here talks to Discord.
 */
export class HoneypotService {
  /** When each account's in-flight case started. */
  private casesInFlight = new Map<string, number>();
  /** When each account's last case ended. */
  private caseEndTimes = new TTLCache<number>(CASE_END_TTL_SECONDS);
  private actionRecords = new Map<string, RecordEntry>();
  /** When each account's late-message window closes. */
  private lateWindowEnds = new Map<string, number>();
  private ownDeletions = new TTLCache<true>(OWN_DELETION_TTL_SECONDS);
  private exclusiveChains = new Map<string, Promise<void>>();
  private trackedWork = new Set<Promise<unknown>>();

  /**
   * A message is part of the account's current case while an action is in flight, or when it was
   * sent before the last action finished. Any other message starts a new case.
   */
  beginCase(guildId: string, userId: string, messageTimestamp: number): "start" | "same_case" {
    const key = accountKey(guildId, userId);
    const now = Date.now();
    this.sweep(now);
    if (this.casesInFlight.has(key)) return "same_case";
    const endedAt = this.caseEndTimes.get(key);
    if (endedAt !== undefined && messageTimestamp < endedAt) return "same_case";
    this.casesInFlight.set(key, now);
    return "start";
  }

  endCase(guildId: string, userId: string): void {
    const key = accountKey(guildId, userId);
    const now = Date.now();
    this.sweep(now);
    this.casesInFlight.delete(key);
    this.caseEndTimes.set(key, now);
  }

  /**
   * Call before the ban goes out. Replaces any earlier record for the account, and never expires before confirmAction.
   * Pass memberLeft when the account had already left. Its ban then sends no member-remove event, so takeRemoveEvent
   * never matches this record, and the account's later departures are handled normally.
   */
  recordAction(guildId: string, userId: string, record: ActionRecord, options: { memberLeft?: boolean } = {}): void {
    this.sweep(Date.now());
    this.actionRecords.set(accountKey(guildId, userId), {
      record,
      expiresAt: Infinity,
      banEventTaken: false,
      removeEventTaken: options.memberLeft ?? false,
    });
  }

  /** The ban resolved: the record now lives for RECORD_TTL_MS, and the late-message window opens. */
  confirmAction(guildId: string, userId: string): void {
    const key = accountKey(guildId, userId);
    const now = Date.now();
    this.sweep(now);
    const entry = this.actionRecords.get(key);
    if (!entry) return;
    entry.expiresAt = now + RECORD_TTL_MS;
    this.lateWindowEnds.set(key, now + LATE_MESSAGE_WINDOW_MS);
  }

  /** The ban failed: forget the action, which also ends the recent-action and late-message windows. */
  dropAction(guildId: string, userId: string): void {
    const key = accountKey(guildId, userId);
    this.sweep(Date.now());
    this.actionRecords.delete(key);
    this.lateWindowEnds.delete(key);
  }

  /** Matches a ban event to the account's action record, at most once per record. */
  takeBanEvent(guildId: string, userId: string): ActionRecord | null {
    const entry = this.liveRecord(guildId, userId);
    if (!entry || entry.banEventTaken) return null;
    entry.banEventTaken = true;
    return entry.record;
  }

  /** Matches a member-remove event to the account's action record, at most once per record, and never when the account had already left. */
  takeRemoveEvent(guildId: string, userId: string): ActionRecord | null {
    const entry = this.liveRecord(guildId, userId);
    if (!entry || entry.removeEventTaken) return null;
    entry.removeEventTaken = true;
    return entry.record;
  }

  isWithinLateWindow(guildId: string, userId: string): boolean {
    this.sweep(Date.now());
    return this.lateWindowEnds.has(accountKey(guildId, userId));
  }

  /** True from recordAction until RECORD_TTL_MS after the ban resolves. Taking the record's events doesn't end it. */
  wasRecentlyActioned(guildId: string, userId: string): boolean {
    return this.liveRecord(guildId, userId) !== undefined;
  }

  /** Call before DragonBot deletes a message, so the delete log skips it. */
  markOwnDeletion(messageId: string): void {
    this.ownDeletions.set(messageId, true);
  }

  consumeOwnDeletion(messageId: string): boolean {
    if (this.ownDeletions.get(messageId) === undefined) return false;
    this.ownDeletions.invalidate(messageId);
    return true;
  }

  /** Runs calls with the same key one at a time, in order. A failed call doesn't block the ones after it. */
  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.exclusiveChains.get(key) ?? Promise.resolve();
    const result = previous.then(() => fn());
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.exclusiveChains.set(key, settled);
    void settled.then(() => {
      if (this.exclusiveChains.get(key) === settled) this.exclusiveChains.delete(key);
    });
    return result;
  }

  /** Registers work that shutdown should wait for, and passes its result through. */
  track<T>(work: Promise<T>): Promise<T> {
    this.trackedWork.add(work);
    return work.finally(() => {
      this.trackedWork.delete(work);
    });
  }

  /** Waits for tracked work, including work tracked while draining, for at most timeoutMs. */
  async drain(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timed_out">((resolve) => {
      timer = setTimeout(() => resolve("timed_out"), timeoutMs);
    });
    try {
      while (this.trackedWork.size > 0) {
        const allSettled = Promise.allSettled([...this.trackedWork]).then(() => "settled" as const);
        if ((await Promise.race([allSettled, timedOut])) === "timed_out") return;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private liveRecord(guildId: string, userId: string): RecordEntry | undefined {
    this.sweep(Date.now());
    return this.actionRecords.get(accountKey(guildId, userId));
  }

  /** Forgets in-flight cases past the timeout, expired action records and closed late-message windows. */
  private sweep(now: number): void {
    for (const [key, startedAt] of this.casesInFlight) {
      if (now - startedAt > IN_FLIGHT_TIMEOUT_MS) this.casesInFlight.delete(key);
    }
    for (const [key, entry] of this.actionRecords) {
      if (now > entry.expiresAt) this.actionRecords.delete(key);
    }
    for (const [key, endsAt] of this.lateWindowEnds) {
      if (now > endsAt) this.lateWindowEnds.delete(key);
    }
  }
}
