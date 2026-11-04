# Honeypot Repeated-Message Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kick an ordinary account that posts the same message in 3 or more different channels (configurable) within 60 seconds, as a second part of the Honeypot feature beside the channel trap.

**Architecture:**
- **Matching and tracking** go in a new pure `RepeatSpamService` (`apps/bot/src/services/repeat-spam.service.ts`, no `discord.js` imports). It turns a message into a compare key for the server's matching level, keeps each account's recent qualifying messages in memory, and says when copies span enough channels.
- **The removal path is shared.** The channel trap's ban-then-unban code moves, unchanged in behaviour, from `honeypot-enforcer.ts` to a new `lib/honeypot-removal.ts`. A new `lib/repeat-spam-enforcer.ts` uses it, and the same `HoneypotService` case per account, so both parts share one case.
- **Settings** are three new `guilds` columns, edited on the existing Honeypot dashboard card, read through the existing settings cache and re-read fresh before acting.

**Tech Stack:** TypeScript (ESM, strict), discord.js 14, Drizzle ORM on Neon Postgres, Next.js, zod 3, Vitest 3, pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-11-03-honeypot-repeat-messages-design.md` (approved by Kevin, 2026-11-03). Read it before any task. Where this plan and the spec disagree, the spec wins; stop and say so. It builds on the live channel trap: `docs/superpowers/specs/2026-10-29-honeypot-design.md`.

## Global Constraints

**What counts:**
- Only real posts: `isRealPost` (no system messages, webhook posts or bot posts). DMs never reach the check (`messageCreate` already returns for them).
- Matching levels (`repeat_spam_match_mode`), default `ignore_case`:
  - `exact`, shown as "Word for word, case-sensitive": identical text.
  - `ignore_case`, shown as "Word for word, ignoring case": identical once lowercased.
  - `similar`, shown as "Too similar": lowercased, links replaced by one placeholder, punctuation and emoji removed; matches when the word sets' Jaccard similarity (shared words ÷ all distinct words) is **at least 0.8**.
- Every level first trims the text and collapses runs of whitespace. Attachments, stickers and embeds are never compared.
- Length floor: the compared text is at least **20 characters and 3 words**.
- Window: **60 seconds**, fixed, from the first tracked copy.
- Copies count per **distinct channel**; a thread is its own channel. Same-channel repeats never add a channel.
- Channel count (`repeat_spam_channel_count`): default **3**, range **2 to 10**.
- A message the channel trap handles never counts.

**Who is left alone (no kick, no delete, no log entry, no notice):**
- Staff: any of `Administrator`, `ManageGuild`, `KickMembers`, `BanMembers` (the trap's `STAFF_PERMISSIONS`).
- Verified: has the server's `verificationRoleId`; none set means nobody is verified.
- An author DragonBot can't look up (any error but Unknown Member): nothing happens. Pino `warn` only.
- An author who already left (Unknown Member) **is** caught and removed by ID.

**Removal:**
- Always kick, through the trap's Kick-mode path: ban with `deleteMessageSeconds: 3600`, then unban with `[Honeypot kick] unban after message cleanup`.
- Ban reason: `[Honeypot kick] same message in N channels` (N = distinct channels of the copies). It must start with `[Honeypot kick]`.
- One case per account, shared with the trap through `HoneypotService.beginCase`. The first to claim the account decides the action.
- During shutdown, no kick starts and nothing is deleted.

**Columns on `guilds`** (Kevin pushes the schema himself, before merging; nobody runs `db:push`, `db:migrate` or `drizzle-kit`):
- `is_repeat_spam_enabled` boolean, not null, default `false`
- `repeat_spam_channel_count` integer, not null, default `3`
- `repeat_spam_match_mode` text, not null, default `'ignore_case'`, one of `exact`, `ignore_case`, `similar`

**Dashboard:** the three fields need full access (`"*"` in `FIELD_SCOPE_MAP`), are sent only when they change, and live on the one Honeypot card.

**General rules:**
- Follow `AGENT.md`, including "What AI Agents Must NOT Do". No new environment variables and no new dependencies.
- Run bot tests with `pnpm --filter bot test` (pass file names to narrow, e.g. `pnpm --filter bot test repeat-spam`). Baseline: 21 files, 241 tests, all passing.
- `apps/web` has no test runner. Web tasks verify with `pnpm --filter web typecheck` and a build: `DATABASE_URL=postgres://u:p@localhost:5432/db JWT_SECRET=0123456789abcdef0123456789abcdef DISCORD_API_TOKEN=placeholder pnpm --filter web build`, then `git checkout -- apps/web/tsconfig.tsbuildinfo apps/web/next-env.d.ts`.
- In tests, mock Discord objects with plain objects cast through `unknown`, as `apps/bot/tests/lib/honeypot-enforcer.test.ts` does. Build API errors with `new DiscordAPIError({ code, message }, code, status, "PUT", "/x", {})`.
- Commit messages are plain sentences like the repo's log ("Add …", "Move …"), with no attribution lines. Commit only the files the task names.

