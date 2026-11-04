// Types the server settings page and its components share. Type-only: nothing here
// reaches the browser bundle.

/**
 * Guild settings as the dashboard GET /api/server/[guildId] returns them.
 * Written out by hand: GuildRow (@dragonbot/db/schema) has more columns (id, the bot-managed
 * honeypot warning IDs, lastBirthdayCheckDate, isYoutubeEnabled, timestamps), so it is not identical.
 */
export interface GuildSettings {
  guildId: string;
  guildName: string | null;
  verificationRoleId: string | null;
  isVerificationSyncEnabled: boolean;
  isBanSyncEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
  isWelcomeEnabled: boolean;
  dmWelcomeMessage: string | null;
  isDmWelcomeEnabled: boolean;
  logChannelId: string | null;
  isLoggingEnabled: boolean;
  logEvents: string[];
  introChannelId: string | null;
  introRoleId: string | null;
  isIntroGateEnabled: boolean;
  introMinChars: number;
  introMinWords: number;
  introMinSubstantiveWords: number;
  introUniqueWordRatio: number;
  introMaxRepeatedCharPct: number;
  modNotesChannelId: string | null;
  isHoneypotEnabled: boolean;
  honeypotChannelId: string | null;
  honeypotAction: "kick" | "ban";
  isRepeatSpamEnabled: boolean;
  repeatSpamChannelCount: number;
  repeatSpamMatchMode: "exact" | "ignore_case" | "similar";
  isSuggestionsEnabled: boolean;
  isAskEnabled: boolean;
  askSystemPrompt: string | null;
  offtopicImages: string[];
  offtopicMessage: string | null;
  isXpEnabled: boolean;
  xpMin: number;
  xpMax: number;
  xpCooldownSeconds: number;
  xpLevelupChannelId: string | null;
  xpExcludedChannelIds: string[];
  xpExcludedRoleIds: string[];
  isBirthdayEnabled: boolean;
  birthdayChannelId: string | null;
  birthdayRoleId: string | null;
  birthdayMessage: string | null;
  birthdayTimezone: string;
}

/** A channel as GET /api/server/[guildId]/discord returns it. The one client-side channel type (settings, schedules and YouTube pages). */
export interface DiscordChannel {
  id: string;
  name: string;
  type: string;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: string;
}
