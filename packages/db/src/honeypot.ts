export const HONEYPOT_ACTIONS = ["kick", "ban"] as const;

export type HoneypotAction = (typeof HONEYPOT_ACTIONS)[number];

/** Guild channel settings the honeypot channel must not share, with the label used in error messages. */
export const HONEYPOT_CONFLICT_FIELDS = {
  welcomeChannelId: "welcome",
  logChannelId: "log",
  introChannelId: "intro",
  modNotesChannelId: "mod notes",
  xpLevelupChannelId: "level-up",
  birthdayChannelId: "birthday",
} as const;

type HoneypotConflictField = keyof typeof HONEYPOT_CONFLICT_FIELDS;

/**
 * Returns the label of the first channel setting that equals the honeypot channel,
 * or null when the honeypot channel is unset or shared with nothing.
 */
export function findHoneypotChannelConflict(
  settings: { honeypotChannelId: string | null } & Partial<Record<HoneypotConflictField, string | null>>,
): string | null {
  const { honeypotChannelId } = settings;
  if (!honeypotChannelId) return null;
  for (const field of Object.keys(HONEYPOT_CONFLICT_FIELDS) as HoneypotConflictField[]) {
    if (settings[field] === honeypotChannelId) return HONEYPOT_CONFLICT_FIELDS[field];
  }
  return null;
}

/** How closely copies must match for the repeated-message check: word for word (case-sensitive), word for word ignoring case, or too similar. */
export const REPEAT_SPAM_MATCH_MODES = ["exact", "ignore_case", "similar"] as const;

export type RepeatSpamMatchMode = (typeof REPEAT_SPAM_MATCH_MODES)[number];

/** Range and default for how many different channels the same message must reach before the account is kicked. */
export const REPEAT_SPAM_MIN_CHANNELS = 2;
export const REPEAT_SPAM_MAX_CHANNELS = 10;
export const REPEAT_SPAM_DEFAULT_CHANNELS = 3;

/** True when the repeated-message check is on, with a known matching level and a whole channel count in range. */
export function isRepeatSpamArmed(settings: {
  isRepeatSpamEnabled: boolean;
  repeatSpamChannelCount: number;
  repeatSpamMatchMode: string;
}): boolean {
  const { isRepeatSpamEnabled, repeatSpamChannelCount, repeatSpamMatchMode } = settings;
  return (
    isRepeatSpamEnabled &&
    (REPEAT_SPAM_MATCH_MODES as readonly string[]).includes(repeatSpamMatchMode) &&
    Number.isInteger(repeatSpamChannelCount) &&
    repeatSpamChannelCount >= REPEAT_SPAM_MIN_CHANNELS &&
    repeatSpamChannelCount <= REPEAT_SPAM_MAX_CHANNELS
  );
}