## Review Focus

1. **A spammer posts and leaves within a second:** the lookup answers Unknown Member. The account is still kicked by ID, and the log entry says only what DragonBot saw was cleaned up. *(Task 4 test "kicks an author who already left")*
2. **Stale cache:** the check was turned off, the count raised or the matching level changed on the dashboard, and the reload ping was lost. Nobody is kicked. *(Task 4 test "re-reads settings and kicks nobody when the fresh row no longer catches it")*
3. **Copies that differ only in whitespace or line breaks** (clients and copy-paste disagree on trailing spaces and newlines) still match at every level. *(Task 2 test "matches across whitespace differences at every level")*
4. **A wave of many accounts, or one account posting many different messages:** memory stays bounded; each account keeps at most `MAX_TRACKED_PER_ACCOUNT` entries, and idle accounts are forgotten. *(Task 2 test "caps each account's entries and forgets idle accounts")*
5. **The kick fails** (the account outranks DragonBot): DragonBot deletes the copies itself, then the notice names the repeated-message check, not the honeypot channel. *(Task 4 test "deletes the copies itself when the kick fails, then sends a notice naming the check")*

---

### Task 1: Settings columns and shared definitions

**Model:** Opus (database schema and permissions).

**Files:**
- Modify: `packages/db/src/honeypot.ts` (append)
- Modify: `packages/db/src/schema.ts:13,84-89`. Extend the `./honeypot` import; add the three columns after `honeypotWarningMessageId`.
- Modify: `packages/db/src/permissions.ts:51-54`. Add the three fields under the Honeypot comment, each `"*"`; extend the comment to say the repeated-message fields also decide who gets kicked.
- Test: `apps/bot/tests/db/honeypot.test.ts`

**Interfaces:**
- Produces, in `@dragonbot/db`:
  - `REPEAT_SPAM_MATCH_MODES = ["exact", "ignore_case", "similar"] as const`, `type RepeatSpamMatchMode`
  - `REPEAT_SPAM_MIN_CHANNELS = 2`, `REPEAT_SPAM_MAX_CHANNELS = 10`, `REPEAT_SPAM_DEFAULT_CHANNELS = 3`
  - `isRepeatSpamArmed(settings: { isRepeatSpamEnabled: boolean; repeatSpamChannelCount: number; repeatSpamMatchMode: string }): boolean`: on, a known level, and an integer count in range.
  - `GuildRow` gains `isRepeatSpamEnabled: boolean`, `repeatSpamChannelCount: number`, `repeatSpamMatchMode: RepeatSpamMatchMode`.

- [ ] **Step 1: Write the failing tests** in `apps/bot/tests/db/honeypot.test.ts`

```ts
const armed = { isRepeatSpamEnabled: true, repeatSpamChannelCount: 3, repeatSpamMatchMode: "ignore_case" };

it("arms the repeated-message check only when it's on with a known level and a count from 2 to 10", () => {
  expect(isRepeatSpamArmed(armed)).toBe(true);
  expect(isRepeatSpamArmed({ ...armed, repeatSpamChannelCount: 2 })).toBe(true);
  expect(isRepeatSpamArmed({ ...armed, repeatSpamChannelCount: 10 })).toBe(true);
  expect(isRepeatSpamArmed({ ...armed, isRepeatSpamEnabled: false })).toBe(false);
  for (const count of [1, 11, 2.5]) expect(isRepeatSpamArmed({ ...armed, repeatSpamChannelCount: count })).toBe(false);
  expect(isRepeatSpamArmed({ ...armed, repeatSpamMatchMode: "fuzzy" })).toBe(false);
});

it("needs full access for the repeated-message fields", () => {
  for (const field of ["isRepeatSpamEnabled", "repeatSpamChannelCount", "repeatSpamMatchMode"]) {
    expect(FIELD_SCOPE_MAP[field]).toBe("*");
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter bot test db/honeypot`
Expected: FAIL, `isRepeatSpamArmed` is not exported.

- [ ] **Step 3: Implement.** Constants and `isRepeatSpamArmed` in `honeypot.ts` (no import from `schema.ts`). Columns in `schema.ts`:

```ts
isRepeatSpamEnabled: boolean("is_repeat_spam_enabled").notNull().default(false),
repeatSpamChannelCount: integer("repeat_spam_channel_count").notNull().default(REPEAT_SPAM_DEFAULT_CHANNELS),
repeatSpamMatchMode: text("repeat_spam_match_mode", { enum: REPEAT_SPAM_MATCH_MODES }).notNull().default("ignore_case"),
```

Do **not** run `db:push`, `db:migrate` or `drizzle-kit`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter bot test && pnpm typecheck`
Expected: PASS (243 tests). If a typed `GuildRow` fixture elsewhere fails typecheck, add the three fields with their defaults to it.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/honeypot.ts packages/db/src/schema.ts packages/db/src/permissions.ts apps/bot/tests/db/honeypot.test.ts
git commit -m "Add the repeated-message check's settings columns and shared definitions"
```

