import {
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type Guild,
  type GuildMember,
  type Message,
} from "discord.js";
import type { Logger } from "pino";
import { HONEYPOT_ACTIONS, findHoneypotChannelConflict, type GuildRow, type HoneypotAction } from "@dragonbot/db";
import {
  CLEANUP_SECONDS,
  SWEEP_DELAY_MS,
  UNBAN_REASON,
  decideHoneypot,
  isRealPost,
  removalReason,
  type HoneypotDecision,
  type MemberStatus,
} from "../services/honeypot.service.js";
import type { BotContext } from "../types/context.js";
import { buildMessageDeletedEmbed } from "../utils/message-log.js";

/** A member with any of these is staff, and the honeypot leaves them alone. Nothing else counts. */
const STAFF_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];

/** Discord's bulk delete takes at most this many messages. */
const BULK_DELETE_LIMIT = 100;

/** A failure reason is cut to this length before it goes into a log entry or a notice. */
const MAX_REASON_LENGTH = 200;

/** Why a honeypot message is deleted without removing anyone: the decision, or a kick held back at shutdown. */
type DeleteOnlyWhy = Extract<HoneypotDecision, { type: "delete_only" }>["why"] | "shutting_down";

/** The author of a honeypot message, as far as Discord could tell. */
type Author = { kind: "member"; member: GuildMember } | { kind: "left" } | { kind: "lookup_failed"; err: unknown };

type BanCheck = { kind: "banned" } | { kind: "not_banned" } | { kind: "unknown"; reason: string };

type BanResult = { kind: "confirmed" } | { kind: "uncertain"; reason: string } | { kind: "failed"; reason: string };

/** How a removal case ended. Every outcome but "removed" and "already_banned" also goes out as a notice. */
type Outcome =
  | { kind: "removed"; action: HoneypotAction; memberLeft: boolean }
  | { kind: "already_banned" }
  | { kind: "failed"; reason: string }
  | { kind: "unconfirmed"; reason: string }
  | { kind: "still_banned"; reason: string };

/** A moderator has to act on these outcomes, so they go out as notices, and pino logs them at warn. */
function needsAttention(outcome: Outcome): boolean {
  return outcome.kind === "failed" || outcome.kind === "unconfirmed" || outcome.kind === "still_banned";
}

function hasErrorCode(err: unknown, code: number): boolean {
  return err instanceof DiscordAPIError && err.code === code;
}

/** Why a Discord call failed. */
function describeError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

function cutReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}

/**
 * The honeypot is on in the message's channel, its warning is posted there, and the message was posted after the
 * warning. No warning, no enforcement: a post from before the warning existed was made without one shown.
 */
function isArmedFor(settings: GuildRow, message: Message<true>): boolean {
  return (
    settings.isHoneypotEnabled &&
    settings.honeypotChannelId === message.channelId &&
    settings.honeypotWarningChannelId === settings.honeypotChannelId &&
    !!settings.honeypotWarningMessageId &&
    isNewerSnowflake(message.id, settings.honeypotWarningMessageId)
  );
}

const ALL_DIGITS = /^\d+$/;

/** Whether snowflake `id` was made after snowflake `than`. False when either isn't all digits, so nothing is enforced. */
function isNewerSnowflake(id: string, than: string): boolean {
  return ALL_DIGITS.test(id) && ALL_DIGITS.test(than) && BigInt(id) > BigInt(than);
}

function isVerified(member: GuildMember, verificationRoleId: string | null): boolean {
  return !!verificationRoleId && member.roles.cache.has(verificationRoleId);
}

/** The member from the gateway payload, fetched only when it's missing. */
async function lookUpAuthor(message: Message<true>): Promise<Author> {
  if (message.member) return { kind: "member", member: message.member };
  try {
    return { kind: "member", member: await message.guild.members.fetch(message.author.id) };
  } catch (err) {
    if (hasErrorCode(err, RESTJSONErrorCodes.UnknownMember)) return { kind: "left" };
    return { kind: "lookup_failed", err };
  }
}

function memberStatus(author: Author, verificationRoleId: string | null): MemberStatus {
  if (author.kind === "left") return { kind: "left" };
  if (author.kind === "lookup_failed") return { kind: "lookup_failed" };
  return {
    kind: "member",
    isStaff: author.member.permissions.any(STAFF_PERMISSIONS),
    isVerified: isVerified(author.member, verificationRoleId),
  };
}

