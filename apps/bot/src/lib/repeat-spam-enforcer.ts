import { RESTJSONErrorCodes, type Guild, type Message } from "discord.js";
import { isRepeatSpamArmed, type GuildRow } from "@dragonbot/db";
import { decideHoneypot, isRealPost, repeatRemovalReason } from "../services/honeypot.service.js";
import { compareKey, type CompareKey, type RepeatTrigger, type TrackedCopy } from "../services/repeat-spam.service.js";
import type { BotContext } from "../types/context.js";
import { buildRepeatSpamEmbed } from "../utils/message-log.js";
import {
  STAFF_PERMISSIONS,
  cutReason,
  describeError,
  hasErrorCode,
  isVerified,
  lookUpAuthor,
  memberStatus,
  needsAttention,
  outcomeText,
  removeAccount,
  sendHoneypotNotice,
  type Outcome,
} from "./honeypot-removal.js";

/** The Honeypot Action field and notice for a case that arrived once shutdown had begun. */
const SHUTDOWN_TEXT = "DragonBot was shutting down, so nobody was removed.";

/**
 * The repeated-message check, after the channel trap and before the intro gate and XP. An ordinary account that posts
 * the same message in enough different channels within the window is kicked through the trap's kick path, in a case
 * shared with the trap. Staff, verified members and authors DragonBot can't look up are left alone. Below the
 * threshold it makes no Discord or database call. "handled" means the message belongs to a case, so it gets no further
 * processing and earns no XP.
 */
export async function handleRepeatSpamMessage(
  message: Message<true>,
  settings: GuildRow,
  ctx: BotContext,
): Promise<"not_caught" | "handled"> {
  if (!isRepeatSpamArmed(settings)) return "not_caught";
  if (!isRealPost({ system: message.system, webhookId: message.webhookId, authorIsBot: message.author.bot })) {
    return "not_caught";
  }
  // When the gateway sent the member, staff and verified members are known without a call.
  const gatewayMember = message.member;
  if (
    gatewayMember &&
    (gatewayMember.permissions.any(STAFF_PERMISSIONS) || isVerified(gatewayMember, settings.verificationRoleId))
  ) {
    return "not_caught";
  }
  const key = compareKey(message.content, settings.repeatSpamMatchMode);
  if (key === null) return "not_caught";

  const { guildId } = message;
  const userId = message.author.id;
  const repeatSpam = ctx.services.repeatSpam;
  if (repeatSpam.isCopyOfOpenCase(guildId, userId, key)) {
    await deleteQuietly(message, ctx);
    return "handled";
  }
  const copy: TrackedCopy = { channelId: message.channelId, messageId: message.id };
  const trigger = repeatSpam.track(guildId, userId, copy, key, settings.repeatSpamChannelCount, Date.now());
  if (trigger === null) return "not_caught";

  const honeypot = ctx.services.honeypot;
  // Noted on arrival, as the channel trap does: a copy that arrived before the drain began is handled in full.
  const closingOnArrival = honeypot.isClosing;
  // Shutdown waits for the lookup and the settings re-read too, not only the removal.
  return honeypot.track(handleTriggered(message, settings, key, trigger, closingOnArrival, ctx));
}

