import type { Logger } from "pino";
import { UUID_RE } from "@dragonbot/db";
import type { XpService } from "./xp.service.js";
import type {
  XpArchiveRepository,
  XpArchiveRow,
  XpArchiveSnapshotEntry,
} from "../repositories/xp-archive.repository.js";

/** Outcome of `resetAll`. The command turns each kind into its reply. */
export type XpResetAllResult =
  | { kind: "flush-failed" }
  | { kind: "empty" }
  | { kind: "unavailable" }
  | { kind: "ok"; archiveId: string; userCount: number; totalXpSum: number };

/** Outcome of `restore`. The command turns each kind into its reply. */
export type XpRestoreResult =
  | { kind: "unavailable" }
  | { kind: "invalid-id" }
  | { kind: "not-found" }
  | { kind: "not-array" }
  | { kind: "invalid-entry" }
  | { kind: "ok"; restored: number; archiveTotalXpSum: number };

/**
 * The XP archive workflows behind /xp-admin reset-all, restore and archives: flush, snapshot, archive, zero or
 * rehydrate, flush. The archive repository is optional (as it was on BotContext): without it each workflow reports
 * "unavailable" at the same step the command used to. Errors other than the caught flushes propagate to the caller.
 * Callers pass their own logger, so log lines keep the command's bindings.
 */
export class XpArchiveService {
  constructor(
    private xp: XpService,
    private repo?: XpArchiveRepository,
  ) {}

  /** Whether archives can be read and written. */
  get available(): boolean {
    return this.repo !== undefined;
  }

  /**
   * Archive the server's XP, then zero it. Steps: flush (a failure aborts), snapshot (nothing to archive stops),
   * check the archive system, write the archive, zero in memory, flush again (a failure is only logged).
   */
  async resetAll(guildId: string, userId: string, reason: string | null, log: Logger): Promise<XpResetAllResult> {
    // Step 1: Flush current dirty data to ensure archive is complete
    log.info("Flushing XP before archive...");
    try {
      await this.xp.flush();
    } catch (err) {
      log.error({ err }, "Flush failed before reset — aborting");
      return { kind: "flush-failed" };
    }

    // Step 2: Snapshot current guild data
    const snapshot = this.xp.getGuildSnapshot(guildId);
    if (snapshot.length === 0) return { kind: "empty" };

    const totalXpSum = sumXp(snapshot);

    // Step 3: Archive to database
    if (!this.repo) return { kind: "unavailable" };

    const archive = await this.repo.create(guildId, userId, reason, snapshot, snapshot.length, totalXpSum);
    log.info({ archiveId: archive.id, users: snapshot.length, totalXp: totalXpSum }, "XP archived");

    // Step 4: Zero all in-memory entries
    this.xp.resetAllInMemory(guildId);

    // Step 5: Flush zeros to DB immediately (skipped without error if another flush is running)
    try {
      await this.xp.flush();
    } catch (err) {
      log.error({ err }, "Flush after reset failed — data archived but DB may be stale");
    }

    return { kind: "ok", archiveId: archive.id, userCount: snapshot.length, totalXpSum };
  }

  /**
   * Overwrite the server's XP with an archive. Steps: check the ID format, load and validate the archive, flush (not
   * caught: a failure propagates and nothing is restored), auto-archive current XP if there is any, rehydrate, flush
   * (a failure is only logged), mark the archive restored. `archiveId` should already be trimmed.
   */
  async restore(guildId: string, userId: string, archiveId: string, log: Logger): Promise<XpRestoreResult> {
    if (!this.repo) return { kind: "unavailable" };

    // Validate UUID format
    if (!UUID_RE.test(archiveId)) return { kind: "invalid-id" };

    const archive = await this.repo.findByIdAndGuild(archiveId, guildId);
    if (!archive) return { kind: "not-found" };

    // Validate archive data structure before restoring
    const parsed = parseArchiveEntries(archive.data);
    if (parsed.kind !== "ok") return parsed;
    const entries = parsed.entries;

    // Auto-archive current data before overwriting
    await this.xp.flush();
    const currentSnapshot = this.xp.getGuildSnapshot(guildId);
    if (currentSnapshot.length > 0) {
      await this.repo.create(
        guildId,
        userId,
        `Auto-archive before restore of ${archiveId.slice(0, 8)}`,
        currentSnapshot,
        currentSnapshot.length,
        sumXp(currentSnapshot),
      );
      log.info({ users: currentSnapshot.length }, "Auto-archived current XP before restore");
    }

    const restored = this.xp.rehydrateGuild(guildId, entries);

    // Flush to DB
    try {
      await this.xp.flush();
    } catch (err) {
      log.error({ err }, "Flush after restore failed — data is in memory but may not be persisted");
    }

    // Mark archive as restored
    await this.repo.markRestored(archiveId);

    log.info({ restored, archiveId }, "XP restored from archive");
    return { kind: "ok", restored, archiveTotalXpSum: archive.totalXpSum };
  }

  /** The server's 10 newest archives, newest first, or null without an archive system. */
  async listRecent(guildId: string): Promise<XpArchiveRow[] | null> {
    if (!this.repo) return null;
    return this.repo.findByGuild(guildId, 10);
  }
}

function sumXp(entries: XpArchiveSnapshotEntry[]): number {
  return entries.reduce((sum, e) => sum + e.totalXp, 0);
}

/**
 * Archive data as snapshot entries. It must be an array, and every item an object whose discordId is a string and
 * whose five counters are numbers (typeof only, so NaN passes). The first bad item fails the whole archive.
 */
function parseArchiveEntries(
  raw: unknown,
): { kind: "ok"; entries: XpArchiveSnapshotEntry[] } | { kind: "not-array" } | { kind: "invalid-entry" } {
  if (!Array.isArray(raw)) return { kind: "not-array" };
  const entries: XpArchiveSnapshotEntry[] = [];
  for (const item of raw) {
    if (
      typeof item !== "object" || item === null ||
      typeof (item as Record<string, unknown>).discordId !== "string" ||
      typeof (item as Record<string, unknown>).totalXp !== "number" ||
      typeof (item as Record<string, unknown>).level !== "number" ||
      typeof (item as Record<string, unknown>).messageCount !== "number" ||
      typeof (item as Record<string, unknown>).xpMessageCount !== "number" ||
      typeof (item as Record<string, unknown>).lastMessageAt !== "number"
    ) {
      return { kind: "invalid-entry" };
    }
    entries.push(item as XpArchiveSnapshotEntry);
  }
  return { kind: "ok", entries };
}