/**
 * Enforces the honeypot on a message, before the intro gate and XP. Staff are left alone, verified members only lose
 * the message, and anyone else is kicked or banned with their last hour of messages cleaned up. Once shutdown has
 * begun, a new kick-mode case only deletes the message. "handled" means the message is the honeypot's, so it gets no
 * further processing and earns no XP.
 */
export async function handleHoneypotMessage(
  message: Message<true>,
  settings: GuildRow,
  ctx: BotContext,
): Promise<"not_honeypot" | "handled"> {
  if (!isArmedFor(settings, message)) return "not_honeypot";
  // Members are expected to post in the System Messages channel: Discord's "Wave to say hi" button posts a reply,
  // which isn't a system message. Read from the gateway's copy of the server, so a later change there counts too.
  if (message.channelId === message.guild.systemChannelId) return "not_honeypot";
  const honeypot = ctx.services.honeypot;
  // Noted as the tracked work begins, which is when the message arrived. A message that arrived before the drain
  // began is handled in full, even if the drain begins while it waits for its settings re-read.
  const closingOnArrival = honeypot.isClosing;
  // Shutdown waits for all of this, not only the removal. Otherwise the drain could resolve during the settings
  // re-read, and destroy() could then land between a kick's ban and its unban, or cut off a delete-only log entry.
  return honeypot.track(handleArmedMessage(message, settings, closingOnArrival, ctx));
}

/** The rest of handleHoneypotMessage, once the cached row says the honeypot is armed in the message's channel. */
async function handleArmedMessage(
  message: Message<true>,
  settings: GuildRow,
  closingOnArrival: boolean,
  ctx: BotContext,
): Promise<"not_honeypot" | "handled"> {
  // System notices (a join notice's author is the new member), webhook posts and bot posts are left alone.
  if (!isRealPost({ system: message.system, webhookId: message.webhookId, authorIsBot: message.author.bot })) {
    return "handled";
  }

  const author = await lookUpAuthor(message);
  const decision = decideHoneypot(memberStatus(author, settings.verificationRoleId));
  if (decision.type === "ignore") return "handled";

  // Re-read before deleting or removing anything: the dashboard's reload ping can be lost, leaving the cache stale.
  // A channel another setting uses is one members post in, for example after two dashboard saves at the same moment.
  const fresh = await ctx.services.guild.getSettingsFresh(message.guildId);
  if (
    !fresh ||
    !isArmedFor(fresh, message) ||
    !HONEYPOT_ACTIONS.includes(fresh.honeypotAction) ||
    findHoneypotChannelConflict(fresh) !== null
  ) {
    return "not_honeypot";
  }
  if (decision.type === "delete_only") {
    // The decision picks the texts. A failed lookup's error only adds its reason to the notice.
    await deleteOnly(message, decision.why, ctx, author.kind === "lookup_failed" ? author.err : undefined);
    return "handled";
  }
  // The cached row can predate a change to the verification role.
  if (author.kind === "member" && isVerified(author.member, fresh.verificationRoleId)) {
    await deleteOnly(message, "verified", ctx);
    return "handled";
  }

  const honeypot = ctx.services.honeypot;
  const started = honeypot.beginCase(message.guildId, message.author.id, message.createdTimestamp);
  if (started.kind === "same_case") {
    // Part of a case that's already being handled: no second removal and no second log entry. A failed delete gets
    // no notice either: no log entry claims it, and a burst would flood the log channel.
    await deleteHoneypotMessage(message, ctx);
    return "handled";
  }
  if (closingOnArrival && fresh.honeypotAction === "kick") {
    // The gateway stays open while the drain waits, so a wave keeps posting. The drain's cap or destroy() could cut a
    // new kick off between its ban and its unban, leaving the account banned, so none starts. A ban strands nobody.
    honeypot.endCase(message.guildId, message.author.id, started.caseId);
    // At warn: with no log channel, this is the only trace of a spammer left in the server.
    const fields = { guildId: message.guildId, userId: message.author.id };
    ctx.logger.warn(fields, "Started no honeypot kick during shutdown");
    await deleteOnly(message, "shutting_down", ctx);
    return "handled";
  }
  await honeypot.track(runRemovalCase(message, fresh.honeypotAction, decision.memberLeft, started.caseId, ctx));
  return "handled";
}

/**
 * While the honeypot's late-message window is open for the author, deletes their message on arrival: Discord can
 * accept a message around the moment of a ban. Returns whether it took the message.
 */