/** The rest of handleRepeatSpamMessage, once a copy brings the account's copies to the cached channel count. */
async function handleTriggered(
  message: Message<true>,
  settings: GuildRow,
  key: CompareKey,
  trigger: RepeatTrigger,
  closingOnArrival: boolean,
  ctx: BotContext,
): Promise<"not_caught" | "handled"> {
  const { guildId } = message;
  const userId = message.author.id;
  const repeatSpam = ctx.services.repeatSpam;

  // Each of these forgets the account's copies, so later copies in the wave must reach the count again before the
  // next lookup.
  const author = await lookUpAuthor(message);
  const decision = decideHoneypot(memberStatus(author, settings.verificationRoleId));
  if (decision.type !== "remove") {
    if (author.kind === "lookup_failed") {
      // The author might be staff, so nobody is removed.
      ctx.logger.warn({ err: author.err, guildId, userId }, "Couldn't look up a repeated-message poster");
    }
    repeatSpam.forget(guildId, userId);
    return "not_caught";
  }

  // Re-read before removing anyone: the dashboard's reload ping can be lost, leaving the cache stale. That read
  // refreshes the cache, so later copies are judged by the fresh row and the account's copies are kept.
  const fresh = await ctx.services.guild.getSettingsFresh(guildId);
  if (
    !fresh ||
    !isRepeatSpamArmed(fresh) ||
    fresh.repeatSpamMatchMode !== settings.repeatSpamMatchMode ||
    trigger.channelIds.length < fresh.repeatSpamChannelCount
  ) {
    return "not_caught";
  }
  // The cached row can predate a change to the verification role.
  if (author.kind === "member" && isVerified(author.member, fresh.verificationRoleId)) {
    repeatSpam.forget(guildId, userId);
    return "not_caught";
  }

  const honeypot = ctx.services.honeypot;
  const started = honeypot.beginCase(guildId, userId, message.createdTimestamp);
  if (started.kind === "same_case") {
    // The account's case is already being handled, by this check or the channel trap: only the message goes. Its
    // copies are forgotten too, so further copies must reach the count again before the next lookup and re-read.
    repeatSpam.forget(guildId, userId);
    await deleteQuietly(message, ctx);
    return "handled";
  }
  repeatSpam.forget(guildId, userId);
  repeatSpam.openCase(guildId, userId, started.caseId, key);

  if (closingOnArrival) {
    // The drain's cap or destroy() could cut a new kick off between its ban and its unban, leaving the account
    // banned, so none starts. Nothing is deleted either: the copies stay for a moderator to judge.
    honeypot.endCase(guildId, userId, started.caseId);
    repeatSpam.closeCase(guildId, userId, started.caseId);
    // At warn: with no log channel, this is the only trace of a spammer left in the server.
    ctx.logger.warn({ guildId, userId }, "Started no repeated-message kick during shutdown");
    await sendCaseEmbed(message, trigger.channelIds, SHUTDOWN_TEXT, ctx);
    const lead = repeatLead(userId, trigger.channelIds.length);
    await sendHoneypotNotice(guildId, message.client, lead, SHUTDOWN_TEXT, ctx);
    return "handled";
  }
  await honeypot.track(runRepeatCase(message, trigger, decision.memberLeft, started.caseId, ctx));
  return "handled";
}

/**
 * One repeated-message case: kick the account, delete the copies when the ban's cleanup didn't, then log it. It runs
 * inside honeypot.track, so shutdown waits for it, log entry and notices included.
 */
async function runRepeatCase(
  message: Message<true>,
  trigger: RepeatTrigger,
  memberLeft: boolean,
  caseId: number,
  ctx: BotContext,
): Promise<void> {
  const { guildId, guild } = message;
  const userId = message.author.id;
  const channelCount = trigger.channelIds.length;
  let outcome: Outcome;
  try {
    const reason = repeatRemovalReason(channelCount);
    const removal = { action: "kick" as const, reason, channelId: message.channelId, memberLeft, caseId };
    outcome = await removeAccount(guild, userId, removal, ctx);
  } finally {
    // As soon as the removal ends, so slow deletes or log sends can't hold the case open.
    ctx.services.honeypot.endCase(guildId, userId, caseId);
    ctx.services.repeatSpam.closeCase(guildId, userId, caseId);
  }

  // A confirmed ban already cleaned up the last hour of messages, copies included.
  const cleanedUp = outcome.kind === "removed" || outcome.kind === "still_banned";
  const failures = cleanedUp ? [] : await deleteCopies(guild, trigger.copies, ctx);

  // At warn when a moderator has to act: with no log channel, it's the only trace of a kicked account left banned.
  const fields = { guildId, userId, channelCount, outcome };
  if (needsAttention(outcome)) ctx.logger.warn(fields, "Repeated-message case handled");
  else ctx.logger.info(fields, "Repeated-message case handled");

  const text = outcomeText(outcome, failures.length === 0 ? "Copies deleted." : "Couldn't delete every copy.");
  await sendCaseEmbed(message, trigger.channelIds, text, ctx);
  const lead = repeatLead(userId, channelCount);
  if (needsAttention(outcome)) await sendHoneypotNotice(guildId, message.client, lead, text, ctx);
  if (failures.length > 0) {
    const notice =
      `Couldn't delete ${failures.length} of the ${trigger.copies.length} copies: ${cutReason(failures[0])}. ` +
      "Delete them by hand if they're still there.";
    await sendHoneypotNotice(guildId, message.client, lead, notice, ctx);
  }
}

