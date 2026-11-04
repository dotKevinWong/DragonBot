import { RESTJSONErrorCodes, type Message } from "discord.js";
import { HONEYPOT_ACTIONS, findHoneypotChannelConflict, type GuildRow, type HoneypotAction } from "@dragonbot/db";
import { decideHoneypot, isRealPost, removalReason, type HoneypotDecision } from "../services/honeypot.service.js";
import type { BotContext } from "../types/context.js";
import { buildMessageDeletedEmbed } from "../utils/message-log.js";
import {
  cutReason,
  describeError,
  hasErrorCode,
  isVerified,
  lookUpAuthor,
  memberStatus,
  messageFate,
  needsAttention,
  outcomeText,
  removeAccount,
  sendHoneypotNotice,
  trapLead,
  type Outcome,
} from "./honeypot-removal.js";

/** Why a honeypot message is deleted without removing anyone: the decision, or a kick held back at shutdown. */
type DeleteOnlyWhy = Extract<HoneypotDecision, { type: "delete_only" }>["why"] | "shutting_down";

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
  const lead = trapLead(message.author.id, message.channelId);
  if (why === "lookup_failed") {
    const reason = cutReason(describeError(lookupError));
    const notice = `${messageFate(deleted)} Couldn't check membership (${reason}), so nobody was removed.`;
    await sendHoneypotNotice(message.guildId, message.client, lead, notice, ctx);
  }
  // The same text as the entry: the account is still in the server.
  if (why === "shutting_down") await sendHoneypotNotice(message.guildId, message.client, lead, text, ctx);
  if (deleteFailure !== null) {
    await sendHoneypotNotice(message.guildId, message.client, lead, deleteFailedText(deleteFailure), ctx);
  }
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
    const reason = removalReason(action, message.channel.name, message.id);
    const removal = { action, reason, channelId: message.channelId, memberLeft, caseId };
    outcome = await removeAccount(message.guild, message.author.id, removal, ctx);
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
  const text = outcomeText(outcome, messageFate(deleted));
  await sendLogEntry(message, text, deleted, ctx);
  const lead = trapLead(message.author.id, message.channelId);
  if (needsAttention(outcome)) await sendHoneypotNotice(message.guildId, message.client, lead, text, ctx);
  // Sent even after a ban, whose cleanup usually takes the message: Discord's cleanup can miss the newest message, and
  // the leftover sweep fails the same way when DragonBot can't delete there.
  if (deleteFailure !== null) {
    await sendHoneypotNotice(message.guildId, message.client, lead, deleteFailedText(deleteFailure), ctx);
  }
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