export async function deleteLateMessage(message: Message<true>, ctx: BotContext): Promise<boolean> {
  const honeypot = ctx.services.honeypot;
  if (!honeypot.isWithinLateWindow(message.guildId, message.author.id)) return false;
  honeypot.markOwnDeletion(message.id);
  try {
    await message.delete();
  } catch {
    // Already gone, or DragonBot can't delete it here: nothing more to do either way.
  }
  return true;
}

/**
 * Deletes the account's messages since sinceMs that are still in DragonBot's message cache, in every text channel and
 * thread of the server, and returns how many it deleted. Discord's ban cleanup sometimes misses the newest message.
 * Never throws: a failed delete is logged and the sweep carries on.
 */
export async function sweepCachedMessages(guild: Guild, userId: string, sinceMs: number, logger: Logger): Promise<number> {
  let deleted = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased() || !("messages" in channel)) continue;
    // A partial message in the cache has no author.
    const leftovers = [
      ...channel.messages.cache
        .filter((cached) => cached.author?.id === userId && cached.createdTimestamp >= sinceMs)
        .values(),
    ];
    for (let start = 0; start < leftovers.length; start += BULK_DELETE_LIMIT) {
      const chunk = leftovers.slice(start, start + BULK_DELETE_LIMIT);
      try {
        if (chunk.length === 1) await chunk[0].delete();
        else await channel.bulkDelete(chunk.map((cached) => cached.id), true);
        deleted += chunk.length;
      } catch (err) {
        logger.warn({ err, guildId: guild.id, channelId: channel.id, userId }, "Couldn't delete honeypot leftovers");
      }
    }
  }
  return deleted;
}

/**
 * Deletes and logs the message without removing anyone. A failed member lookup and a kick held back at shutdown also
 * get a notice. When the delete fails, the texts say so, and a last notice asks a moderator to delete the message by
 * hand.
 */
async function deleteOnly(
  message: Message<true>,
  why: DeleteOnlyWhy,
  ctx: BotContext,
  lookupError?: unknown,
): Promise<void> {
  if (why === "lookup_failed") {
    // The author might be staff, so nobody is removed.
    const fields = { err: lookupError, guildId: message.guildId, userId: message.author.id };
    ctx.logger.warn(fields, "Couldn't look up a honeypot poster");
  }
  const deleteFailure = await deleteHoneypotMessage(message, ctx);
  const deleted = deleteFailure === null;
  const text = deleteOnlyText(why, deleted);
  await sendLogEntry(message, text, deleted, ctx);
  if (why === "lookup_failed") {
    const reason = cutReason(describeError(lookupError));
    const notice = `${messageFate(deleted)} Couldn't check membership (${reason}), so nobody was removed.`;
    await sendHoneypotNotice(message, notice, ctx);
  }
  // The same text as the entry: the account is still in the server.
  if (why === "shutting_down") await sendHoneypotNotice(message, text, ctx);
  if (deleteFailure !== null) await sendHoneypotNotice(message, deleteFailedText(deleteFailure), ctx);
}

/**
 * One removal case: delete the message, remove the account, then log it. It runs inside honeypot.track, so shutdown
 * waits for it, log entry and notices included. Never rejects.
 */
async function runRemovalCase(
  message: Message<true>,
  action: HoneypotAction,
  memberLeft: boolean,
  caseId: number,
  ctx: BotContext,
): Promise<void> {
  let outcome: Outcome;
  let deleteFailure: string | null;
  try {
    deleteFailure = await deleteHoneypotMessage(message, ctx);
    outcome = await removeAuthor(message, action, memberLeft, caseId, ctx);
  } finally {
    // As soon as the removal ends, so a slow log send can't hold the case open: a kicked account that rejoins and
    // posts in the honeypot meanwhile is a new case.
    ctx.services.honeypot.endCase(message.guildId, message.author.id, caseId);
  }
  // At warn when a moderator has to act: with no log channel, it's the only trace of a kicked account left banned.
  const fields = { guildId: message.guildId, userId: message.author.id, action, outcome };
  if (needsAttention(outcome)) ctx.logger.warn(fields, "Honeypot case handled");
  else ctx.logger.info(fields, "Honeypot case handled");

  const deleted = deleteFailure === null;
  const text = outcomeText(outcome, deleted);
  await sendLogEntry(message, text, deleted, ctx);
  if (needsAttention(outcome)) await sendHoneypotNotice(message, text, ctx);
  // Sent even after a ban, whose cleanup usually takes the message: Discord's cleanup can miss the newest message, and
  // the leftover sweep fails the same way when DragonBot can't delete there.
  if (deleteFailure !== null) await sendHoneypotNotice(message, deleteFailedText(deleteFailure), ctx);
}