---

### Task 2: Matching and tracking (`RepeatSpamService`)

**Model:** Opus (decides who gets kicked).

**Files:**
- Create: `apps/bot/src/services/repeat-spam.service.ts`. No `discord.js` import; only `import type` from `@dragonbot/db`; `node:crypto` is allowed.
- Modify: `apps/bot/src/services/honeypot.service.ts`. Add `repeatRemovalReason` next to `removalReason`, using the existing `HONEYPOT_KICK_TAG`.
- Test: `apps/bot/tests/services/repeat-spam.service.test.ts`, `apps/bot/tests/services/honeypot.service.test.ts`

**Interfaces:**
- Consumes: `RepeatSpamMatchMode` (Task 1).
- Produces, from `repeat-spam.service.ts`:
  - `REPEAT_WINDOW_MS = 60_000`, `MIN_COMPARED_CHARS = 20`, `MIN_COMPARED_WORDS = 3`, `SIMILARITY_THRESHOLD = 0.8`, `MAX_TRACKED_PER_ACCOUNT = 25`
  - `type CompareKey = { mode: "exact" | "ignore_case"; hash: string } | { mode: "similar"; words: ReadonlySet<string> }`
  - `compareKey(content: string, mode: RepeatSpamMatchMode): CompareKey | null`: null when below the length floor.
  - `isSameMessage(a: CompareKey, b: CompareKey): boolean`: false when the modes differ.
  - `interface TrackedCopy { channelId: string; messageId: string }`
  - `interface RepeatTrigger { copies: TrackedCopy[]; channelIds: string[] }`: every tracked copy that matches, the new message included, oldest first; `channelIds` distinct, in first-seen order.
  - `class RepeatSpamService` with:
    - `track(guildId: string, userId: string, copy: TrackedCopy, key: CompareKey, channelCount: number, now: number): RepeatTrigger | null`
    - `forget(guildId: string, userId: string): void`
    - `openCase(guildId: string, userId: string, caseId: number, key: CompareKey): void`
    - `closeCase(guildId: string, userId: string, caseId: number): void`: only clears when `caseId` matches.
    - `isCopyOfOpenCase(guildId: string, userId: string, key: CompareKey): boolean`
    - `trackedCount(guildId: string, userId: string): number` and `get trackedAccountCount(): number` (for tests)
- Produces, from `honeypot.service.ts`: `repeatRemovalReason(channelCount: number): string`.

- [ ] **Step 1: Write the failing tests**

```ts
const SENTENCE = "Free Discord Nitro for everyone who joins our server today, claim it here https://scam.example/a 🎁";

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

  it("counts only text of at least 20 characters and 3 words", () => {
    for (const mode of REPEAT_SPAM_MATCH_MODES) {
      for (const short of ["gm", "lol", "🎉🎉🎉", "", "abcde fghij klmnopq", "abcdefghijklmnopqrstuvwxyz ab"]) {
        expect(compareKey(short, mode)).toBeNull();
      }
      expect(compareKey("abcde fghij klmnopqr", mode)).not.toBeNull();
    }
    expect(compareKey("hey check https://a.example/some-long-path", "similar")).toBeNull();
  });
});
```

`describe("RepeatSpamService")`, with `const T0 = Date.UTC(2026, 10, 3, 12)` and a helper `post(service, channelId, messageId, at, count = 3)` that calls `track("g1", "u1", { channelId, messageId }, compareKey(SENTENCE, "ignore_case")!, count, at)`:
- `"triggers when copies span the configured count of channels"`: posts in `a`, `b` return null; `c` returns `{ channelIds: ["a", "b", "c"], copies: [3 copies, oldest first] }`.
- `"never counts repeats in one channel"`: five posts in `a` return null, then `b` returns null (2 channels).
- `"counts a thread as its own channel"`: `a`, thread `t1`, `b` triggers.
- `"includes every copy, same-channel ones too"`: `a`, `a`, `b`, `c` → `copies` has 4 entries, `channelIds` has 3.
- `"counts copies up to 60 seconds after the first"`: `a` at `T0`, `b` at `T0 + 30_000`, `c` at `T0 + 60_000` triggers; in a fresh service, `c` at `T0 + 60_001` returns null.
- `"uses the count it is given"`: with count 4, `c` returns null and `d` triggers.
- `"keeps accounts and servers apart"`: u1 in `a`, u2 in `b`, u1 in server g2 in `c` → all null.
- `"ignores other messages from the same account"`: a different sentence in `c` doesn't trigger, and the copies' channels still count afterwards.
- `"caps each account's entries and forgets idle accounts"`: 30 distinct sentences from u1 at `T0` → `trackedCount("g1", "u1")` is 25; one post from u2 at `T0 + 61_000` → `trackedAccountCount` is 1.
- `"forgets an account's entries"`: `a`, `b`, `forget`, then `c` returns null.
- `"recognises copies of an open case until that case closes"`: `openCase(..., 7, key)`; `isCopyOfOpenCase` is true for the key and false for another sentence's key; `closeCase(..., 8)` leaves it open; `closeCase(..., 7)` closes it.

