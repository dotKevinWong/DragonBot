import cron, { type ScheduledTask } from "node-cron";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import type { Logger } from "pino";
import type { ScheduledMessageService } from "../services/scheduled-message.service.js";

interface ScheduledMessageRow {
  id: string;
  guildId: string;
  channelId: string;
  message: string;
  cronExpression: string;
  timezone: string;
  isEnabled: boolean;
  isEmbed: boolean;
  embedColor: string | null;
  embedTitle: string | null;
  updatedAt: Date;
}

interface TrackedJob {
  task: ScheduledTask;
  schedule: ScheduledMessageRow; // cached content — no DB read on each fire
}

export class SchedulerManager {
  private jobs = new Map<string, TrackedJob>();

  constructor(
    private client: Client,
    private service: ScheduledMessageService,
    private logger: Logger,
  ) {}

  /** Load all enabled schedules on startup. Sync is triggered externally (e.g., by XP flush). */
  async loadAll(): Promise<void> {
    await this.reload();
  }

  /** Full reload: sync in-memory jobs with the database. Called on startup and via /schedule reload */
  async reload(): Promise<void> {
    const dbSchedules = await this.service.getAllEnabled();
    const dbIds = new Set(dbSchedules.map((s) => s.id));

    // Remove jobs that no longer exist or are disabled
    for (const [id] of this.jobs) {
      if (!dbIds.has(id)) {
        this.removeJob(id);
      }
    }

    // Add or update jobs
    let added = 0;
    let updated = 0;
    for (const schedule of dbSchedules) {
      const existing = this.jobs.get(schedule.id);

      if (!existing) {
        this.addJob(schedule);
        added++;
      } else if (
        existing.schedule.cronExpression !== schedule.cronExpression ||
        existing.schedule.timezone !== schedule.timezone ||
        existing.schedule.updatedAt.getTime() !== schedule.updatedAt.getTime()
      ) {
        this.addJob(schedule);
        updated++;
      }
    }

    this.logger.info({ added, updated, total: this.jobs.size }, "Schedules synced");
  }

  /** Register a cron job for a scheduled message */
  addJob(schedule: ScheduledMessageRow): void {
    this.removeJob(schedule.id);

    if (!cron.validate(schedule.cronExpression)) {
      this.logger.warn({ scheduleId: schedule.id, cron: schedule.cronExpression }, "Invalid cron expression");
      return;
    }

    const task = cron.schedule(schedule.cronExpression, async () => {
      // Use cached schedule data — no DB read on each fire.
      // Cache is refreshed on reload() (daily sync) and reloadJob() (after admin edits).
      const cached = this.jobs.get(schedule.id);
      if (cached && cached.schedule.isEnabled) {
        await this.executeJob(cached.schedule);
      }
    }, {
      timezone: schedule.timezone,
    });

    this.jobs.set(schedule.id, {
      task,
      schedule,
    });
  }

  /** Remove a cron job */
  removeJob(scheduleId: string): void {
    const existing = this.jobs.get(scheduleId);
    if (existing) {
      existing.task.stop();
      this.jobs.delete(scheduleId);
    }
  }

  /** Reload a single job from DB (after update via bot command) */
  async reloadJob(scheduleId: string): Promise<void> {
    this.removeJob(scheduleId);
    const schedule = await this.service.getById(scheduleId);
    if (schedule && schedule.isEnabled) {
      this.addJob(schedule);
    }
  }

  /** Stop all jobs */
  stopAll(): void {
    for (const [, job] of this.jobs) {
      job.task.stop();
    }
    this.jobs.clear();
    this.logger.info("All scheduled messages stopped");
  }

  /** Execute a scheduled message — send to the channel */
  private async executeJob(schedule: ScheduledMessageRow): Promise<void> {
    const log = this.logger.child({ scheduleId: schedule.id, guildId: schedule.guildId });

    try {
      const channel = await this.client.channels.fetch(schedule.channelId);
      if (!channel || !channel.isTextBased()) {
        log.warn("Channel not found or not text-based");
        return;
      }

      const textChannel = channel as TextChannel;

      if (schedule.isEmbed) {
        const embed = new EmbedBuilder().setDescription(schedule.message);
        if (schedule.embedTitle) embed.setTitle(schedule.embedTitle);
        embed.setColor(schedule.embedColor ? parseInt(schedule.embedColor.replace("#", ""), 16) : 0x5865f2);
        await textChannel.send({ embeds: [embed] });
      } else {
        await textChannel.send(schedule.message);
      }

      // Fire-and-forget lastRun update — don't block message sending on DB write
      const now = new Date();
      this.service.updateLastRun(schedule.id, now, null).catch((err) => {
        log.warn({ err }, "Failed to update lastRun timestamp");
      });
      log.info("Scheduled message sent");
    } catch (err) {
      log.error({ err }, "Failed to send scheduled message");
    }
  }

  /** Send a scheduled message immediately (for testing/preview) */
  async testJob(scheduleId: string, guildId: string): Promise<boolean> {
    // Use cached data if available, fall back to DB for uncached/disabled jobs
    const cached = this.jobs.get(scheduleId);
    if (cached && cached.schedule.guildId === guildId) {
      await this.executeJob(cached.schedule);
      return true;
    }
    const schedule = await this.service.getById(scheduleId);
    if (!schedule || schedule.guildId !== guildId) return false;
    await this.executeJob(schedule);
    return true;
  }

  get activeJobCount(): number {
    return this.jobs.size;
  }
}
