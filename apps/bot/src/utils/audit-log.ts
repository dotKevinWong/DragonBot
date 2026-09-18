import { AuditLogEvent, type Guild, type GuildBan } from "discord.js";

/** Entries older than this belong to an earlier action, not the one being handled. */
const MAX_ENTRY_AGE_MS = 5000;

/** Scan several entries so back-to-back kicks/bans still match the right user. */
const ENTRY_SCAN_LIMIT = 10;

/**
 * Finds the audit log entry for a kick or ban that just happened to `targetId`.
 * Returns null if there isn't one or the bot lacks the View Audit Log permission.
 */
export async function findRecentAuditLogEntry(
  guild: Guild,
  type: AuditLogEvent.MemberKick | AuditLogEvent.MemberBanAdd,
  targetId: string,
) {
  try {
    const auditLogs = await guild.fetchAuditLogs({ type, limit: ENTRY_SCAN_LIMIT });
    const entry = auditLogs.entries.find(
      (e) => e.targetId === targetId && Date.now() - e.createdTimestamp < MAX_ENTRY_AGE_MS,
    );
    return entry ?? null;
  } catch {
    // May not have audit log permissions
    return null;
  }
}

/**
 * Resolves the reason for a ban. The guildBanAdd gateway event doesn't include
 * one, so fetch the ban from the API, falling back to the audit log if the ban
 * is already gone (e.g. a softban).
 *
 * Always fetches, and skips the cache: a cached ban can hold a stale reason
 * from an earlier ban of the same user if its unban event was missed.
 */
export async function resolveBanReason(ban: GuildBan): Promise<string | null> {
  try {
    const fetched = await ban.guild.bans.fetch({ user: ban.user, force: true, cache: false });
    return normalizeReason(fetched.reason);
  } catch {
    const entry = await findRecentAuditLogEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    return normalizeReason(entry?.reason);
  }
}

/** Discord rejects blank embed field values, so treat blank reasons as missing. */
export function normalizeReason(reason: string | null | undefined): string | null {
  return reason?.trim() || null;
}