In `honeypot.service.test.ts`:
```ts
it("writes a repeated-message kick reason that ban sync recognises", () => {
  expect(repeatRemovalReason(3)).toBe("[Honeypot kick] same message in 3 channels");
  expect(isHoneypotKickReason(repeatRemovalReason(3))).toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter bot test repeat-spam honeypot.service`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `compareKey`** with this normalisation:

```ts
const base = content.trim().replace(/\s+/gu, " ");
// exact: base. ignore_case: base.toLowerCase(). similar:
const similar = base
  .toLowerCase()
  .replace(/<a?:\w+:\d+>/g, " ")             // custom emoji
  .replace(/https?:\/\/\S+/g, " __link__ ")  // every link is the same placeholder
  .replace(/[^\p{L}\p{N}_\s]/gu, "")         // punctuation and emoji
  .replace(/\s+/g, " ")
  .trim();
// floor, on the compared text: length >= MIN_COMPARED_CHARS && split(" ").length >= MIN_COMPARED_WORDS
```

`exact` and `ignore_case` keys hold a SHA-256 hex of the compared text, so memory doesn't grow with message length. `similar` keys hold the set of words.

- [ ] **Step 4: Implement `RepeatSpamService`.** A `Map<"guild:user", Entry[]>` (entry: channel ID, message ID, key, time). On each `track`:
  1. Drop the account's entries older than `REPEAT_WINDOW_MS` (an entry exactly 60 000 ms old stays).
  2. Sweep the whole map at most once per `REPEAT_WINDOW_MS`, deleting accounts whose entries are all old.
  3. Append the entry, dropping the oldest past `MAX_TRACKED_PER_ACCOUNT`.
  4. Collect the matching entries; return a trigger when their distinct channels reach `channelCount`.

  `track` never clears entries itself: the enforcer calls `forget` once its case starts. Open cases are a separate `Map<"guild:user", { caseId, key }>`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter bot test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/services/repeat-spam.service.ts apps/bot/src/services/honeypot.service.ts apps/bot/tests/services/repeat-spam.service.test.ts apps/bot/tests/services/honeypot.service.test.ts
git commit -m "Add matching and tracking for the honeypot's repeated-message check"
```

---

### Task 3: Share the removal path and name the check in notices

**Model:** Opus (moves the ban and unban code).

The channel trap's behaviour must not change, except that its notices now say "channel trap".

**Files:**
- Create: `apps/bot/src/lib/honeypot-removal.ts`
- Modify: `apps/bot/src/lib/honeypot-enforcer.ts`. Move code out and import it back; the trap's flow stays as it is.
- Modify: `apps/bot/src/services/logging.service.ts`. Add `sendHoneypotEmbed`; `sendNotice` uses it.
- Test: `apps/bot/tests/lib/honeypot-enforcer.test.ts` (update the import and notice texts only), `apps/bot/tests/services/logging.service.test.ts`

**Interfaces:**
- Produces, from `lib/honeypot-removal.ts` (moved from `honeypot-enforcer.ts` unless noted):
  - `STAFF_PERMISSIONS`, `type Author`, `type Outcome`, `needsAttention(outcome)`, `hasErrorCode`, `describeError`, `cutReason`, `isVerified(member, verificationRoleId)`, `lookUpAuthor(message: Message<true>): Promise<Author>`, `memberStatus(author, verificationRoleId): MemberStatus`, `sweepCachedMessages` (still exported)
  - new: `interface Removal { action: HoneypotAction; reason: string; channelId: string; memberLeft: boolean; caseId: number }`
  - `removeAccount(guild: Guild, userId: string, removal: Removal, ctx: BotContext): Promise<Outcome>`: today's `removeAuthor`, with the reason and channel passed in. `checkBan`, `banAuthor`, `liftKickBan` and `scheduleSweep` move with it and stay private.
  - `outcomeText(outcome: Outcome, fate: string): string`: `fate` replaces the `messageFate(deleted)` sentence in the `already_banned` and `failed` texts.
  - `messageFate(deleted: boolean): string` (unchanged texts)
  - new: `trapLead(userId: string, channelId: string): string` returns `` `<@${userId}> (${userId}) posted in the channel trap <#${channelId}>.` ``
  - `sendHoneypotNotice(guildId: string, client: Client, lead: string, text: string, ctx: BotContext): Promise<void>`: sends `` `${lead} ${text}` ``; never throws.
- Produces, on `LoggingService`: `sendHoneypotEmbed(guildId: string, embed: EmbedBuilder, client: Client, logger: Logger): Promise<void>`. It sends whenever logging is on and a log channel is set, whatever `logEvents` says.

- [ ] **Step 1: Write the failing test** in `logging.service.test.ts`

