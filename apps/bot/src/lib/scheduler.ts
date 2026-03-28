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
  updatedAt: Date;
  cronExpression: string;
  timezone: string;
}

const DAILY_SYNC_MS = 86_400_000; // 24 hours

export class SchedulerManager {
  private jobs = new Map<string, TrackedJob>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private client: Client,
    private service: ScheduledMessageService,
    private logger: Logger,
  ) {}

  /** Load all enabled schedules on startup and start hourly sync */
  async loadAll(): Promise<void> {
    await this.reload();

    // Daily background sync as a safety net
    this.syncTimer = setInterval(async () => {
      try {
        this.logger.info("Daily schedule sync running");
        await this.reload();
      } catch (err) {
        this.logger.error({ err }, "Daily schedule sync failed");
      }
    }, DAILY_SYNC_MS);
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
        existing.cronExpression !== schedule.cronExpression ||
        existing.timezone !== schedule.timezone ||
        existing.updatedAt.getTime() !== schedule.updatedAt.getTime()
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
      // Re-fetch from DB to get latest message content
      const latest = await this.service.getById(schedule.id);
      if (latest && latest.isEnabled) {
        await this.executeJob(latest);
      }
    }, {
      timezone: schedule.timezone,
    });

    this.jobs.set(schedule.id, {
      task,
      updatedAt: schedule.updatedAt,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
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

  /** Stop all jobs and timers */
  stopAll(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
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

      const now = new Date();
      await this.service.updateLastRun(schedule.id, now, null);
      log.info("Scheduled message sent");
    } catch (err) {
      log.error({ err }, "Failed to send scheduled message");
    }
  }

  /** Send a scheduled message immediately (for testing/preview) */
  async testJob(scheduleId: string, guildId: string): Promise<boolean> {
    const schedule = await this.service.getById(scheduleId);
    if (!schedule || schedule.guildId !== guildId) return false;
    await this.executeJob(schedule);
    return true;
  }

  get activeJobCount(): number {
    return this.jobs.size;
  }
}
