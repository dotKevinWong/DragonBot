import { createHash } from "node:crypto";
import type { RepeatSpamMatchMode } from "@dragonbot/db";

/** Copies count when they arrive within this long of the first tracked copy. */
export const REPEAT_WINDOW_MS = 60_000;

/** The length floor: code points left once links, emoji and punctuation are gone. */
export const MIN_COMPARED_CHARS = 20;

/** The length floor: distinct words left once links, emoji and punctuation are gone. */
export const MIN_COMPARED_WORDS = 3;

/** Under "similar", two messages match when their word sets' Jaccard similarity is at least this. */
export const SIMILARITY_THRESHOLD = 0.8;

/** Each account keeps at most this many recent messages, so one account posting many different messages stays small. */
export const MAX_TRACKED_PER_ACCOUNT = 25;

/** What a message is compared by. Word-for-word levels keep a hash, so memory doesn't grow with message length. */
export type CompareKey =
  | { mode: "exact" | "ignore_case"; hash: string }
  | { mode: "similar"; words: ReadonlySet<string> };

export interface TrackedCopy {
  channelId: string;
  messageId: string;
}

/** Every tracked copy that matches, the new message included, oldest first, and their distinct channels in first-seen order. */
export interface RepeatTrigger {
  copies: TrackedCopy[];
  channelIds: string[];
}

const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const LINK = /https?:\/\/\S+/g;
const LINK_PLACEHOLDER = "__link__";

/**
 * The key a message is compared by at the given matching level, or null when the message is below the length floor.
 * Every level first trims the text and collapses runs of whitespace.
 */
export function compareKey(content: string, mode: RepeatSpamMatchMode): CompareKey | null {
  const base = content.trim().replace(/\s+/gu, " ");
  if (!passesFloor(base)) return null;
  switch (mode) {
    case "exact":
      return { mode, hash: sha256(base) };
    case "ignore_case":
      return { mode, hash: sha256(base.toLowerCase()) };
    case "similar": {
      const similar = base
        .toLowerCase()
        .replace(CUSTOM_EMOJI, " ")
        .replace(LINK, ` ${LINK_PLACEHOLDER} `)
        .replace(/[^\p{L}\p{N}_\s]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
      return { mode, words: new Set(similar.split(" ")) };
    }
  }
}

/** Whether two keys are copies of each other. Keys from different levels never match. */
export function isSameMessage(a: CompareKey, b: CompareKey): boolean {
  if (a.mode === "similar" && b.mode === "similar") return jaccard(a.words, b.words) >= SIMILARITY_THRESHOLD;
  if (a.mode === "similar" || b.mode === "similar") return false;
  return a.mode === b.mode && a.hash === b.hash;
}

/**
 * The floor is the same at every level and is checked on its own stripped text: links, custom emoji, other emoji and
 * punctuation removed, leaving only letters, digits and single spaces. Characters are counted as code points, never
 * UTF-16 units.
 */
function passesFloor(base: string): boolean {
  const floor = base
    .toLowerCase()
    .replace(CUSTOM_EMOJI, " ")
    .replace(LINK, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...floor].length >= MIN_COMPARED_CHARS && new Set(floor.split(" ")).size >= MIN_COMPARED_WORDS;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Shared words divided by all distinct words. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

interface Entry {
  copy: TrackedCopy;
  key: CompareKey;
  at: number;
}

interface OpenCase {
  caseId: number;
  key: CompareKey;
}

function accountKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * In-memory tracking for the repeated-message check: each account's recent qualifying messages, and the message each
 * account's open case is about. Nothing here talks to Discord.
 */
export class RepeatSpamService {
  private entries = new Map<string, Entry[]>();
  private openCases = new Map<string, OpenCase>();
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  /**
   * Tracks a qualifying message and returns a trigger when its copies from the window span channelCount distinct
   * channels. It never clears entries itself: the caller forgets the account once its case starts.
   */
  track(
    guildId: string,
    userId: string,
    copy: TrackedCopy,
    key: CompareKey,
    channelCount: number,
    now: number,
  ): RepeatTrigger | null {
    const account = accountKey(guildId, userId);
    const recent = (this.entries.get(account) ?? []).filter((entry) => !isExpired(entry, now));
    this.sweep(now);

    recent.push({ copy, key, at: now });
    if (recent.length > MAX_TRACKED_PER_ACCOUNT) recent.splice(0, recent.length - MAX_TRACKED_PER_ACCOUNT);
    this.entries.set(account, recent);

    const copies = recent.filter((entry) => isSameMessage(entry.key, key)).map((entry) => entry.copy);
    const channelIds = [...new Set(copies.map((c) => c.channelId))];
    return channelIds.length >= channelCount ? { copies, channelIds } : null;
  }

  /** Drops every tracked message of the account. */
  forget(guildId: string, userId: string): void {
    this.entries.delete(accountKey(guildId, userId));
  }

  /** Remembers the message the account's case is about, so later copies are recognised while it runs. */
  openCase(guildId: string, userId: string, caseId: number, key: CompareKey): void {
    this.openCases.set(accountKey(guildId, userId), { caseId, key });
  }

  /** Clears the account's open case, but only when caseId is that case. */
  closeCase(guildId: string, userId: string, caseId: number): void {
    const account = accountKey(guildId, userId);
    if (this.openCases.get(account)?.caseId === caseId) this.openCases.delete(account);
  }

  isCopyOfOpenCase(guildId: string, userId: string, key: CompareKey): boolean {
    const open = this.openCases.get(accountKey(guildId, userId));
    return open !== undefined && isSameMessage(open.key, key);
  }

  /** For tests: how many messages the account has tracked. */
  trackedCount(guildId: string, userId: string): number {
    return this.entries.get(accountKey(guildId, userId))?.length ?? 0;
  }

  /** For tests: how many accounts have tracked messages. */
  get trackedAccountCount(): number {
    return this.entries.size;
  }

  /** At most once per window, forgets every account whose tracked messages are all past the window. */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < REPEAT_WINDOW_MS) return;
    this.lastSweepAt = now;
    for (const [account, list] of this.entries) {
      if (list.every((entry) => isExpired(entry, now))) this.entries.delete(account);
    }
  }
}

/** An entry exactly REPEAT_WINDOW_MS old still counts. */
function isExpired(entry: Entry, now: number): boolean {
  return now - entry.at > REPEAT_WINDOW_MS;
}
