import {
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type Guild,
  type GuildMember,
  type Message,
} from "discord.js";
import type { Logger } from "pino";
import { HONEYPOT_ACTIONS, type GuildRow, type HoneypotAction } from "@dragonbot/db";
import {
  CLEANUP_SECONDS,
  SWEEP_DELAY_MS,
  UNBAN_REASON,
  decideHoneypot,
  isRealPost,
  removalReason,
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

const VERIFIED_TEXT = "Message deleted only (verified member).";
const LOOKUP_FAILED_TEXT = "Message deleted only. Couldn't check membership, so nobody was removed.";

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

/** The honeypot is on in this channel and its warning is posted there. No warning, no enforcement. */
function isArmedIn(settings: GuildRow, channelId: string): boolean {
  return (
    settings.isHoneypotEnabled &&
    settings.honeypotChannelId === channelId &&
    settings.honeypotWarningChannelId === settings.honeypotChannelId &&
    !!settings.honeypotWarningMessageId
  );
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
 * the message, and anyone else is kicked or banned with their last hour of messages cleaned up. "handled" means the
 * message is the honeypot's, so it gets no further processing and earns no XP.
 */
export async function handleHoneypotMessage(
  message: Message<true>,
  settings: GuildRow,
  ctx: BotContext,
): Promise<"not_honeypot" | "handled"> {
  if (!isArmedIn(settings, message.channelId)) return "not_honeypot";
  // System notices (a join notice's author is the new member), webhook posts and bot posts are left alone.
  if (!isRealPost({ system: message.system, webhookId: message.webhookId, authorIsBot: message.author.bot })) {
    return "handled";
  }

  const author = await lookUpAuthor(message);
  const decision = decideHoneypot(memberStatus(author, settings.verificationRoleId));
  if (decision.type === "ignore") return "handled";
  if (decision.type === "delete_only") {
    if (author.kind === "lookup_failed") {
      // The author might be staff, so nobody is removed.
      const { err } = author;
      ctx.logger.warn({ err, guildId: message.guildId, userId: message.author.id }, "Couldn't look up a honeypot poster");
      const notice = `Message deleted only. Couldn't check membership (${cutReason(describeError(err))}), so nobody was removed.`;
      await deleteOnly(message, LOOKUP_FAILED_TEXT, ctx, notice);
    } else {
      await deleteOnly(message, VERIFIED_TEXT, ctx);
    }
    return "handled";
  }

  // Re-read before removing anyone: the dashboard's reload ping can be lost, leaving the cache stale.
  const fresh = await ctx.services.guild.getSettingsFresh(message.guildId);
  if (!fresh || !isArmedIn(fresh, message.channelId) || !HONEYPOT_ACTIONS.includes(fresh.honeypotAction)) {
    return "not_honeypot";
  }
  if (author.kind === "member" && isVerified(author.member, fresh.verificationRoleId)) {
    await deleteOnly(message, VERIFIED_TEXT, ctx);
    return "handled";
  }

  const honeypot = ctx.services.honeypot;
  const started = honeypot.beginCase(message.guildId, message.author.id, message.createdTimestamp);
  if (started.kind === "same_case") {
    // Part of a case that's already being handled: no second removal and no second log entry.
    await deleteHoneypotMessage(message, ctx);
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

/** Deletes and logs the message without removing anyone, with a notice when given one. */
async function deleteOnly(message: Message<true>, actionText: string, ctx: BotContext, notice?: string): Promise<void> {
  await deleteHoneypotMessage(message, ctx);
  await sendLogEntry(message, actionText, ctx);
  if (notice) await sendHoneypotNotice(message, notice, ctx);
}

/**
 * One removal case: delete the message, remove the account, then log it. It runs inside honeypot.track, so shutdown
 * waits for it, log entry and notice included. Never rejects.
 */
async function runRemovalCase(
  message: Message<true>,
  action: HoneypotAction,
  memberLeft: boolean,
  caseId: number,
  ctx: BotContext,
): Promise<void> {
  let outcome: Outcome;
  try {
    await deleteHoneypotMessage(message, ctx);
    outcome = await removeAuthor(message, action, memberLeft, caseId, ctx);
  } finally {
    // As soon as the removal ends, so a slow log send can't hold the case open: a kicked account that rejoins and
    // posts in the honeypot meanwhile is a new case.
    ctx.services.honeypot.endCase(message.guildId, message.author.id, caseId);
  }
  ctx.logger.info({ guildId: message.guildId, userId: message.author.id, action, outcome }, "Honeypot case handled");

  const text = outcomeText(outcome);
  await sendLogEntry(message, text, ctx);
  if (outcome.kind === "failed" || outcome.kind === "unconfirmed" || outcome.kind === "still_banned") {
    await sendHoneypotNotice(message, text, ctx);
  }
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
  const unbanFailure = action === "kick" ? await liftKickBan(guild, userId) : null;
  // Not after an uncertain ban: the account may still be a member.
  if (ban.kind === "confirmed") scheduleSweep(guild, userId, ctx.logger);

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

/** Deletes a honeypot message, marked first as DragonBot's own deletion so the delete log skips it. Never throws. */
async function deleteHoneypotMessage(message: Message<true>, ctx: BotContext): Promise<void> {
  ctx.services.honeypot.markOwnDeletion(message.id);
  try {
    await message.delete();
  } catch (err) {
    // Unknown Message: already gone, for example deleted by the ban's cleanup.
    if (!hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage)) {
      ctx.logger.warn({ err, guildId: message.guildId, messageId: message.id }, "Couldn't delete a honeypot message");
    }
  }
}

/** The Honeypot Action field of the log entry, which notices repeat. */
function outcomeText(outcome: Outcome): string {
  switch (outcome.kind) {
    case "removed": {
      const done = outcome.action === "ban" ? "Banned." : "Kicked.";
      return outcome.memberLeft
        ? `${done} They had already left; only what DragonBot saw was cleaned up.`
        : `${done} Their messages from the last hour were cleaned up.`;
    }
    case "already_banned":
      return "Already banned. Message deleted only.";
    case "failed":
      return `Removal failed: ${cutReason(outcome.reason)}. Message deleted only.`;
    case "unconfirmed":
      return `Removal unconfirmed: ${cutReason(outcome.reason)}. Check the ban list.`;
    case "still_banned":
      return `Kicked, but the unban failed: ${cutReason(outcome.reason)}. They are still banned and need a manual unban.`;
  }
}

/** The deleted-message log entry, sent only when the server logs deleted messages. Never throws. */
async function sendLogEntry(message: Message<true>, actionText: string, ctx: BotContext): Promise<void> {
  try {
    if (!(await ctx.services.logging.shouldLog(message.guildId, "message_delete"))) return;
    const embed = buildMessageDeletedEmbed(message, {
      title: "Message Deleted (Honeypot)",
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