```ts
describe("LoggingService.sendHoneypotEmbed", () => {
  it("sends the embed whenever logging is on with a log channel, whatever the event toggles", async () => {
    const { service, send, client, logger } = setup({ isLoggingEnabled: true, logChannelId: "log1", logEvents: [] });
    const embed = new EmbedBuilder().setTitle("Repeated Messages (Honeypot)");
    await service.sendHoneypotEmbed("g1", embed, client, logger);
    expect(send).toHaveBeenCalledWith({ embeds: [embed] });
  });
  it("sends nothing when logging is off or no log channel is set", async () => { /* the three cases sendNotice's test uses */ });
});
```

In `honeypot-enforcer.test.ts`, replace every `posted in the honeypot <#trap>.` with `posted in the channel trap <#trap>.`. There are seven, at lines 594, 668, 961, 1177, 1252, 1267 and 1316. Import `sweepCachedMessages` from `../../src/lib/honeypot-removal.js`. Change nothing else in that file.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter bot test logging.service honeypot-enforcer`
Expected: FAIL: `sendHoneypotEmbed` is not a function, the notice texts differ, and the import is missing.

- [ ] **Step 3: Implement the move.** `handleArmedMessage` and `runRemovalCase` call `removeAccount(guild, userId, { action, reason: removalReason(action, message.channel.name, message.id), channelId: message.channelId, memberLeft, caseId }, ctx)`. Their `sendHoneypotNotice` calls pass `trapLead(message.author.id, message.channelId)`; `outcomeText` calls pass `messageFate(deleted)`. `sendNotice` builds its embed as before and sends it through `sendHoneypotEmbed`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter bot test && pnpm typecheck`
Expected: PASS. Every pre-existing enforcer test passes with only the notice text and the import changed.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/lib/honeypot-removal.ts apps/bot/src/lib/honeypot-enforcer.ts apps/bot/src/services/logging.service.ts apps/bot/tests/lib/honeypot-enforcer.test.ts apps/bot/tests/services/logging.service.test.ts
git commit -m "Move the honeypot's removal path into its own module and name the channel trap in its notices"
```

---

### Task 4: Enforce the repeated-message check

**Model:** Opus (large; removes accounts).

**Files:**
- Create: `apps/bot/src/lib/repeat-spam-enforcer.ts`
- Modify: `apps/bot/src/utils/message-log.ts`. Add `buildRepeatSpamEmbed`.
- Modify: `apps/bot/src/events/message-create.ts:19-20`. After the `deleteLateMessage` line, add `if ((await handleRepeatSpamMessage(message, guild, ctx)) === "handled") return;`.
- Modify: `apps/bot/src/types/context.ts:44` (add `repeatSpam: RepeatSpamService;`) and `apps/bot/src/index.ts:89,112` (add `const repeatSpamService = new RepeatSpamService();` and `repeatSpam: repeatSpamService`).
- Test: `apps/bot/tests/lib/repeat-spam-enforcer.test.ts`, `apps/bot/tests/utils/message-log.test.ts`

**Interfaces:**
- Consumes: `isRepeatSpamArmed` (Task 1); `compareKey`, `RepeatSpamService`, `RepeatTrigger`, `repeatRemovalReason` (Task 2); `lookUpAuthor`, `memberStatus`, `isVerified`, `STAFF_PERMISSIONS`, `removeAccount`, `outcomeText`, `needsAttention`, `cutReason`, `describeError`, `hasErrorCode`, `sendHoneypotNotice`, `logging.sendHoneypotEmbed` (Task 3); `HoneypotService.beginCase/endCase/track/isClosing/markOwnDeletion`, `isRealPost`, `decideHoneypot`.
- Produces:
  - `handleRepeatSpamMessage(message: Message<true>, settings: GuildRow, ctx: BotContext): Promise<"not_caught" | "handled">`
  - `buildRepeatSpamEmbed(message: Message<true>, channelIds: string[], actionText: string): EmbedBuilder`
  - `ctx.services.repeatSpam: RepeatSpamService`

**Fixed texts:**
- Notice lead: `` `<@${userId}> (${userId}) posted the same message in ${n} channels (repeated-message check).` ``
- Copies fate (passed to `outcomeText`): `Copies deleted.` when every copy is gone, otherwise `Couldn't delete every copy.`
- Copy-delete failure notice: `` `Couldn't delete ${failed} of the ${total} copies: ${cutReason(reason)}. Delete them by hand if they're still there.` ``
- Shutdown text: `DragonBot was shutting down, so nobody was removed.`
- Embed:
  - Title `Repeated Messages (Honeypot)`, color `0xff0000`, description `` `Posted the same message in ${n} channels.` ``.
  - Author set as in `buildMessageDeletedEmbed`.
  - Fields in order: `Author` (`<@id>`, inline), `Channels` (`<#a>, <#b>, <#c>`, cut to 1024), `Content` (cut to 1024, `*Empty*` when empty), `Honeypot Action` (the action text), `ID` (a `js` code block with `User:`, `Message:`, `Guild:`).
  - Timestamp set.

