export const PERMISSION_SCOPES = [
  "verification",
  "welcome",
  "logging",
  "intro_gate",
  "moderation",
  "suggestions",
  "ai",
  "offtopic",
  "xp",
  "schedules",
  "birthday",
  "youtube",
  "managers",
  "*",
] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** Maps bot /admin subcommand names → required permission scope */
export const SUBCOMMAND_SCOPE_MAP: Record<string, PermissionScope> = {
  "verification-role": "verification",
  "verification-sync": "verification",
  "ban-sync": "moderation",
  "welcome-message-toggle": "welcome",
  "welcome-message": "welcome",
  "welcome-message-channel": "welcome",
  "dm-message-toggle": "welcome",
  "dm-message": "welcome",
  "log-channel": "logging",
  "log-toggle": "logging",
  "log-events": "logging",
  "intro-channel": "intro_gate",
  "intro-role": "intro_gate",
  "intro-toggle": "intro_gate",
  "mod-notes-channel": "moderation",
  "offtopic-message": "offtopic",
  "ask-toggle": "ai",
  // view-settings: any permission grants read access (handled specially)
  // managers-*: requires "managers" scope (handled specially)
};

/** Maps guild settings field names → required permission scope (for web PATCH validation) */
export const FIELD_SCOPE_MAP: Record<string, PermissionScope> = {
  // Verification
  verificationRoleId: "verification",
  isVerificationSyncEnabled: "verification",
  // Moderation
  isBanSyncEnabled: "moderation",
  modNotesChannelId: "moderation",
  // Welcome
  welcomeChannelId: "welcome",
  welcomeMessage: "welcome",
  isWelcomeEnabled: "welcome",
  dmWelcomeMessage: "welcome",
  isDmWelcomeEnabled: "welcome",
  // Logging
  logChannelId: "logging",
  isLoggingEnabled: "logging",
  logEvents: "logging",
  // Intro Gate
  introChannelId: "intro_gate",
  introRoleId: "intro_gate",
  isIntroGateEnabled: "intro_gate",
  introMinChars: "intro_gate",
  introMinWords: "intro_gate",
  introMinSubstantiveWords: "intro_gate",
  introUniqueWordRatio: "intro_gate",
  introMaxRepeatedCharPct: "intro_gate",
  // Suggestions
  isSuggestionsEnabled: "suggestions",
  // AI
  isAskEnabled: "ai",
  askSystemPrompt: "ai",
  // Off-Topic
  offtopicImages: "offtopic",
  offtopicMessage: "offtopic",
  // XP / Leveling
  isXpEnabled: "xp",
  xpMin: "xp",
  xpMax: "xp",
  xpCooldownSeconds: "xp",
  xpLevelupChannelId: "xp",
  xpExcludedChannelIds: "xp",
  xpExcludedRoleIds: "xp",
  // Birthdays
  isBirthdayEnabled: "birthday",
  birthdayChannelId: "birthday",
  birthdayRoleId: "birthday",
  birthdayMessage: "birthday",
  birthdayTimezone: "birthday",
  // YouTube
  isYoutubeEnabled: "youtube",
};
