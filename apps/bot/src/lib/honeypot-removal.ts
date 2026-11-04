import {
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
} from "discord.js";
import type { Logger } from "pino";
import type { HoneypotAction } from "@dragonbot/db";
import { CLEANUP_SECONDS, SWEEP_DELAY_MS, UNBAN_REASON, type MemberStatus } from "../services/honeypot.service.js";
import type { BotContext } from "../types/context.js";

/** A member with any of these is staff, and the honeypot leaves them alone. Nothing else counts. */
export const STAFF_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];

/** Discord's bulk delete takes at most this many messages. */
const BULK_DELETE_LIMIT = 100;

/** A failure reason is cut to this length before it goes into a log entry or a notice. */
const MAX_REASON_LENGTH = 200;

/** The author of a honeypot message, as far as Discord could tell. */
export type Author = { kind: "member"; member: GuildMember } | { kind: "left" } | { kind: "lookup_failed"; err: unknown };

type BanCheck = { kind: "banned" } | { kind: "not_banned" } | { kind: "unknown"; reason: string };

type BanResult = { kind: "confirmed" } | { kind: "uncertain"; reason: string } | { kind: "failed"; reason: string };

/** How a removal case ended. Every outcome but "removed" and "already_banned" also goes out as a notice. */
export type Outcome =
  | { kind: "removed"; action: HoneypotAction; memberLeft: boolean }
  | { kind: "already_banned" }
  | { kind: "failed"; reason: string }
  | { kind: "unconfirmed"; reason: string }
  | { kind: "still_banned"; reason: string };

/** What one removal case does to an account, and the case it belongs to. */
export interface Removal {
  action: HoneypotAction;
  /** The audit log reason for the ban. */
  reason: string;
  /** The channel the case's message was posted in, kept in the action record. */
  channelId: string;
  memberLeft: boolean;
  caseId: number;
}

/** A moderator has to act on these outcomes, so they go out as notices, and pino logs them at warn. */
export function needsAttention(outcome: Outcome): boolean {
  return outcome.kind === "failed" || outcome.kind === "unconfirmed" || outcome.kind === "still_banned";
}

export function hasErrorCode(err: unknown, code: number): boolean {
  return err instanceof DiscordAPIError && err.code === code;
}

/** Why a Discord call failed. */
export function describeError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export function cutReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}

export function isVerified(member: GuildMember, verificationRoleId: string | null): boolean {
  return !!verificationRoleId && member.roles.cache.has(verificationRoleId);
}

/** The member from the gateway payload, fetched only when it's missing. */
export async function lookUpAuthor(message: Message<true>): Promise<Author> {
  if (message.member) return { kind: "member", member: message.member };
  try {
    return { kind: "member", member: await message.guild.members.fetch(message.author.id) };
  } catch (err) {
    if (hasErrorCode(err, RESTJSONErrorCodes.UnknownMember)) return { kind: "left" };
    return { kind: "lookup_failed", err };
  }
}

export function memberStatus(author: Author, verificationRoleId: string | null): MemberStatus {
  if (author.kind === "left") return { kind: "left" };
  if (author.kind === "lookup_failed") return { kind: "lookup_failed" };
  return {
    kind: "member",
    isStaff: author.member.permissions.any(STAFF_PERMISSIONS),
    isVerified: isVerified(author.member, verificationRoleId),
  };
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
 * Bans the account, which cleans up their last hour of messages. In kick mode the ban is lifted straight away.
 * Every path after a successful recordAction confirms or drops the record.
 */
export async function removeAccount(guild: Guild, userId: string, removal: Removal, ctx: BotContext): Promise<Outcome> {
  const { action, reason, channelId, memberLeft, caseId } = removal;

  if (action === "kick") {
    // Banned already, for example by a moderator or ban sync moments before: the unban would lift their ban.
    const existing = await checkBan(guild, userId);
    if (existing.kind === "banned") return { kind: "already_banned" };
    if (existing.kind === "unknown") {
      return { kind: "failed", reason: `couldn't check whether they were already banned (${existing.reason})` };
    }
  }

  const recorded = ctx.services.honeypot.recordAction(
    guild.id,
    userId,
    caseId,
    { action, reason, channelId },
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
 * The Honeypot Action field of a removal case's log entry, which notices repeat. `fate` says what became of the
 * message or messages, and must never claim a delete that failed. The removed, unconfirmed and still-banned texts say
 * nothing about the message: a ban's cleanup usually takes it.
 */
export function outcomeText(outcome: Outcome, fate: string): string {
  switch (outcome.kind) {
    case "removed": {
      const done = outcome.action === "ban" ? "Banned." : "Kicked.";
      return outcome.memberLeft
        ? `${done} They had already left; only what DragonBot saw was cleaned up.`
        : `${done} Their messages from the last hour were cleaned up.`;
    }
    case "already_banned":
      return `Already banned. ${fate}`;
    case "failed":
      return `Removal failed: ${cutReason(outcome.reason)}. ${fate}`;
    case "unconfirmed":
      return `Removal unconfirmed: ${cutReason(outcome.reason)}. Check the ban list.`;
    case "still_banned":
      return `Kicked, but the unban failed: ${cutReason(outcome.reason)}. They are still banned and need a manual unban.`;
  }
}

/** What became of the honeypot message, in the texts that mention it. */
export function messageFate(deleted: boolean): string {
  return deleted ? "Message deleted only." : "Couldn't delete the message.";
}

/** The opening of a channel trap notice: who posted, and where. */
export function trapLead(userId: string, channelId: string): string {
  return `<@${userId}> (${userId}) posted in the channel trap <#${channelId}>.`;
}

/** A notice in the log channel, whatever the server's log event settings. Never throws. */
export async function sendHoneypotNotice(
  guildId: string,
  client: Client,
  lead: string,
  text: string,
  ctx: BotContext,
): Promise<void> {
  try {
    await ctx.services.logging.sendNotice(guildId, `${lead} ${text}`, client, ctx.logger);
  } catch (err) {
    ctx.logger.warn({ err, guildId }, "Couldn't send a honeypot notice");
  }
}