**Flow of `handleRepeatSpamMessage`.** It makes no Discord or database call before step 6.
1. Return `"not_caught"` unless `isRepeatSpamArmed(settings)` and `isRealPost(...)`.
2. If the gateway sent `message.member` and it is staff, or verified under the cached `verificationRoleId`, return `"not_caught"`.
3. `key = compareKey(message.content, settings.repeatSpamMatchMode)`; if null, return `"not_caught"`.
4. If `repeatSpam.isCopyOfOpenCase(...)`, mark the message as DragonBot's own deletion, delete it (ignore errors) and return `"handled"`.
5. `trigger = repeatSpam.track(guildId, userId, { channelId, messageId }, key, settings.repeatSpamChannelCount, Date.now())`. If null, return `"not_caught"`.
6. Note `closingOnArrival = honeypot.isClosing`, then return `honeypot.track(...)` of the rest:
   1. Run `lookUpAuthor`, then `decideHoneypot(memberStatus(...))`.
      - `ignore` (staff) returns `"not_caught"`.
      - Lookup failure: pino `warn` ("Couldn't look up a repeated-message poster"), then return `"not_caught"`.
      - A verified member under the cached role returns `"not_caught"`.
   2. Read `fresh = getSettingsFresh`. Return `"not_caught"` if any of these holds:
      - `fresh` is null, or `!isRepeatSpamArmed(fresh)`
      - `fresh.repeatSpamMatchMode !== settings.repeatSpamMatchMode`
      - `trigger.channelIds.length < fresh.repeatSpamChannelCount`
      - the author is verified under `fresh.verificationRoleId`
   3. `beginCase(guildId, userId, message.createdTimestamp)`. On `same_case`, delete this message as in step 4 and return `"handled"`.
   4. Call `repeatSpam.forget` and `repeatSpam.openCase(..., caseId, key)`.
   5. If `closingOnArrival`:
      - `endCase` and `closeCase`
      - pino `warn` "Started no repeated-message kick during shutdown"
      - send the embed and a notice, both with the shutdown text
      - delete nothing, and return `"handled"`.
   6. Otherwise `await honeypot.track(runRepeatCase(...))` and return `"handled"`.

**`runRepeatCase`:**
- In a `try`, run `removeAccount(guild, userId, { action: "kick", reason: repeatRemovalReason(n), channelId: message.channelId, memberLeft, caseId }, ctx)`. In `finally`, call `endCase` and `closeCase`.
- Unless the outcome is `removed` or `still_banned` (a confirmed ban already cleaned up), delete every tracked copy itself.
  - Copies are deleted through `guild.channels.cache.get(channelId)` and `channel.messages.delete(messageId)`, each marked first with `markOwnDeletion`.
  - Unknown Message and a channel missing from the cache both mean the copy is gone.
- Then log with pino: `warn` when `needsAttention(outcome)`, otherwise `info`; message "Repeated-message case handled".
- Then send the embed through `sendHoneypotEmbed`.
- Then send the notice when `needsAttention(outcome)`.
- Then send the copy-delete failure notice, if any copy failed.

- [ ] **Step 1: Write the failing tests.** Build this file's own fakes, modeled on `honeypot-enforcer.test.ts`; don't import from another test file.
  - `fakeGuild()` has text channels `a`, `b`, `c`, `d` and `trap` in `channels.cache`, each with `messages.delete: vi.fn()`.
  - `fakeMessage(guild, { channelId, id, content = SENTENCE, member, ... })`.
  - `repeatRow(overrides)` has `isRepeatSpamEnabled: true, repeatSpamChannelCount: 3, repeatSpamMatchMode: "ignore_case", verificationRoleId: "verified-role"` and the trap off.
  - `setup()` returns the real `HoneypotService` and `RepeatSpamService` with fake `logging` (`sendHoneypotEmbed`, `sendNotice`, `sendLogEmbed`, `shouldLog`) and a fake `guild.getSettingsFresh`.
  - `postIn(...channels)` runs one message per channel through `handleRepeatSpamMessage`, in order.

Tests (the assertions each one makes):
- `"kicks an account that posts the same sentence in 3 channels, through the trap's kick path"`
  - `guild.members.ban` called once with `("u1", { deleteMessageSeconds: 3600, reason: "[Honeypot kick] same message in 3 channels" })`
  - `guild.bans.remove` called with `("u1", UNBAN_REASON)`
  - `honeypot.takeBanEvent("g1", "u1")?.action` is `"kick"`
  - the third call returns `"handled"` and the first two return `"not_caught"`.