/** Deletes every tracked copy, one at a time. Returns why each failed delete failed, in order. Never throws. */
async function deleteCopies(guild: Guild, copies: TrackedCopy[], ctx: BotContext): Promise<string[]> {
  const failures: string[] = [];
  for (const copy of copies) {
    const failure = await deleteCopy(guild, copy, ctx);
    if (failure === null) continue;
    const fields = { reason: failure, guildId: guild.id, channelId: copy.channelId, messageId: copy.messageId };
    ctx.logger.warn(fields, "Couldn't delete a repeated message");
    failures.push(failure);
  }
  return failures;
}

/**
 * Deletes one copy, marked first as DragonBot's own deletion so the delete log skips it. Returns why the delete failed,
 * or null when the copy is gone. Only Unknown Message and Unknown Channel mean gone; anything else is a failure, so no
 * text claims a delete that didn't happen.
 */
async function deleteCopy(guild: Guild, copy: TrackedCopy, ctx: BotContext): Promise<string | null> {
  ctx.services.honeypot.markOwnDeletion(copy.messageId);
  try {
    // Answers from the cache when it can, and fetches a thread that has dropped out of it.
    const channel = await guild.channels.fetch(copy.channelId);
    if (!channel) return "the channel wasn't found";
    if (!channel.isTextBased()) return "the channel isn't a text channel";
    await channel.messages.delete(copy.messageId);
    return null;
  } catch (err) {
    if (hasErrorCode(err, RESTJSONErrorCodes.UnknownMessage) || hasErrorCode(err, RESTJSONErrorCodes.UnknownChannel)) {
      return null;
    }
    return describeError(err);
  }
}

/** Deletes a message that belongs to an open case, marked as DragonBot's own deletion. Errors are ignored. */
async function deleteQuietly(message: Message<true>, ctx: BotContext): Promise<void> {
  ctx.services.honeypot.markOwnDeletion(message.id);
  try {
    await message.delete();
  } catch {
    // Already gone, or DragonBot can't delete it here: no log entry claims it, and a burst would flood the log.
  }
}

/** The repeated-message log entry, sent whatever the server's log event switches. Never throws. */
async function sendCaseEmbed(
  message: Message<true>,
  channelIds: string[],
  actionText: string,
  ctx: BotContext,
): Promise<void> {
  try {
    const embed = buildRepeatSpamEmbed(message, channelIds, actionText);
    await ctx.services.logging.sendHoneypotEmbed(message.guildId, embed, message.client, ctx.logger);
  } catch (err) {
    ctx.logger.warn({ err, guildId: message.guildId }, "Couldn't send the repeated-message log entry");
  }
}

/** The opening of a repeated-message notice: who posted, and that it was this check, not the channel trap. */
function repeatLead(userId: string, channelCount: number): string {
  return `<@${userId}> (${userId}) posted the same message in ${channelCount} channels (repeated-message check).`;
}
