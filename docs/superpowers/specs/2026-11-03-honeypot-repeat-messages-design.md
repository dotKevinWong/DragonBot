# Honeypot: repeated-message check

Date: 2026-11-03. Builds on `docs/superpowers/specs/2026-10-29-honeypot-design.md` (the channel trap), which is live.

## Why

In the last spam wave, the accounts skipped the honeypot channel ("DragonPot"). They may have recognised the name as a trap. Each account posted the same message, word for word, in several channels within a few seconds. A check that doesn't depend on any one channel catches that pattern however the trap is named.

## Goals

- Kick an account that posts the same message in **3 or more different channels** within a short window.
- The channel count is configurable per server and defaults to 3.
- The new check and the channel trap are two parts of one Honeypot feature. A server can turn on either one, or both.

## Non-goals

- Changing how the channel trap behaves. Its code stays as it is, and its own switch already lets a server turn it off.
- Repeats in one channel. Someone may be making a joke, and Discord already handles same-channel floods.
- Ban as an action. This check only kicks.

## Anti-goals (a failure even if it technically works)

- Kicking a real member for saying something short like "gm", "lol" or an emoji in a few channels.
- Kicking or deleting anything from a verified member or staff.
- Copying a kick into ban sync.

## How it behaves

### What counts

- **Which messages.** Only messages from ordinary member accounts count. System messages, webhook posts and bot posts never count, and neither do DMs.
- **Same message.** How alike two copies must be is a per-server setting, "Matching", with three levels (Kevin, 2026-11-03). Every level first trims the text and collapses runs of whitespace. Attachments, stickers and embeds are never compared.
  - **Word for word, case-sensitive** (`exact`). The texts must be identical.
  - **Word for word, ignoring case** (`ignore_case`, the default). The texts must be identical once lowercased. *(my call on the default: a spammer changing one capital letter shouldn't slip through, and real members rarely repeat a sentence across channels)*
  - **Too similar** (`similar`). Paragraphs that are nearly the same count, so a changed emoji, a swapped word or a different link still match. *(my call on the rule)* Both texts are lowercased, links are replaced by one placeholder, and punctuation and emoji are removed. The texts then match when their word sets overlap by at least **80%**, measured as Jaccard similarity: shared words divided by all distinct words. Each new message is compared with the account's tracked messages from the window. "Copies" in the rest of this document means messages that match under the server's level.
- **Long enough.** A message counts only if its compared text is at least **20 characters and 3 words**, roughly a sentence. Shorter messages, lone emojis and attachment-only posts never count. *(my call, from Kevin's "typically a sentence")*
- **Window.** Copies count when they arrive within **60 seconds** of each other; specifically, within 60 seconds of the first copy being tracked. The window is fixed, not a setting. *(my call: Kevin's wave landed seconds apart)*
- **Different channels.** Copies are counted per distinct channel. Several copies in one channel count as one channel. A thread counts as its own channel. *(my call)*
- **Trigger.** When the copies of one message span at least the server's channel count (default 3), the account is caught.
- **Order with the channel trap.** A message in the honeypot channel is handled by the channel trap as today. A message the trap handles doesn't count towards this check.

### Who is left alone

Kevin's rule: verified members and staff are left completely alone. No kick, no delete, no log.
- **Staff** is the same list as the channel trap: Administrator, Manage Server, Kick Members or Ban Members.
- **Verified** means the member has the server's verification role, as in the channel trap. If no verification role is set, nobody counts as verified.
- If DragonBot can't look the member up, it does nothing. It fails closed, because the member might be staff or verified.
- **An author who already left** (Discord answers Unknown Member) is still caught. DragonBot bans and unbans them by ID to clean up, as the channel trap does. Spammers often post and leave at once. *(my call)*

This differs from the channel trap on purpose. There, a verified member's post is deleted, because the point is to keep that channel empty. Here, nothing is deleted.

### What happens to a caught account

- **Removal.** The account is kicked, using the same removal path as the channel trap's Kick mode. That path bans the account with a one-hour message cleanup, then unbans it, so its messages from the last hour across the server are deleted, the copies included. The account can rejoin.
- **Ban sync.** The temporary ban is kept out of ban sync, exactly as the channel trap's are.
- **Copies.** The tracker keeps each copy's channel and message ID.
  - Copies arriving while the case is open are deleted on arrival. Today's late-message handling only starts once the ban has gone through, so it doesn't cover them.
  - If the kick fails, DragonBot deletes the tracked copies itself, then sends the failure notice. *(my call)*
- **One case per account, shared with the channel trap.** Both parts use the same per-account case, and the first to claim the account decides the action. If the repeated-message check claims it first, a later post in the trap channel is only deleted. That account is then kicked, not banned, even when the trap is set to Ban. *(my call: this is rare, and the account is removed either way)*
- **Shutdown.** During shutdown, no kick starts, the same rule as the channel trap's Kick mode. Nothing is deleted in that case. *(my call)*
- **Logging.** The case is logged through the existing log channel and logger. The entry names the account, says it posted the same message in N channels, lists the channels, and includes the message text, like the channel trap's entries. It is clearly labelled as the repeated-message check, not the channel trap.
  - It is a new embed, not the trap's deleted-message embed.
  - It goes out whenever logging is on and a log channel is set, like a honeypot notice, whatever the event switches say. *(my call)*
- **Ban reason.** `[Honeypot kick] same message in N channels`. The `[Honeypot kick]` tag must stay at the start, so `guildBanAdd` keeps the temporary ban out of ban sync.
- **Failures.** A failure to kick, such as missing permissions or the account outranking DragonBot, sends a notice to the log channel, as the channel trap does. The shared notice text changes so each notice names the check that caught the account, not always "the honeypot channel".

### Dashboard

- **One Honeypot card** holds both parts, each with its own switch:
  - **"Channel trap"**: the existing switch, channel picker and Kick/Ban action.
  - **"Repeated messages"**: a new switch, a number field, "Kick after the same message in this many channels", default 3, and a "Matching" select with the three levels above, default "Word for word, ignoring case".
- **Number range.** 2 to 10. *(my call: 2 is very strict but a server may want it; above 10 a wave would already be over)*
- **Who can change it.** The new fields need full access, like the channel trap's: the server owner, Administrator, Manage Server, or a dashboard manager with `*`. They decide who gets kicked.
- **Saving.** Like the channel trap's fields, the new fields are sent only when they change.
- **Help text.** One short paragraph explains the check and says verified members and staff are never affected.

### Data

Three new columns on `guilds` (Kevin pushes the schema himself, before merging):
- `is_repeat_spam_enabled` boolean, not null, default `false`.
- `repeat_spam_channel_count` integer, not null, default `3`.
- `repeat_spam_match_mode` text, not null, default `'ignore_case'`, one of `exact`, `ignore_case`, `similar`.

All three are written only by the dashboard `PATCH`, validated to the range above, and read by the bot through the existing settings cache.

## Constraints

- **Memory.** Tracking lives in memory only. It holds, per server and account, the recent qualifying messages (channel, message ID, compared text or a hash of it, time), and drops entries older than the window. The tracker must stay small under a wave of many accounts: prune on every message, and cap the entries per account. A restart forgets everything, which is acceptable for a 60-second window.
- **Speed.** Every non-bot message in a server with the check on passes through it, so the check must make no Discord or database calls unless the threshold is reached. Then it takes the same path as a channel-trap case, including the fresh settings re-read before acting.
- **Existing rules.** Follow AGENT.md, including "What AI Agents Must NOT Do". Don't run `db:push`, `db:migrate` or `drizzle-kit`.

## Also update

- AGENT.md's Honeypot section.
- `/admin` view-settings: show whether the check is on and its count.

## Testing

**Automated, in Vitest:** the counting rules each get a test.
- Each matching level: what matches and what doesn't, including case under `exact` and `ignore_case`, and a changed emoji, word or link under `similar` (and a clearly different sentence not matching).
- The length floor.
- Distinct channels: same-channel repeats don't count.
- The window edge.
- The threshold at the configured count.
- Staff, verified and lookup-failed authors are left alone.
- One kick per account.
- Kick-mode removal is reused.

**Manual, with alt accounts:**
1. An ordinary account posts one sentence in 3 channels within a minute. It is kicked, its copies are gone, and the log entry lists the channels.
2. The same account posts a sentence 3 times in one channel. Nothing happens.
3. Posting "gm" in 3 channels does nothing.
4. A verified account posts one sentence in 3 channels. Nothing happens and nothing is logged.
5. Set Matching to case-sensitive: the same sentence in 3 channels with one word's case changed does nothing. Set it to "Too similar": the sentence with a changed emoji or link in each channel kicks.
6. Set the count to 4. Posts in 3 channels do nothing, and a fourth channel kicks.
7. Turn off the channel trap and leave the repeated-message check on: the check still works. Do the reverse: the trap still works.

## Left to the builder

File layout, names, the hashing choice and the tracker's data structure, as long as the behaviour above holds.
