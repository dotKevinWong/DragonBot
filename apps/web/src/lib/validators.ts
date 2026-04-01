import { z } from "zod";

const VALID_LOG_EVENTS = [
  "member_join", "member_leave", "message_delete", "message_edit",
  "role_change", "nickname_change", "voice_activity", "kick", "ban",
] as const;

/** Validates a 5-field cron expression with proper per-field range checking */
function isValidCronField(value: string, min: number, max: number): boolean {
  if (value === "*") return true;
  if (value.startsWith("*/")) {
    const step = parseInt(value.slice(2));
    return !isNaN(step) && step >= 1 && step <= max;
  }
  const parts = value.split(",");
  return parts.every((part) => {
    // Handle range-with-step: N-M/S (e.g., 1-30/5)
    const slashParts = part.split("/");
    const rangePart = slashParts[0]!;
    const stepPart = slashParts[1];

    if (stepPart !== undefined) {
      const step = parseInt(stepPart);
      if (isNaN(step) || step < 1) return false;
      // Validate the range portion before the slash
      if (rangePart === "*") return step <= max;
    }

    const rangeParts = rangePart.split("-");
    if (rangeParts.length === 2) {
      const [start, end] = rangeParts.map(Number);
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
    }
    const num = parseInt(rangePart);
    return !isNaN(num) && num >= min && num <= max;
  });
}

export const DISCORD_SNOWFLAKE_RE = /^[0-9]{17,20}$/;

export const cronExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+$/,
    "Invalid cron expression (expected 5 fields)",
  )
  .refine(
    (expr) => {
      const [minute, hour, dom, month, dow] = expr.trim().split(/\s+/);
      return (
        isValidCronField(minute, 0, 59) &&
        isValidCronField(hour, 0, 23) &&
        isValidCronField(dom, 1, 31) &&
        isValidCronField(month, 1, 12) &&
        isValidCronField(dow, 0, 7)
      );
    },
    "Cron field values out of range (minute 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-7)",
  );

export const embedColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color (expected format: #RRGGBB)")
  .nullable()
  .optional();

export const profileUpdateSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  pronouns: z.string().trim().max(50).nullable().optional(),
  major: z.string().trim().max(100).nullable().optional(),
  college: z.string().trim().max(200).nullable().optional(),
  year: z.string().trim().max(50).nullable().optional(),
  plan: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  coop1: z.string().trim().max(200).nullable().optional(),
  coop2: z.string().trim().max(200).nullable().optional(),
  coop3: z.string().trim().max(200).nullable().optional(),
  clubs: z.array(z.string().trim().max(100)).max(20).nullable().optional(),
  isProfileDisabled: z.boolean().optional(),
  // Birthday
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
}).refine((data) => {
  // Validate birthDay against the month's max days
  if (data.birthMonth != null && data.birthDay != null) {
    const maxDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (data.birthDay > maxDays[data.birthMonth - 1]!) return false;
  }
  // If one is set, both must be set (no orphaned fields)
  if ((data.birthMonth == null) !== (data.birthDay == null)) return false;
  return true;
}, { message: "Invalid birthday: check month/day combination", path: ["birthDay"] });

const discordId = z.string().regex(/^[0-9]{17,20}$/);

export const guildSettingsUpdateSchema = z.object({
  verificationRoleId: discordId.nullable().optional(),
  isVerificationSyncEnabled: z.boolean().optional(),
  isBanSyncEnabled: z.boolean().optional(),
  welcomeChannelId: discordId.nullable().optional(),
  welcomeMessage: z.string().max(2000).nullable().optional(),
  isWelcomeEnabled: z.boolean().optional(),
  dmWelcomeMessage: z.string().max(2000).nullable().optional(),
  isDmWelcomeEnabled: z.boolean().optional(),
  logChannelId: discordId.nullable().optional(),
  isLoggingEnabled: z.boolean().optional(),
  logEvents: z.array(z.enum(VALID_LOG_EVENTS)).optional(),
  introChannelId: discordId.nullable().optional(),
  introRoleId: discordId.nullable().optional(),
  isIntroGateEnabled: z.boolean().optional(),
  introMinChars: z.number().int().min(1).max(10000).optional(),
  introMinWords: z.number().int().min(1).max(1000).optional(),
  introMinSubstantiveWords: z.number().int().min(0).max(100).optional(),
  introUniqueWordRatio: z.number().int().min(0).max(100).optional(),
  introMaxRepeatedCharPct: z.number().int().min(0).max(100).optional(),
  modNotesChannelId: discordId.nullable().optional(),
  isSuggestionsEnabled: z.boolean().optional(),
  isAskEnabled: z.boolean().optional(),
  askSystemPrompt: z.string().max(4000).nullable().optional(),
  offtopicImages: z.array(z.string().url()).optional(),
  offtopicMessage: z.string().max(2000).nullable().optional(),
  // XP / Leveling
  isXpEnabled: z.boolean().optional(),
  xpMin: z.number().int().min(1).max(1000).optional(),
  xpMax: z.number().int().min(1).max(1000).optional(),
  xpCooldownSeconds: z.number().int().min(0).max(3600).optional(),
  xpLevelupChannelId: discordId.nullable().optional(),
  xpExcludedChannelIds: z.array(discordId).optional(),
  xpExcludedRoleIds: z.array(discordId).optional(),
  // YouTube Notifications
  isYoutubeEnabled: z.boolean().optional(),
  // Birthdays
  isBirthdayEnabled: z.boolean().optional(),
  birthdayChannelId: discordId.nullable().optional(),
  birthdayRoleId: discordId.nullable().optional(),
  birthdayMessage: z.string().max(2000).nullable().optional(),
  birthdayTimezone: z.string().max(50).optional().refine(
    (val) => {
      if (val === undefined) return true;
      try { Intl.DateTimeFormat(undefined, { timeZone: val }); return true; } catch { return false; }
    },
    { message: "Invalid IANA timezone" },
  ),
}).refine((data) => {
  if (data.xpMin !== undefined && data.xpMax !== undefined) {
    return data.xpMin <= data.xpMax;
  }
  return true;
}, { message: "xpMin cannot be greater than xpMax", path: ["xpMin"] });