/**
 * Bans the author, which cleans up their last hour of messages. In kick mode the ban is lifted straight away.
 * Every path after a successful recordAction confirms or drops the record.
 */
async function removeAuthor(
  message: Message<true>,
  action: HoneypotAction,
  memberLeft: boolean,
  caseId: number,
  ctx: BotContext,
): Promise<Outcome> {
  const { guild } = message;
  const userId = message.author.id;

  if (action === "kick") {
    // Banned already, for example by a moderator or ban sync moments before: the unban would lift their ban.
    const existing = await checkBan(guild, userId);
    if (existing.kind === "banned") return { kind: "already_banned" };
    if (existing.kind === "unknown") {
      return { kind: "failed", reason: `couldn't check whether they were already banned (${existing.reason})` };
    }
  }

  const reason = removalReason(action, message.channel.name, message.id);
  const recorded = ctx.services.honeypot.recordAction(
    guild.id,
    userId,
    caseId,
    { action, reason, channelId: message.channelId },
    { memberLeft },
  );
  // The case timed out while the delete or the ban check waited.
  if (!recorded) return { kind: "failed", reason: "the case timed out" };

  const ban = await banAuthor(guild, userId, reason, caseId, ctx);
  if (ban.kind === "failed") return { kind: "failed", reason: ban.reason };
  // Straight after the ban, so a slow unban can't push the sweep past the action record, where its deletes would reach
  // the ordinary delete log. Not after an uncertain ban: the account may still be a member.
  if (ban.kind === "confirmed") scheduleSweep(guild, userId, ctx.logger);
  const unbanFailure = action === "kick" ? await liftKickBan(guild, userId) : null;

  if (unbanFailure !== null) return { kind: "still_banned", reason: unbanFailure };
  if (ban.kind === "uncertain") return { kind: "unconfirmed", reason: ban.reason };
  return { kind: "removed", action, memberLeft };
}

/** Bans the author and confirms or drops the case's action record to match what happened. */
async function banAuthor(guild: Guild, userId: string, reason: string, caseId: number, ctx: BotContext): Promise<BanResult> {
  const honeypot = ctx.services.honeypot;
  try {
    await guild.members.ban(userId, { deleteMessageSeconds: CLEANUP_SECONDS, reason });
  } catch (err) {
    // Discord refused it: role order, a missing permission, a 2FA requirement or the non-member ban cap.
    if (err instanceof DiscordAPIError && err.status >= 400 && err.status < 500) {
      honeypot.dropAction(guild.id, userId, caseId);
      return { kind: "failed", reason: describeError(err) };
    }
    // A timeout or a server error: the ban may still have happened.
    const after = await checkBan(guild, userId);
    if (after.kind === "not_banned") {
      honeypot.dropAction(guild.id, userId, caseId);
      return { kind: "failed", reason: describeError(err) };
    }
    if (after.kind === "unknown") {
      // Nobody can tell. A short record still keeps a late ban event out of ban sync, and no late window opens.
      honeypot.confirmAction(guild.id, userId, caseId, { uncertain: true });
      return { kind: "uncertain", reason: describeError(err) };
    }
    // The ban is there: carry on as if the call had resolved.
  }
  honeypot.confirmAction(guild.id, userId, caseId);
  return { kind: "confirmed" };
}

/** Whether the user is banned, read from Discord rather than the cache. Unknown Ban means not banned. */
async function checkBan(guild: Guild, userId: string): Promise<BanCheck> {
  try {
    await guild.bans.fetch({ user: userId, force: true, cache: false });
    return { kind: "banned" };
  } catch (err) {
    if (hasErrorCode(err, RESTJSONErrorCodes.UnknownBan)) return { kind: "not_banned" };
    return { kind: "unknown", reason: describeError(err) };
  }
}

/** Lifts a kick's ban, trying twice. Unknown Ban means there's nothing to lift. Returns why it failed, or null. */
async function liftKickBan(guild: Guild, userId: string): Promise<string | null> {
  let failure = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await guild.bans.remove(userId, UNBAN_REASON);
      return null;
    } catch (err) {
      if (hasErrorCode(err, RESTJSONErrorCodes.UnknownBan)) return null;
      failure = describeError(err);
    }
  }
  return failure;
}

