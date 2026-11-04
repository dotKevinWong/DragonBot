import { describe, expect, it } from "vitest";
import { REPEAT_SPAM_MATCH_MODES, type RepeatSpamMatchMode } from "@dragonbot/db";
import {
  MAX_TRACKED_PER_ACCOUNT,
  MIN_COMPARED_CHARS,
  MIN_COMPARED_WORDS,
  REPEAT_WINDOW_MS,
  RepeatSpamService,
  SIMILARITY_THRESHOLD,
  compareKey,
  isSameMessage,
} from "../../src/services/repeat-spam.service.js";

const SENTENCE = "Free Discord Nitro for everyone who joins our server today, claim it here https://scam.example/a 🎁";

describe("repeat-spam constants", () => {
  it("uses the specified window, floor, threshold and cap", () => {
    expect(REPEAT_WINDOW_MS).toBe(60_000);
    expect(MIN_COMPARED_CHARS).toBe(20);
    expect(MIN_COMPARED_WORDS).toBe(3);
    expect(SIMILARITY_THRESHOLD).toBe(0.8);
    expect(MAX_TRACKED_PER_ACCOUNT).toBe(25);
  });
});

describe("compareKey and isSameMessage", () => {
  const same = (a: string, b: string, mode: RepeatSpamMatchMode) => isSameMessage(compareKey(a, mode)!, compareKey(b, mode)!);

  it("tells case apart only under exact", () => {
    expect(same("Free Nitro for everyone here", "free Nitro for everyone here", "exact")).toBe(false);
    expect(same("Free Nitro for everyone here", "free Nitro for everyone here", "ignore_case")).toBe(true);
    expect(same("Free Nitro for everyone here", "Free Nitro for everyone here", "exact")).toBe(true);
  });

  it("matches across whitespace differences at every level", () => {
    for (const mode of REPEAT_SPAM_MATCH_MODES) {
      expect(same("Free Nitro  for\neveryone here ", " Free Nitro for everyone here", mode)).toBe(true);
    }
  });

  it("matches a changed emoji, word or link only under similar", () => {
    const variants = [
      SENTENCE.replace("🎁", "🎉"),
      SENTENCE.replace("today", "tonight"),
      SENTENCE.replace("https://scam.example/a", "https://other.example/zz?x=1"),
    ];
    for (const variant of variants) {
      expect(same(SENTENCE, variant, "similar")).toBe(true);
      expect(same(SENTENCE, variant, "ignore_case")).toBe(false);
    }
    expect(same(SENTENCE, "Does anyone have the lecture notes from this morning for CS 260?", "similar")).toBe(false);
  });

  it("uses Jaccard similarity of at least 0.8 under similar", () => {
    // 8 shared of 10 distinct words: exactly 0.8
    expect(same("one two three four five six seven eight nine", "one two three four five six seven eight ten", "similar")).toBe(true);
    // 5 shared of 7 distinct words: below 0.8, so a swapped word in a short sentence doesn't match
    expect(same("please check out my new mixtape", "please check out my new album", "similar")).toBe(false);
  });

  it("never matches keys from different levels", () => {
    expect(isSameMessage(compareKey(SENTENCE, "exact")!, compareKey(SENTENCE, "ignore_case")!)).toBe(false);
  });

  it("counts only text with at least 20 characters and 3 distinct words once links, emoji and punctuation are gone", () => {
    for (const mode of REPEAT_SPAM_MATCH_MODES) {
      for (const short of [
        "gm", "lol", "🎉🎉🎉", "", "abcde fghij klmnopq", "abcdefghijklmnopqrstuvwxyz ab",
        "😂 😂 😂 😂 😂 😂 😂",                                       // 20 UTF-16 units, 7 "words", no letters
        "<:kekw:123456789012345678> <:kekw:123456789012345678> <:pog:123456789012345678>",
        "lol lol lol lol lol lol lol",                                // one distinct word
        "https://a.example/one https://b.example/two https://c.example/three",
        "hey check https://a.example/some-long-path",
        "éé ÿÿ üü 🎉🎉🎉🎉🎉🎉🎉",                                       // 8 code points once emoji go
      ]) {
        expect(compareKey(short, mode)).toBeNull();
      }
      expect(compareKey("abcde fghij klmnopqr", mode)).not.toBeNull();
      expect(compareKey("Free Nitro here 😂😂 https://scam.example/a", mode)).toBeNull(); // "free nitro here" is 15
      expect(compareKey("Free Nitro for everyone 😂 https://scam.example/a", mode)).not.toBeNull(); // 23
    }
  });

  it("keeps a hash, not the text, for word-for-word levels", () => {
    const key = compareKey(SENTENCE, "ignore_case")!;
    expect(key.mode).toBe("ignore_case");
    if (key.mode !== "similar") expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("RepeatSpamService", () => {
  const T0 = Date.UTC(2026, 10, 3, 12);
  const KEY = compareKey(SENTENCE, "ignore_case")!;
  const OTHER_KEY = compareKey("Does anyone have the lecture notes from this morning for CS 260?", "ignore_case")!;

  const post = (service: RepeatSpamService, channelId: string, messageId: string, at: number, count = 3) =>
    service.track("g1", "u1", { channelId, messageId }, KEY, count, at);

  it("triggers when copies span the configured count of channels", () => {
    const service = new RepeatSpamService();
    expect(post(service, "a", "m1", T0)).toBeNull();
    expect(post(service, "b", "m2", T0 + 1_000)).toBeNull();
    expect(post(service, "c", "m3", T0 + 2_000)).toEqual({
      channelIds: ["a", "b", "c"],
      copies: [
        { channelId: "a", messageId: "m1" },
        { channelId: "b", messageId: "m2" },
        { channelId: "c", messageId: "m3" },
      ],
    });
  });

  it("never counts repeats in one channel", () => {
    const service = new RepeatSpamService();
    for (let i = 0; i < 5; i++) expect(post(service, "a", `m${i}`, T0 + i)).toBeNull();
    expect(post(service, "b", "m5", T0 + 10)).toBeNull();
  });

  it("counts a thread as its own channel", () => {
    const service = new RepeatSpamService();
    expect(post(service, "a", "m1", T0)).toBeNull();
    expect(post(service, "t1", "m2", T0 + 1)).toBeNull();
    expect(post(service, "b", "m3", T0 + 2)?.channelIds).toEqual(["a", "t1", "b"]);
  });

  it("includes every copy, same-channel ones too", () => {
    const service = new RepeatSpamService();
    post(service, "a", "m1", T0);
    post(service, "a", "m2", T0 + 1);
    post(service, "b", "m3", T0 + 2);
    const trigger = post(service, "c", "m4", T0 + 3);
    expect(trigger?.copies).toEqual([
      { channelId: "a", messageId: "m1" },
      { channelId: "a", messageId: "m2" },
      { channelId: "b", messageId: "m3" },
      { channelId: "c", messageId: "m4" },
    ]);
    expect(trigger?.channelIds).toEqual(["a", "b", "c"]);
  });

  it("counts copies up to 60 seconds after the first", () => {
    const service = new RepeatSpamService();
    post(service, "a", "m1", T0);
    post(service, "b", "m2", T0 + 30_000);
    expect(post(service, "c", "m3", T0 + 60_000)?.channelIds).toEqual(["a", "b", "c"]);

    const fresh = new RepeatSpamService();
    post(fresh, "a", "m1", T0);
    post(fresh, "b", "m2", T0 + 30_000);
    expect(post(fresh, "c", "m3", T0 + 60_001)).toBeNull();
  });

  it("uses the count it is given", () => {
    const service = new RepeatSpamService();
    post(service, "a", "m1", T0, 4);
    post(service, "b", "m2", T0 + 1, 4);
    expect(post(service, "c", "m3", T0 + 2, 4)).toBeNull();
    expect(post(service, "d", "m4", T0 + 3, 4)?.channelIds).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps accounts and servers apart", () => {
    const service = new RepeatSpamService();
    expect(service.track("g1", "u1", { channelId: "a", messageId: "m1" }, KEY, 3, T0)).toBeNull();
    expect(service.track("g1", "u2", { channelId: "b", messageId: "m2" }, KEY, 3, T0 + 1)).toBeNull();
    expect(service.track("g2", "u1", { channelId: "c", messageId: "m3" }, KEY, 3, T0 + 2)).toBeNull();
  });

  it("ignores other messages from the same account", () => {
    const service = new RepeatSpamService();
    post(service, "a", "m1", T0);
    post(service, "b", "m2", T0 + 1);
    expect(service.track("g1", "u1", { channelId: "c", messageId: "m3" }, OTHER_KEY, 3, T0 + 2)).toBeNull();
    const trigger = post(service, "d", "m4", T0 + 3);
    expect(trigger?.channelIds).toEqual(["a", "b", "d"]);
    expect(trigger?.copies.map((c) => c.messageId)).toEqual(["m1", "m2", "m4"]);
  });

  it("caps each account's entries and forgets idle accounts", () => {
    const service = new RepeatSpamService();
    for (let i = 0; i < 30; i++) {
      const key = compareKey(`message number ${i} from the same spammer account`, "ignore_case")!;
      service.track("g1", "u1", { channelId: "a", messageId: `m${i}` }, key, 3, T0);
    }
    expect(service.trackedCount("g1", "u1")).toBe(25);
    service.track("g1", "u2", { channelId: "a", messageId: "x1" }, KEY, 3, T0 + 61_000);
    expect(service.trackedAccountCount).toBe(1);
    expect(service.trackedCount("g1", "u1")).toBe(0);
  });

  it("forgets an account's entries", () => {
    const service = new RepeatSpamService();
    post(service, "a", "m1", T0);
    post(service, "b", "m2", T0 + 1);
    service.forget("g1", "u1");
    expect(service.trackedCount("g1", "u1")).toBe(0);
    expect(post(service, "c", "m3", T0 + 2)).toBeNull();
  });

  it("recognises copies of an open case until that case closes", () => {
    const service = new RepeatSpamService();
    service.openCase("g1", "u1", 7, KEY);
    expect(service.isCopyOfOpenCase("g1", "u1", KEY)).toBe(true);
    expect(service.isCopyOfOpenCase("g1", "u1", OTHER_KEY)).toBe(false);
    expect(service.isCopyOfOpenCase("g1", "u2", KEY)).toBe(false);
    service.closeCase("g1", "u1", 8);
    expect(service.isCopyOfOpenCase("g1", "u1", KEY)).toBe(true);
    service.closeCase("g1", "u1", 7);
    expect(service.isCopyOfOpenCase("g1", "u1", KEY)).toBe(false);
  });
});