- `"does nothing below the configured count"`: with count 4, `postIn("a","b","c")` makes no ban; then `postIn("d")` bans once.
- `"never acts on repeats in one channel"`: `postIn("a","a","a","a")` makes no ban, no delete and no `sendHoneypotEmbed`.
- `"leaves staff alone completely"`: a gateway member with `KickMembers`. No ban, no delete, no embed, no notice, `getSettingsFresh` not called, every call returns `"not_caught"`.
- `"leaves verified members alone completely"`: the same assertions, with a member holding `verified-role`.
- `"does nothing when the member lookup fails"`: `member: null`, and `fetch` rejects with Missing Permissions. No ban, no delete, no embed, no notice; `logger.warn` called once.
- `"kicks an author who already left"`: `member: null`, and `fetch` rejects with Unknown Member. Ban called once; the embed's `Honeypot Action` is `Kicked. They had already left; only what DragonBot saw was cleaned up.`
- `"makes no Discord or database calls below the threshold"`: `member: null`, `postIn("a","b")`. `guild.members.fetch`, `getSettingsFresh` and `ban` are not called.
- `"ignores bot, webhook and system posts, and servers with the check off"`: no `track` effect, so a following real post in `c` doesn't trigger.
- `"re-reads settings and kicks nobody when the fresh row no longer catches it"`. Each of these fresh overrides means no ban and no delete:
  - `{ isRepeatSpamEnabled: false }`
  - `{ repeatSpamChannelCount: 4 }`
  - `{ repeatSpamMatchMode: "exact" }`
  - `{ repeatSpamMatchMode: "fuzzy" }`
  - `{ verificationRoleId: <a role the member has> }`
  - `null`
- `"kicks an account once for a burst"`: `member: null` with a `fetch` that resolves on the next tick, and five copies in five channels run with `Promise.all`. Ban called once, one embed, and copies 4 and 5 have `delete` called.
- `"deletes copies that arrive while the case is open"`: the ban is held on a deferred promise. A copy in `d` has `delete` called and returns `"handled"`; a different sentence in `d` is not deleted and returns `"not_caught"`.
- `"shares the case with the channel trap"`: the trap is armed in `trap` with `honeypotAction: "ban"`, and the ban is held. While the repeated-message case is open, `handleHoneypotMessage` on a `trap` post deletes it. After release, `ban` was called once, with the kick reason, and `bans.remove` was called.
- `"deletes the copies itself when the kick fails, then sends a notice naming the check"`
  - `ban` rejects with Missing Permissions.
  - Each copy's channel has `messages.delete` called with its ID, before `sendNotice` (compare `invocationCallOrder`).
  - `notices(logging)` equals `` [`<@u1> (u1) posted the same message in 3 channels (repeated-message check). Removal failed: Missing Permissions. Copies deleted.`] ``.
- `"reports copies it couldn't delete"`: `ban` fails and channel `b`'s `messages.delete` rejects with Missing Permissions. The last notice is `` `... (repeated-message check). Couldn't delete 1 of the 3 copies: Missing Permissions. Delete them by hand if they're still there.` ``, and the case notice ends `Couldn't delete every copy.`
- `"logs the case with its own embed, whatever the event switches"`
  - `sendHoneypotEmbed` called once; its title is `Repeated Messages (Honeypot)`, its `Channels` field is `<#a>, <#b>, <#c>`, and its `Content` is the sentence.
  - `shouldLog` not called, and `sendLogEmbed` not called.
- `"starts no kick during shutdown and deletes nothing"`: `void honeypot.drain(1000)` first. No ban, no `delete`, no `messages.delete`; one notice ending `DragonBot was shutting down, so nobody was removed.`
- `"keeps the shutdown drain waiting for the case"`: the ban is held, and `drain` doesn't resolve until it is released.

In `message-log.test.ts`: `"builds the repeated-message embed"` asserts the title, description, field names in order (`Author`, `Channels`, `Content`, `Honeypot Action`, `ID`) and the 1024 cut on `Content`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter bot test repeat-spam-enforcer message-log`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `buildRepeatSpamEmbed`, `repeat-spam-enforcer.ts` as specified above, and the wiring in `message-create.ts`, `context.ts` and `index.ts`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter bot test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/lib/repeat-spam-enforcer.ts apps/bot/src/utils/message-log.ts apps/bot/src/events/message-create.ts apps/bot/src/types/context.ts apps/bot/src/index.ts apps/bot/tests/lib/repeat-spam-enforcer.test.ts apps/bot/tests/utils/message-log.test.ts
git commit -m "Kick accounts that post the same message in several channels"
```

---

### Task 5: Dashboard fields and validation

**Model:** Sonnet (exactly specified UI and validation).

**Files:**
- Modify: `apps/web/src/lib/validators.ts:2,137-140`. Extend the `@dragonbot/db` import; add the three fields after `honeypotAction`.
- Modify: `apps/web/src/app/dashboard/server/[guildId]/page.tsx`: the interface (lines 29–31), `handleSave` (lines 593–602) and the Honeypot card (lines 767–800).
- `apps/web/src/app/api/server/[guildId]/route.ts` needs no change: its scope check reads `FIELD_SCOPE_MAP` (Task 1).

**Interfaces:**
- Consumes: `REPEAT_SPAM_MATCH_MODES`, `REPEAT_SPAM_MIN_CHANNELS`, `REPEAT_SPAM_MAX_CHANNELS` (Task 1), in `validators.ts` only. `page.tsx` is a client component and doesn't import `@dragonbot/db`; it uses the literals 2 and 10 with a comment naming the constants.

- [ ] **Step 1: Add the validator fields**

