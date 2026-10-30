# Honeypot Channel: Design

- **Date:** 2026-10-29
- **Status:** Approved by Kevin on 2026-10-29
- **Branch:** `claude/dragonbot-honey-pot-c00669`
- **Mockups reviewed:** dashboard card, pinned warning (style B chosen), log entries
- **Reviewed by:** a builder check (nothing important left), a Discord API fact check, and a risk review. Their fixes are folded in below and marked *(review)*.

## Why

Spam waves keep hitting the servers. Two kinds of accounts do it: brand-new throwaway accounts, and hacked accounts that join and start posting. Both post the same giveaway scam ("Hey @everyone! I'm moving overseas… everything below is FREE… DM me or text me at …") into every channel they can see.

A honeypot channel is a channel no human has a reason to post in. A person reads the warning and leaves it alone. A spam account posting everywhere posts there too, and that gives it away. DragonBot treats any post in the honeypot as proof of a spam account. It removes the account and cleans up what the account already posted elsewhere.

Kevin wants kick or ban to be a setting. He wants to try both and see whether kicked accounts come back.

## Goals

- An admin turns the honeypot on in the web dashboard, picks the channel, and picks **Kick** or **Ban**. This is set per server and is off by default.
- While the honeypot is on, DragonBot keeps a pinned warning in that channel. The wording matches the chosen action.
- When an ordinary account posts in the honeypot, three things happen:
  - The message is deleted and logged.
  - The account is kicked or banned.
  - The account's messages from the **last hour** are cleaned up in every channel. This is best effort: Discord's own ban cleanup, plus DragonBot's sweep of what it saw.
- When a **verified member** posts there, the message is deleted and logged, and nothing else happens.
- When **staff** post there, nothing happens.
- Honeypot bans are **never** copied to other servers by ban sync.
- Logging reuses the existing log channel and the existing log formats.

## Non-goals

- No stronger response to verified members. Kevin accepted this gap: if a verified Drexel student's account were hacked, it would arrive already verified, so the honeypot would only delete its message. This has not happened so far. Revisit if it does.
- No DM to accounts that get removed.
- No slash commands for changing honeypot settings. Settings stay dashboard-only, as `AGENT.md` requires.
- No grouping of many bans into one request during large waves, no dry-run or log-only mode, and no dashboard check of the bot's permissions.
- No search-API sweep. The leftover sweep only uses messages DragonBot itself received. *(review; possible follow-up)*
- Spam posted **through a user-installed app** is not caught. Discord shows the app's bot as the author, and the real account only as `message.interactionMetadata.user`. *(review; possible follow-up)*
- No durable record of a kick that is half-done when the bot crashes. See "Removing the account".
- Only one honeypot channel per server. *(my call)*

## Anti-goals (a failure even if everything technically works)

- A real member who did **not** post in the honeypot gets removed, or loses messages.
- Staff get kicked, banned or have their message deleted for posting in the honeypot.
- A honeypot **kick** leaves the person banned, either in this server or (through ban sync) in other servers.
- Logs are duplicated or misleading. For example, a honeypot kick must not show up as "Member Banned" followed by "Member Left".
- Someone is removed for posting in a channel where no warning was ever shown.
- A schema mismatch at deploy, or one server's error, takes the bot down for every server.

## How it behaves

### Dashboard settings

Add a new **Honeypot** card to the server settings page, directly after **Moderation**. It follows the approved mockup:

| Control | Field | Notes |
|---|---|---|
| "Enable honeypot" toggle | `isHoneypotEnabled` | Default `false`. |
| "Honeypot Channel" text-channel select | `honeypotChannelId` | Nullable. Same `ChannelSelect` (`filterType="text"`) as the other channel pickers. |
| "Action" select: "Ban: removed for good" / "Kick: removed, can rejoin" | `honeypotAction` | `'kick' \| 'ban'`. Default `'kick'`. *(my call: the gentler default while Kevin experiments. A wrong channel choice then can't permanently remove anyone.)* |

The help text under the controls (from the mockup) says:
- Their messages from the last hour are cleaned up across the whole server either way.
- Verified members only have the message deleted.
- Staff are ignored. List the exact staff permissions, as defined in "Who triggers what".
- Honeypot bans are never copied to other servers by ban sync.
- *(my call)* Pick a channel everyone can see and post in but nobody has a reason to use.
- *(review)* Test it with an alt account. If you aren't staff, posting there removes you.

**Guards** *(review)*:
- **Server side:** the `PATCH` route rejects a honeypot channel that equals any other channel configured for the server, with a clear message. That covers the welcome, log, intro, mod notes, XP level-up and birthday channels. Compare against the values after the update, so take the body's value if present and the database's otherwise. One mis-click otherwise makes every new member's intro a ban.
- **In the dashboard:**
  - Turning the honeypot **on** is allowed only when the channel list loaded and contains the selected channel. Turning it **off** is always allowed.
  - A stored channel ID that isn't in the list shows as "Unknown channel (`<id>`)", not "None".

The honeypot is **configured** when it is enabled and a channel is set. It is **armed** (enforcing) only when the warning is also in place. See "No warning, no enforcement" below.

**Who can change these settings:** the fields map to the existing `moderation` permission scope in `FIELD_SCOPE_MAP`. *(my call)*

### The pinned warning (style B, approved)

The warning is a single embed:
- **Color:** `0xf0b232` (Discord warning yellow, the same as the dashboard's `dc-warning`).
- **Title:** `⚠️ Do not post in this channel`
- **Description:** exactly `If you send a message in this channel, you will be automatically kicked. There will be no exceptions.`, with `banned` in place of `kicked` when the action is Ban.

There is no other content. DragonBot pins it.

**Lifecycle (approved):**

| Situation | What DragonBot does |
|---|---|
| Honeypot becomes configured | Posts the warning in the channel and pins it. |
| Action changes | Edits the existing warning in place. |
| Channel changes | Deletes the old warning, then posts and pins a new one in the new channel. |
| Turned off, or channel cleared | Deletes the warning. |
| Warning deleted by someone while configured | Posts and pins it again **straight away**. `messageDelete` sees the stored warning ID and runs the sync. *(review)* |
| Warning found unpinned | Pins it again. |

**No warning, no enforcement** *(review, my call)*: the honeypot acts only when the warning exists:
- The stored warning channel must equal the configured channel, and a warning message ID must be stored.
- Being **posted** is enough; being **pinned** isn't required. That way, a missing Pin Messages permission doesn't switch the honeypot off. It only leaves the warning unpinned and produces a notice.

**When syncs run:**
- Right after a dashboard save, through the existing webhook reload.
- On bot startup, after settings are hydrated. Start it after the webhook server and the 4-hour timer are set up, so a slow sync can't hold them back.
- On the 4-hour periodic sync.
- On `/admin reload`.
- When the warning is deleted (above).

A full sync visits every server that is configured **or** still has stored warning IDs. That way a server that was turned off while the bot was down still gets its old warning removed.

Each sync is a reconcile: it compares the warning that should exist with the one that does, and fixes only the difference, so running it twice changes nothing. **Rules:**

- **One sync at a time per server.** Inside that lock, read the guild row (including the stored warning IDs) **from the database**, not the settings cache. The cache can be stale after a `hydrateAll`. *(review)*
- **Fetch the channel through the guild:** `guild.channels.fetch(id)`, never `client.channels.fetch`. The `PATCH` only checks the ID's format, so a crafted ID could otherwise make DragonBot post its warning in another server. *(review)*
- **Adopt, don't duplicate.** Before posting, look through the channel's pins for an existing DragonBot warning (bot-authored, same title). Adopt it, store its ID, and delete any extras. This covers a post whose ID failed to save. *(review)*
- **Classify errors** *(review)*:

  | Error | Meaning | What the sync does |
  |---|---|---|
  | 10008 Unknown Message, 10003 Unknown Channel | **Gone** | Clear or replace the stored IDs. |
  | 50001 Missing Access, 50013 Missing Permissions | **Can't tell** | Keep the stored IDs, don't post a duplicate, and report a notice. |
  | 30003 (pin limit, 250 per channel) | Can't pin | Report a notice. |

  The "can't tell" rule covers the **current** warning. When DragonBot is removing an **old** warning (because the honeypot was turned off or moved to another channel) and can't tell whether it's still there, it does two things. It reports a notice asking for the old warning to be deleted by hand, and it forgets the old IDs. There's only one stored ID pair, so keeping the old IDs would stop the new warning from ever being recorded. *(plan check)*

- **Silence the bot's own deletions.** Before DragonBot deletes its own old warning, add the warning's ID to the skip set. Otherwise, after a restart, the uncached message would be logged as "Unknown / Content not cached". *(review)*
- **Report failures in the log channel.** When DragonBot can't post, pin or delete a warning, it reports this in the log channel (see Logging) as well as through pino.
- **Never crash the bot.** Every server's sync is wrapped in its own try/catch, and the startup and timer calls are wrapped too. Today an unhandled rejection exits the process, and Railway gives up after 10 restarts. *(review)*

DragonBot remembers where its warning lives in two new columns that only the bot writes: `honeypotWarningChannelId` and `honeypotWarningMessageId`. They are **not** in the dashboard's update schema, so the dashboard cannot write them.

### Who triggers what

The check runs in `messageCreate`, for messages in the configured honeypot channel. It runs **before** the intro gate and XP, and a honeypot message never earns XP.

**Ignored before anything else** *(review)*:
- **System messages** (`message.system`): join notices, boosts, pin notices, thread-created notices, AutoMod alerts. Discord gives these a human author. Without this check, every new member would be removed if the honeypot were the server's system-messages channel.
- **Webhook messages** (`message.webhookId`).
- **Bots**, including DragonBot itself. The handler already returns early for these.

Then:

| Author | Result |
|---|---|
| **Staff:** the member has Administrator, Manage Server, Kick Members or Ban Members. Kevin confirmed this list stays as is: helpers who only have Manage Messages or Timeout Members, and dashboard managers without these permissions, are **not** staff. | Ignored completely: not deleted, not logged. |
| **Verified:** the member has this server's configured verification role (`verificationRoleId`) | Message deleted and logged. No kick or ban, and no cleanup elsewhere. |
| Everyone else | Message deleted and logged, the account is kicked or banned, and its last hour of messages is cleaned up. |

- **What "verified" means** *(my call)*: the member has this server's verification role. If the server has no verification role set, nobody counts as verified. The bot uses the role rather than DragonBot's cross-server verification record, so it decides the same way an admin would by looking at the member in Discord.
- **Looking up the member** *(review)*:
  - Use `message.member` from the gateway payload. Fetch only if it's missing.
  - **10007 Unknown Member** means the account already left. Treat it as "everyone else": a ban by user ID still works on a non-member.
  - **Any other lookup error** (timeout, 5xx): delete the message and log "couldn't check membership". Never remove the account, because it might be staff.
- **Re-check the settings before removing anyone** *(review)*. Read the guild's honeypot settings fresh from the database, and confirm the honeypot is still enabled, on this channel, with an action. Use that action, and refresh the cache if it differs. The dashboard's reload ping is fire-and-forget and can be lost, so the cache alone could keep enforcing a honeypot an admin just turned off.
- Messages in **threads** under the honeypot channel are not covered. *(my call)*

### Removing the account

- **Ban:** ban the user with `deleteMessageSeconds: 3600`. The reason must contain a fixed marker and the triggering message ID, for example `[Honeypot] posted in #<channel-name> (msg <id>)`. *(review)*
- **Kick:** a ban is the only single Discord call that cleans up a user's messages across a whole server. So:
  1. If the user is **already banned**, for example by a mod or by ban sync moments before, skip both the ban and the unban. Only delete the message. Otherwise the unban would lift someone else's ban. *(review)*
  2. Ban with the reason `[Honeypot kick] posted in #<channel-name> (msg <id>)`.
  3. Unban immediately, with nothing queued in between, using the reason `[Honeypot kick] unban after message cleanup`.

  The result: the account is gone, its last hour of messages is gone, and it can rejoin.
  - **10026 Unknown Ban** on the unban counts as success. *(review)*
  - On any other unban error, retry once. If it still fails, report that the account is **still banned and needs a manual unban** (a failure notice).
  - If the ban call ends in a timeout or 5xx, the ban may still have happened. Check `guild.bans.fetch` and unban if the ban is there. *(review)*
- **Graceful shutdown** *(review)*: before `client.destroy()`, wait for in-flight honeypot actions to finish, within the existing 8-second shutdown deadline. `destroy()` clears the REST token, which would strand a kick between its ban and its unban.
- **Crash between the ban and the unban** *(my call)*: the account stays banned and nothing is logged. This is accepted as a rare gap (the window is milliseconds), and no table is added for it. Kevin can unban by hand. If it ever happens in practice, add a pending-unbans table that is replayed on startup.
- **One case per account** *(review)*:
  - In-flight actions are keyed by server and user, released in a `finally`, and given a hard timeout.
  - Further honeypot messages from the same account are part of the **same case** if they arrive while the action runs, or if their snowflake timestamp is earlier than the moment the action finished. They are deleted, but they don't start another action or write another log entry.
  - A later post (say, after a kicked account rejoins) is a new case.
- **If the ban fails** (role hierarchy, missing Ban Members, 2FA requirement, non-member ban cap): the message is still deleted. Drop the action record and report the failure and its reason.
- **Leftover sweep** *(review, my call)*: Discord's ban cleanup is known to sometimes miss the newest message (discord-api-docs issue #8360, still open). So:
  - About 15 seconds after a kick or ban, DragonBot deletes any messages from that account still in its own message cache, in any channel of the server, from the last hour.
  - For about 2 minutes after the action, any new message from that account in the server is deleted on arrival. This catches messages Discord accepted around the moment of the ban.
  - Neither step writes individual log entries.
- **If the account had already left:** Discord's cleanup may not apply. The log must not claim the last hour was cleaned up in that case. Say "they had already left; only what DragonBot saw was cleaned up".

### Ban sync and the existing ban and kick handlers

Before DragonBot calls Discord, it records each honeypot action in memory. The record holds the server, user, kick or ban, the reason string and the channel. Rules for the record *(review)*:

- **Lifetime:** about 10 minutes, counted from when the ban call **resolves**, not from when it was queued. During a wave, discord.js can hold a ban behind rate limits for over a minute.
- **Read it first:** both handlers read the record **as their first statement, before any `await`**.
- **Single use:** each handler matches a record at most once, so a later ban or departure by the same user is handled normally.
- **Remove on failure:** the record is removed when the ban fails.
- **Backstop:** before `syncBan`, also skip if the ban's reason contains the `[Honeypot` marker.

How the existing handlers use it:

- **`guildBanAdd`, for a honeypot action:**
  - It **never** runs ban sync.
  - **Ban mode:** it still calls `markBanned`, and still posts the "Member Banned" log. The log's reason comes **from the record**, not from Discord. The fact check couldn't confirm that the audit-log reason comes back as the ban's own reason. *(review)*
  - **Kick mode:** it skips `markBanned`, and skips the "Member Banned" log, because to admins this is not a ban.
- **`guildMemberRemove`:**
  - **Honeypot kick:** skip the audit-log fetch. Log the kick the same way a manual kick is logged today: the "Member Kicked" `member_leave` entry and the "Kick" `kick` entry, with *Kicked by* set to DragonBot and *Reason* set to the record's reason.
  - **Honeypot ban:** skip the "Member Left" entry. The honeypot entry and "Member Banned" already tell the story, and in a wave this is a third entry per spammer. *(review, my call)*
- **Unban:** there is no `guildBanRemove` handler, so nothing is logged. That's fine.

### Logging

- **The honeypot deletion entry** uses the same layout as the existing "Message Deleted" embed in `events/message-delete.ts`.
  - Pull that layout into one shared builder so the two can't drift apart.
  - The title becomes `Message Deleted (Honeypot)`.
  - Add a **Honeypot Action** field that says one of:
    - "Banned. Their messages from the last hour were cleaned up."
    - "Kicked. Their messages from the last hour were cleaned up."
    - "Message deleted only (verified member)."
    - The left-already wording or a failure text from the previous section.
  - Build the entry from the message already in hand, so it never depends on Discord's message cache.
- **When it's sent:** under the same condition as ordinary deleted-message logs. Logging must be enabled, a log channel set, and `message_delete` among the selected log events. *(my call: "reuse the same logger")*
- **Failure notices** *(review)* are sent whenever logging is enabled with a log channel, **whatever the event toggles**. These cover: removal failed, still banned, couldn't check membership, and the warning couldn't be posted, pinned or removed. A server that logs bans but not deletes must still learn that someone is stuck banned.
- **The generic `messageDelete` handler skips:**
  - messages the honeypot deleted. Add the trigger's ID to the skip set **before** deleting or banning, because the ban's cleanup can delete it first, and treat 10008 on the trigger delete as success;
  - DragonBot's own warning;
  - messages by an account with a recent honeypot action in that server. *(review, my call)*

  It's not documented whether Discord reports ban cleanup as one bulk delete per channel or as single deletes, and the bot has no bulk-delete handler. Without the last rule, single deletes from a 30-account wave could mean hundreds of log entries.
- Kick and ban entries come from the existing `kick`, `ban` and `member_leave` log events, as described above.

## Data

Add these columns to the `guilds` table. All of them are new; nothing existing changes.

| Column | Type | Default | Written by |
|---|---|---|---|
| `is_honeypot_enabled` | boolean not null | `false` | dashboard |
| `honeypot_channel_id` | varchar(20) | null | dashboard |
| `honeypot_action` | text not null (`'kick'` or `'ban'`) | `'kick'` | dashboard |
| `honeypot_warning_channel_id` | varchar(20) | null | bot only |
| `honeypot_warning_message_id` | varchar(20) | null | bot only |

There is a precedent for a bot-only column: `lastBirthdayCheckDate`.

**Deploy order** *(review)*. Both apps use Drizzle `select().from(guilds)`, which names every column in the schema. Old code doesn't notice the extra columns; new code fails on every settings read if they're missing. So the schema goes live **before** the merge that deploys the new code:

1. Kevin runs `pnpm --filter @dragonbot/db exec drizzle-kit push --verbose --strict` against Neon. He approves only if it shows **exactly five** `ALTER TABLE "guilds" ADD COLUMN` statements. `push` applies every difference it finds, so anything else means production has drifted, and he should stop.
2. Confirm the columns exist.
3. Merge.

Kevin runs the push himself, because it's the production database.

## Constraints

- **Layering, per `AGENT.md`:** event handlers stay thin, services hold the logic and don't import `discord.js`, and repositories only talk to the database.
  - The decision logic (who gets what, same-case grouping) and the in-memory tracking (actions in flight, recent actions, the skip set) must be testable without Discord.
  - Discord calls belong in `events/` or `lib/`, like `lib/birthday-checker.ts`.
- **Bot permissions** in the honeypot channel and the server *(review)*:
  - View Channel, Send Messages, Embed Links and **Read Message History**. The sync fetches the stored warning and the channel's pins.
  - **Pin Messages.** This has been required since 2026-02-23, when Manage Messages stopped covering pins. **DragonBot's existing role probably doesn't have it.** Kevin grants it before turning the honeypot on.
  - Manage Messages, to delete other people's messages.
  - Ban Members.
  - View Audit Log, which the bot already uses.
  - In a server that requires 2FA for moderation, bans and deletes fail until the server owner has 2FA on. This is the same limit as existing moderation.
- **Role order:** DragonBot's role must sit above the roles of the accounts it removes.
- **Dashboard:** send `honeypotChannelId` only when Discord data loaded. This is the existing `hasDiscordData` guard in `handleSave`. Always send `isHoneypotEnabled` and `honeypotAction`.
- **Validation:** add these to `guildSettingsUpdateSchema`: `isHoneypotEnabled` (boolean), `honeypotChannelId` (snowflake, nullable) and `honeypotAction` (`z.enum(["kick","ban"])`). Don't add the two warning-ID columns. The `PATCH` route also runs the channel-conflict check from "Dashboard settings".
- **Webhook server:** today `lib/webhook-server.ts` reloads settings and schedules. It also needs to trigger the warning sync: for one server on a per-server reload, and for every server on a full reload.
- **No new environment variables.**

## Also update

- **`/admin view-settings`:** add a Honeypot line. Show on or off, the channel, the action, and whether the honeypot is armed (the warning is in place).
- **`AGENT.md`:**
  - the per-guild config table (add a Honeypot row)
  - the `guilds` table notes
  - a new "Honeypot" entry under Bot Features
- **`README.md`:** the features list.
- **`FIELD_SCOPE_MAP`** in `packages/db/src/permissions.ts`.
- The dashboard's `GuildSettings` interface.

## Testing

**Automated (Vitest, bot):**
- **The decision table:** staff, verified and everyone else, each with kick and with ban.
  - System messages (UserJoin, GuildBoost) and webhook messages are ignored.
  - A lookup error other than 10007 never removes anyone.
- **Warning text** for each action.
- **In-flight tracking and same-case grouping:** several messages from one account during an action produce one action and one log entry.
- **The action record, with fake timers:**
  - Its lifetime starts when the ban resolves.
  - A `guildBanAdd` that arrives after a slow log send still skips ban sync.
  - Each record matches once.
  - A failed ban drops its record.
  - An account that posts, is kicked, rejoins and posts again is handled twice.
- **Kick mode:**
  - An already-banned user is not unbanned.
  - 10026 on the unban counts as success.
  - An uncertain ban result is checked and undone.
- **Warning sync cases:**
  - nothing there yet → post and pin
  - same channel, new action → edit
  - new channel → delete the old one, post the new one
  - turned off → delete
  - warning missing → post again
  - a warning already in the pins is adopted, and extras are deleted
  - 10008 or 10003 → gone; 50001 or 50013 → can't tell (IDs kept)
  - a posted but unpinned warning still arms the honeypot
  - one server throwing doesn't stop the others
- **The `PATCH` channel-conflict check.**
- `pnpm typecheck` and `pnpm test` pass across the workspace.

**Manual test plan (Kevin, in a test server, with an alt account):**
1. Push the schema as in "Data", then merge and deploy. Give DragonBot's role **Pin Messages** and **Read Message History**.
2. Turn the honeypot on, pick a channel, choose **Kick** and save. Within seconds, the warning is posted and pinned and says "kicked".
3. Switch to **Ban** and save. The same message is edited to say "banned".
4. Pick a different channel and save. The old warning disappears, and a new one is pinned in the new channel. Delete the warning by hand: it comes back straight away.
5. With an unverified alt that has no staff permissions, post in two normal channels, one of them a forum or media channel if you have one, then post in the honeypot. Expected:
   - All the messages are gone; look for leftovers.
   - The alt is banned.
   - The log shows the honeypot entry and "Member Banned" with the honeypot reason, and no "Member Left".
   - Server Settings → Bans shows the reason.
   - A server with ban sync turned on did **not** ban the alt.
6. Switch to **Kick** and repeat. Expected:
   - The alt is removed and can rejoin with an invite.
   - The log shows "Member Kicked", kicked by DragonBot.
   - There is no "Member Banned" entry, the alt is not left banned, and no leftover messages remain.
7. Give the alt the verification role and post in the honeypot. The message is deleted and logged, and the alt stays.
8. Post from a staff account. The message stays, and nothing is logged.
9. Point the honeypot at the server's System Messages channel and join with a second alt. Nothing happens to it.
10. Remove Pin Messages from DragonBot's role and re-save. Expected: the warning is posted but not pinned, a notice appears in the log channel, and the honeypot still enforces. Grant the permission back: the next sync pins it.
11. Turn the honeypot off. The warning is removed.
12. Note whether the cleanup produced individual "Message Deleted" logs. With the skip rule, it shouldn't.

## Left to the builder

- The split into files and modules, the names, and how the webhook server reaches the warning sync.
- Exact timings: the record lifetime (~10 minutes), the sweep delay (~15 seconds), the late-message window (~2 minutes) and the in-flight timeout.
- Log wording beyond what's specified above.
- Whether to also delete Discord's "DragonBot pinned a message" notice. The mockup kept it.

## Calls made without Kevin (please check)

1. The default action for a new setup is **Kick**.
2. "Verified" means the member has **this server's verification role**.
3. The honeypot deletion entry follows the existing **`message_delete`** log toggle. Failure notices always go to the log channel when logging is on.
4. The dashboard fields use the **`moderation`** permission scope.
5. Threads under the honeypot channel are **not** covered.
6. A kick-mode honeypot action doesn't mark the user as banned in DragonBot's records. A ban-mode action does, as any ban does today.
7. Only one honeypot channel per server.
8. **No warning, no enforcement:** the honeypot only acts once its warning is posted in the channel. Pinned isn't required.
9. **Leftover sweep:** DragonBot deletes leftovers it saw, about 15 seconds after the action, and deletes the account's new messages for about 2 minutes. Discord's cleanup alone sometimes misses one.
10. A crash in the milliseconds between a kick's ban and its unban leaves the account banned. This is accepted, with no extra table.
11. A honeypot ban skips the extra "Member Left" log entry.
12. The cleanup's individual delete events (if Discord sends them) aren't logged one by one.
13. A honeypot channel can't be the same as any other channel configured for the server.
