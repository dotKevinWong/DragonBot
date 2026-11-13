import type { ComponentType } from "react";
import type { GuildSettings } from "@/lib/guild-settings";
import type { PanelProps } from "./types";
import { VerificationPanel, WelcomePanel, IntroGatePanel } from "./members";
import { ModerationPanel, LoggingPanel, HoneypotPanel } from "./moderation";
import { XpPanel, BirthdaysPanel, SuggestionsPanel } from "./community";
import { AskPanel, OffTopicPanel } from "./commands";

/**
 * Every settings panel, in nav order. To add a feature: write its panel, then add one entry here.
 * `fields` drives the nav's unsaved-changes dot; `isOn` (when the feature has a master switch) drives its status dot;
 * `keywords` widen the nav search.
 */
export interface SettingsPanelDef {
  id: string;
  label: string;
  description: string;
  group: "Members" | "Moderation" | "Community" | "Commands";
  fields: (keyof GuildSettings)[];
  isOn?: (s: GuildSettings) => boolean;
  keywords?: string;
  Component: ComponentType<PanelProps>;
}

export const SETTINGS_PANELS: SettingsPanelDef[] = [
  {
    id: "verification", label: "Verification", group: "Members",
    description: "Give verified Drexel students a role.",
    fields: ["isVerificationSyncEnabled", "verificationRoleId"],
    keywords: "verify email role drexel sync",
    Component: VerificationPanel,
  },
  {
    id: "welcome", label: "Welcome Messages", group: "Members",
    description: "Greet new members in a channel and by DM.",
    fields: ["isWelcomeEnabled", "welcomeChannelId", "welcomeMessage", "isDmWelcomeEnabled", "dmWelcomeMessage"],
    isOn: (s) => s.isWelcomeEnabled || s.isDmWelcomeEnabled,
    keywords: "join greet dm",
    Component: WelcomePanel,
  },
  {
    id: "intro-gate", label: "Intro Gate", group: "Members",
    description: "Check introductions before giving the intro role.",
    fields: ["isIntroGateEnabled", "introChannelId", "introRoleId", "introMinChars", "introMinWords", "introMinSubstantiveWords", "introUniqueWordRatio", "introMaxRepeatedCharPct"],
    isOn: (s) => s.isIntroGateEnabled,
    keywords: "introduction",
    Component: IntroGatePanel,
  },
  {
    id: "moderation", label: "Moderation", group: "Moderation",
    description: "Ban sync across servers and the mod notes channel.",
    fields: ["isBanSyncEnabled", "modNotesChannelId"],
    isOn: (s) => s.isBanSyncEnabled,
    keywords: "ban sync mod notes",
    Component: ModerationPanel,
  },
  {
    id: "honeypot", label: "Honeypot", group: "Moderation",
    description: "Catch spam accounts with a trap channel and a repeated-message check.",
    fields: ["isHoneypotEnabled", "honeypotChannelId", "honeypotAction", "isRepeatSpamEnabled", "repeatSpamChannelCount", "repeatSpamMatchMode"],
    isOn: (s) => s.isHoneypotEnabled || s.isRepeatSpamEnabled,
    keywords: "spam trap kick ban repeat",
    Component: HoneypotPanel,
  },
  {
    id: "logging", label: "Audit Log", group: "Moderation",
    description: "Post joins, leaves, edits, deletions and more to a log channel.",
    fields: ["isLoggingEnabled", "logChannelId", "logEvents"],
    isOn: (s) => s.isLoggingEnabled,
    keywords: "logging events",
    Component: LoggingPanel,
  },
  {
    id: "xp", label: "XP & Levels", group: "Community",
    description: "Reward chatting with XP, levels and a leaderboard.",
    fields: ["isXpEnabled", "xpMin", "xpMax", "xpCooldownSeconds", "xpLevelupChannelId", "xpExcludedChannelIds", "xpExcludedRoleIds"],
    isOn: (s) => s.isXpEnabled,
    keywords: "leveling leaderboard rank",
    Component: XpPanel,
  },
  {
    id: "birthdays", label: "Birthdays", group: "Community",
    description: "Announce members' birthdays and give a role for the day.",
    fields: ["isBirthdayEnabled", "birthdayChannelId", "birthdayRoleId", "birthdayMessage", "birthdayTimezone"],
    isOn: (s) => s.isBirthdayEnabled,
    Component: BirthdaysPanel,
  },
  {
    id: "suggestions", label: "Suggestions", group: "Community",
    description: "Let members send suggestions with /suggest.",
    fields: ["isSuggestionsEnabled"],
    isOn: (s) => s.isSuggestionsEnabled,
    Component: SuggestionsPanel,
  },
  {
    id: "ask", label: "AI Ask", group: "Commands",
    description: "Answer members' questions with /ask.",
    fields: ["isAskEnabled", "askSystemPrompt"],
    isOn: (s) => s.isAskEnabled,
    keywords: "openai gpt prompt",
    Component: AskPanel,
  },
  {
    id: "offtopic", label: "Off-Topic", group: "Commands",
    description: "The reply /offtopic sends.",
    fields: ["offtopicMessage", "offtopicImages"],
    keywords: "images gif",
    Component: OffTopicPanel,
  },
];

export const SETTINGS_GROUPS = ["Members", "Moderation", "Community", "Commands"] as const;