```ts
isRepeatSpamEnabled: z.boolean().optional(),
repeatSpamChannelCount: z.number().int().min(REPEAT_SPAM_MIN_CHANNELS).max(REPEAT_SPAM_MAX_CHANNELS).optional(),
repeatSpamMatchMode: z.enum(REPEAT_SPAM_MATCH_MODES).optional(),
```

- [ ] **Step 2: Update the page.**
  - **Interface:** add `isRepeatSpamEnabled: boolean; repeatSpamChannelCount: number; repeatSpamMatchMode: "exact" | "ignore_case" | "similar";`.
  - **`handleSave`:** after the trap's block, and outside `hasDiscordData`, send each new field only when it differs from `savedSettings`. A save that turns the check on sends all three. Extend the comment above to cover both parts.
  - **The card:** in `<Section title="Honeypot">`, keep the existing toggle, picker and action under a subheading `Channel trap`, and relabel the toggle "Enable channel trap". Then add a second group under a subheading `Repeated messages`. Both subheadings use the label style `text-xs font-semibold text-dc-text-secondary uppercase tracking-wide`, and the second group sits in `border-t border-dc-border pt-3 mt-1`. It holds:
    - `Toggle` "Enable repeated-message check".
    - A number input labelled "Kick after the same message in this many channels", styled like the intro-gate inputs, with `min={2} max={10}`. `onChange` clamps to 2–10, using 2 when the value isn't a number.
    - A select labelled "Matching", styled like the Action select, with options `exact` "Word for word, case-sensitive", `ignore_case` "Word for word, ignoring case" and `similar` "Too similar".
    - One help `<p className="text-xs text-dc-text-muted">`: `Kicks an account that posts the same message in several different channels within a minute, and cleans up its messages from the last hour. Short messages like "gm" never count. Verified members and staff are never affected.`
  - Keep the existing help block at the end of the card. Its trap-specific lines stay as they are.

- [ ] **Step 3: Verify**

Run: `pnpm --filter web typecheck`, then `DATABASE_URL=postgres://u:p@localhost:5432/db JWT_SECRET=0123456789abcdef0123456789abcdef DISCORD_API_TOKEN=placeholder pnpm --filter web build`, then `git checkout -- apps/web/tsconfig.tsbuildinfo apps/web/next-env.d.ts`.
Expected: the typecheck is clean and the build succeeds; `git status` shows only the two task files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/validators.ts "apps/web/src/app/dashboard/server/[guildId]/page.tsx"
git commit -m "Add the repeated-message check to the dashboard's Honeypot card"
```

---

### Task 6: `/admin view-settings` and AGENT.md

**Model:** Sonnet (text changes).

**Files:**
- Modify: `apps/bot/src/commands/admin.ts:110`. Add a line after the Honeypot line.
- Modify: `AGENT.md`:
  - BotContext snippet: add `repeatSpam: RepeatSpamService;` after line 92.
  - Config table, Honeypot row (line 179): append `is_repeat_spam_enabled`, `repeat_spam_channel_count` (2–10, default 3) and `repeat_spam_match_mode` (`exact`, `ignore_case` or `similar`).
  - Full-access note (line 201): list the three new fields too.
  - `### Honeypot` section (lines 291–304).

- [ ] **Step 1: Add the view-settings line**

```ts
`**Repeated messages:** ${settings.isRepeatSpamEnabled ? "Enabled" : "Disabled"} (kick after ${settings.repeatSpamChannelCount} channels, ${REPEAT_MATCH_LABELS[settings.repeatSpamMatchMode]})`,
```

Define `REPEAT_MATCH_LABELS: Record<RepeatSpamMatchMode, string>` in `admin.ts`, using the dashboard's option texts.

- [ ] **Step 2: Update AGENT.md.**
  - The Honeypot intro now says the feature has two parts, the channel trap and the repeated-message check, each with its own switch.
  - Add one bullet, **Repeated-message check**, covering:
    - which messages count, the three levels and the length floor
    - the 60-second window, distinct channels and threads
    - kick only, through the trap's removal path, with reason `[Honeypot kick] same message in N channels`
    - verified members, staff and failed lookups left completely alone
    - the shared case: the first to claim an account decides the action
    - copies deleted on arrival while the case is open, and by DragonBot itself when the kick fails
    - in-memory tracking only (`RepeatSpamService`)
    - its embed goes out whenever logging is on
  - The Logging bullet: notices name the check that caught the account.
  - The Dashboard bullet: the new fields are sent only when they change.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm --filter bot test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/commands/admin.ts AGENT.md
git commit -m "Document the repeated-message check and show it in view-settings"
```

---

## After the last task

- Run `pnpm typecheck && pnpm test` across the workspace; everything passes.
- Run a whole-branch review on Opus against the spec's anti-goals: no kick for "gm"-style messages, nothing done to verified members or staff, and no kick copied into ban sync.
- Kevin pushes the three columns before merging (see Global Constraints). The spec's manual tests 1–7 are his: they need a test server and alt accounts.
