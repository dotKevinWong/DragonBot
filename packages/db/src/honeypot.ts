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