/** Sweeps the account's leftovers from DragonBot's message cache about 15 seconds after the removal. */
function scheduleSweep(guild: Guild, userId: string, logger: Logger): void {
  const sinceMs = Date.now() - CLEANUP_SECONDS * 1000;
  setTimeout(() => {
    sweepCachedMessages(guild, userId, sinceMs, logger).catch((err: unknown) => {
      logger.warn({ err, guildId: guild.id, userId }, "Honeypot leftover sweep failed");
    });
  }, SWEEP_DELAY_MS).unref();
}

/**
 * Deletes a honeypot message, marked first as DragonBot's own deletion so the delete log skips it. Never throws.
 * Returns why the delete failed, or null when the message is gone.
 */
async function deleteHoneypotMessage(message: Message<true>, ctx: BotContext): Promise<string | null> {
  ctx.services.honeypot.markOwnDeletion(message.id);
  try {
    await message.delete();
  } catch (err) {
    // Unknown Message: already gone, for example deleted by the ban's cleanup.
    if (hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage)) return null;
    ctx.logger.warn({ err, guildId: message.guildId, messageId: message.id }, "Couldn't delete a honeypot message");
    return describeError(err);
  }
  return null;
}

/**
 * The Honeypot Action field of a removal case's log entry, which notices repeat. It never claims a delete that failed.
 * The removed, unconfirmed and still-banned texts say nothing about the message: a ban's cleanup usually takes it.
 */
function outcomeText(outcome: Outcome, deleted: boolean): string {
  switch (outcome.kind) {
    case "removed": {
      const done = outcome.action === "ban" ? "Banned." : "Kicked.";
      return outcome.memberLeft
        ? `${done} They had already left; only what DragonBot saw was cleaned up.`
        : `${done} Their messages from the last hour were cleaned up.`;
    }
    case "already_banned":
      return `Already banned. ${messageFate(deleted)}`;
    case "failed":
      return `Removal failed: ${cutReason(outcome.reason)}. ${messageFate(deleted)}`;
    case "unconfirmed":
      return `Removal unconfirmed: ${cutReason(outcome.reason)}. Check the ban list.`;
    case "still_banned":
      return `Kicked, but the unban failed: ${cutReason(outcome.reason)}. They are still banned and need a manual unban.`;
  }
}

/** The Honeypot Action field for a message deleted without removing anyone. It never claims a delete that failed. */
function deleteOnlyText(why: DeleteOnlyWhy, deleted: boolean): string {
  switch (why) {
    case "verified":
      return deleted
        ? "Message deleted only (verified member)."
        : "Couldn't delete the message. Nobody was removed (verified member).";
    case "lookup_failed":
      return `${messageFate(deleted)} Couldn't check membership, so nobody was removed.`;
    case "shutting_down":
      return `${messageFate(deleted)} DragonBot was shutting down, so nobody was removed.`;
  }
}

/** What became of the honeypot message, in the texts that mention it. */
function messageFate(deleted: boolean): string {
  return deleted ? "Message deleted only." : "Couldn't delete the message.";
}

/** The notice for a honeypot message DragonBot couldn't delete. */
function deleteFailedText(reason: string): string {
  return `Couldn't delete the message: ${cutReason(reason)}. Delete it by hand if it's still there.`;
}

/**
 * The deleted-message log entry, sent only when the server logs deleted messages. When the delete failed, its title
 * says so. Never throws.
 */
async function sendLogEntry(
  message: Message<true>,
  actionText: string,
  deleted: boolean,
  ctx: BotContext,
): Promise<void> {
  try {
    if (!(await ctx.services.logging.shouldLog(message.guildId, "message_delete"))) return;
    const embed = buildMessageDeletedEmbed(message, {
      title: deleted ? "Message Deleted (Honeypot)" : "Honeypot Message (Delete Failed)",
      extraFields: [{ name: "Honeypot Action", value: actionText }],
    });
    await ctx.services.logging.sendLogEmbed(message.guildId, embed, message.client, ctx.logger);
  } catch (err) {
    ctx.logger.warn({ err, guildId: message.guildId }, "Couldn't send the honeypot log entry");
  }
}

/** A notice in the log channel, whatever the server's log event settings. Never throws. */
async function sendHoneypotNotice(message: Message<true>, text: string, ctx: BotContext): Promise<void> {
  const userId = message.author.id;
  const description = `<@${userId}> (${userId}) posted in the honeypot <#${message.channelId}>. ${text}`;
  try {
    await ctx.services.logging.sendNotice(message.guildId, description, message.client, ctx.logger);
  } catch (err) {
    ctx.logger.warn({ err, guildId: message.guildId }, "Couldn't send a honeypot notice");
  }
}
