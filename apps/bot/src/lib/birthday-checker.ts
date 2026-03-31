import cron, { type ScheduledTask } from "node-cron";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import type { Logger } from "pino";
import type { BirthdayService } from "../services/birthday.service.js";
import type { GuildService } from "../services/guild.service.js";

export class BirthdayChecker {
  private task: ScheduledTask | null = null;
  private lastCheckDate = new Map<string, string>(); // guildId → "M-D"

  constructor(
    private client: Client,
    private birthdayService: BirthdayService,
    private guildService: GuildService,
    private logger: Logger,
  ) {}

  /** Start the hourly birthday check cron. */
  start(): void {
    // Run at the top of every hour
    this.task = cron.schedule("0 * * * *", async () => {
      await this.check();
    });
    this.logger.info("Birthday checker started (hourly)");
  }

  /** Stop the cron job. */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  /** Run the birthday check for all enabled guilds. */
  async check(): Promise<void> {
    const log = this.logger.child({ component: "birthday-checker" });

    const allGuilds = this.guildService.getAllCached();

    for (const guild of allGuilds) {
      if (!guild.isBirthdayEnabled || !guild.birthdayChannelId) continue;

      try {
        const tz = guild.birthdayTimezone ?? "America/New_York";

        // Get current hour and date in the guild's timezone
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "numeric",
          hour12: false,
        });
        const currentHour = parseInt(formatter.format(now), 10);

        // Only announce at 9 AM in the guild's timezone
        if (currentHour !== 9) continue;

        // Get today's date in the guild's timezone
        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const dateStr = dateFormatter.format(now); // "MM/DD/YYYY"
        const [monthStr, dayStr] = dateStr.split("/");
        const month = parseInt(monthStr!, 10);
        const day = parseInt(dayStr!, 10);

        // Dedup: skip if we already checked this guild today
        const checkKey = `${month}-${day}`;
        if (this.lastCheckDate.get(guild.guildId) === checkKey) continue;
        this.lastCheckDate.set(guild.guildId, checkKey);

        // Remove yesterday's birthday role before assigning today's
        if (guild.birthdayRoleId) {
          await this.removeYesterdayRoles(guild.guildId, guild.birthdayRoleId, log);
        }

        await this.announceForGuild(
          guild.guildId,
          guild.birthdayChannelId,
          guild.birthdayRoleId ?? null,
          guild.birthdayMessage ?? null,
          month,
          day,
          log,
        );
      } catch (err) {
        log.error({ err, guildId: guild.guildId }, "Birthday check failed for guild, continuing to next");
      }
    }
  }

  /** Remove the birthday role from everyone who currently has it. */
  private async removeYesterdayRoles(guildId: string, roleId: string, log: Logger): Promise<void> {
    const guildLog = log.child({ guildId });
    try {
      const discordGuild = this.client.guilds.cache.get(guildId);
      if (!discordGuild) return;

      // Fetch members with the birthday role
      const membersWithRole = discordGuild.members.cache.filter((m) => m.roles.cache.has(roleId));
      let removed = 0;
      for (const [, member] of membersWithRole) {
        try {
          await member.roles.remove(roleId);
          removed++;
        } catch (err) {
          guildLog.warn({ err, memberId: member.id }, "Failed to remove birthday role");
        }
      }
      if (removed > 0) {
        guildLog.info({ removed }, "Removed yesterday's birthday roles");
      }
    } catch (err) {
      guildLog.error({ err }, "Failed to clean up birthday roles");
    }
  }

  private async announceForGuild(
    guildId: string,
    channelId: string,
    roleId: string | null,
    customMessage: string | null,
    month: number,
    day: number,
    log: Logger,
  ): Promise<void> {
    const guildLog = log.child({ guildId });

    try {
      // Get today's birthday users
      const birthdayUsers = await this.birthdayService.getTodaysBirthdays(month, day);
      if (birthdayUsers.length === 0) return;

      // Get the Discord guild to check membership
      const discordGuild = this.client.guilds.cache.get(guildId);
      if (!discordGuild) {
        guildLog.warn("Guild not in cache, skipping birthday check");
        return;
      }

      // Fetch members if cache is sparse
      const birthdayDiscordIds = birthdayUsers.map((b) => b.discordId);
      const members = await discordGuild.members.fetch({ user: birthdayDiscordIds }).catch(() => null);
      if (!members || members.size === 0) return;

      // Get the announcement channel
      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        guildLog.warn("Birthday channel not found or not text-based");
        return;
      }
      const textChannel = channel as TextChannel;

      // Send one announcement per birthday user
      let announced = 0;
      for (const birthday of birthdayUsers) {
        const member = members.get(birthday.discordId);
        if (!member) continue;

        // Assign birthday role
        if (roleId) {
          try {
            await member.roles.add(roleId);
          } catch (err) {
            guildLog.warn({ err, memberId: member.id }, "Failed to assign birthday role");
          }
        }

        const message = this.birthdayService.buildAnnouncementMessage(
          birthday.discordId,
          birthday.birthYear,
          customMessage,
        );

        const embed = new EmbedBuilder()
          .setDescription(message)
          .setColor(0xffd700); // Gold

        await textChannel.send({ embeds: [embed] });
        announced++;
      }

      if (announced > 0) {
        guildLog.info({ announced, month, day }, "Birthday announcements sent");
      }
    } catch (err) {
      guildLog.error({ err }, "Failed to announce birthdays for guild");
    }
  }
}
