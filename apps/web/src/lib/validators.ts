import { z } from "zod";

const VALID_LOG_EVENTS = [
  "member_join", "member_leave", "message_delete", "message_edit",
  "role_change", "nickname_change", "voice_activity", "kick", "ban",
] as const;

export const profileUpdateSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  pronouns: z.string().max(50).nullable().optional(),
  major: z.string().max(100).nullable().optional(),
  college: z.string().max(200).nullable().optional(),
  year: z.string().max(50).nullable().optional(),
  plan: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  coop1: z.string().max(200).nullable().optional(),
  coop2: z.string().max(200).nullable().optional(),
  coop3: z.string().max(200).nullable().optional(),
  clubs: z.array(z.string().max(100)).max(20).nullable().optional(),
  isProfileDisabled: z.boolean().optional(),
});

export const guildSettingsUpdateSchema = z.object({
  verificationRoleId: z.string().max(20).nullable().optional(),
  isVerificationSyncEnabled: z.boolean().optional(),
  isBanSyncEnabled: z.boolean().optional(),
  welcomeChannelId: z.string().max(20).nullable().optional(),
  welcomeMessage: z.string().max(2000).nullable().optional(),
  isWelcomeEnabled: z.boolean().optional(),
  dmWelcomeMessage: z.string().max(2000).nullable().optional(),
  isDmWelcomeEnabled: z.boolean().optional(),
  logChannelId: z.string().max(20).nullable().optional(),
  isLoggingEnabled: z.boolean().optional(),
  logEvents: z.array(z.enum(VALID_LOG_EVENTS)).optional(),
  introChannelId: z.string().max(20).nullable().optional(),
  introRoleId: z.string().max(20).nullable().optional(),
  isIntroGateEnabled: z.boolean().optional(),
  introMinChars: z.number().int().min(1).optional(),
  introMinWords: z.number().int().min(1).optional(),
  modNotesChannelId: z.string().max(20).nullable().optional(),
  isSuggestionsEnabled: z.boolean().optional(),
  isAskEnabled: z.boolean().optional(),
  askSystemPrompt: z.string().max(4000).nullable().optional(),
  offtopicImages: z.array(z.string().url()).optional(),
  offtopicMessage: z.string().max(2000).nullable().optional(),
});
