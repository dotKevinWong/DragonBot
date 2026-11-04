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

/** Maps guild settings field names → required permission scope (for web PATCH validation) */
export const FIELD_SCOPE_MAP: Record<string, PermissionScope> = {
  // Verification
  verificationRoleId: "verification",
  isVerificationSyncEnabled: "verification",
  // Moderation
  isBanSyncEnabled: "moderation",
  modNotesChannelId: "moderation",
  // Honeypot: full access only (Manage Server or the "*" grant), because these decide who gets kicked or banned
  isHoneypotEnabled: "*",
  honeypotChannelId: "*",
  honeypotAction: "*",
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

/**
 * Whether a list of granted scopes allows `scope`.
 * An empty grant list allows nothing. A "*" grant allows everything.
 * With no scope (or an empty one) any non-empty grant allows it: that is read access.
 * Otherwise the exact scope must be granted (case-sensitive).
 */
export function grantsScope(grants: readonly string[], scope?: string): boolean {
  if (grants.length === 0) return false;
  if (grants.includes("*")) return true;
  if (!scope) return true;
  return grants.includes(scope);
}

/**
 * The scopes the settings fields need, mapped through FIELD_SCOPE_MAP.
 * Unmapped fields are dropped; each scope appears once, in first-seen order.
 */
export function requiredScopesForFields(fields: Iterable<string>): string[] {
  const requiredScopes = new Set<string>();
  for (const field of fields) {
    const scope = FIELD_SCOPE_MAP[field];
    if (scope) {
      requiredScopes.add(scope);
    }
  }
  return [...requiredScopes];
}

/**
 * The required scopes the caller lacks, in the order given.
 * A "*" grant lacks nothing. Otherwise a required "*" is reported as "*".
 */
export function missingScopes(required: Iterable<string>, grants: readonly string[]): string[] {
  if (grants.includes("*")) return [];
  return [...required].filter((scope) => !grants.includes(scope));
}
