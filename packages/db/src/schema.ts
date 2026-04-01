import {
  pgTable,
  varchar,
  boolean,
  text,
  timestamp,
  integer,
  unique,
  uuid,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  discordId: varchar("discord_id", { length: 20 }).notNull().unique(),
  email: text("email"),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  isBanned: boolean("is_banned").notNull().default(false),
  banGuildId: varchar("ban_guild_id", { length: 20 }),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  isProfileDisabled: boolean("is_profile_disabled").notNull().default(false),
  jwtInvalidBefore: timestamp("jwt_invalid_before", { withTimezone: true }),
  name: text("name"),
  pronouns: text("pronouns"),
  major: text("major"),
  college: text("college"),
  year: text("year"),
  plan: text("plan"),
  description: text("description"),
  coop1: text("coop1"),
  coop2: text("coop2"),
  coop3: text("coop3"),
  clubs: text("clubs").array(),

  // Birthday
  birthMonth: integer("birth_month"),
  birthDay: integer("birth_day"),
  birthYear: integer("birth_year"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const guilds = pgTable("guilds", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull().unique(),
  guildName: text("guild_name"),

  // Verification
  verificationRoleId: varchar("verification_role_id", { length: 20 }),
  isVerificationSyncEnabled: boolean("is_verification_sync_enabled").notNull().default(true),

  // Ban Sync
  isBanSyncEnabled: boolean("is_ban_sync_enabled").notNull().default(false),

  // Welcome
  welcomeChannelId: varchar("welcome_channel_id", { length: 20 }),
  welcomeMessage: text("welcome_message"),
  isWelcomeEnabled: boolean("is_welcome_enabled").notNull().default(false),
  dmWelcomeMessage: text("dm_welcome_message"),
  isDmWelcomeEnabled: boolean("is_dm_welcome_enabled").notNull().default(false),

  // Logging
  logChannelId: varchar("log_channel_id", { length: 20 }),
  isLoggingEnabled: boolean("is_logging_enabled").notNull().default(false),
  logEvents: text("log_events").array().notNull().default([]),

  // Introduction Gate
  introChannelId: varchar("intro_channel_id", { length: 20 }),
  introRoleId: varchar("intro_role_id", { length: 20 }),
  isIntroGateEnabled: boolean("is_intro_gate_enabled").notNull().default(false),
  introMinChars: integer("intro_min_chars").notNull().default(24),
  introMinWords: integer("intro_min_words").notNull().default(5),

  // Mod Notes
  modNotesChannelId: varchar("mod_notes_channel_id", { length: 20 }),

  // Suggestions
  isSuggestionsEnabled: boolean("is_suggestions_enabled").notNull().default(true),

  // AI / Ask
  isAskEnabled: boolean("is_ask_enabled").notNull().default(true),
  askSystemPrompt: text("ask_system_prompt"),

  // Off-Topic
  offtopicImages: text("offtopic_images").array().notNull().default([]),
  offtopicMessage: text("offtopic_message"),

  // Birthdays
  isBirthdayEnabled: boolean("is_birthday_enabled").notNull().default(false),
  birthdayChannelId: varchar("birthday_channel_id", { length: 20 }),
  birthdayRoleId: varchar("birthday_role_id", { length: 20 }),
  birthdayMessage: text("birthday_message"),
  birthdayTimezone: text("birthday_timezone").notNull().default("America/New_York"),
  lastBirthdayCheckDate: text("last_birthday_check_date"),

  // YouTube Notifications
  isYoutubeEnabled: boolean("is_youtube_enabled").notNull().default(false),

  // XP / Leveling
  isXpEnabled: boolean("is_xp_enabled").notNull().default(false),
  xpMin: integer("xp_min").notNull().default(15),
  xpMax: integer("xp_max").notNull().default(25),
  xpCooldownSeconds: integer("xp_cooldown_seconds").notNull().default(60),
  xpLevelupChannelId: varchar("xp_levelup_channel_id", { length: 20 }),
  xpExcludedChannelIds: text("xp_excluded_channel_ids").array().notNull().default([]),
  xpExcludedRoleIds: text("xp_excluded_role_ids").array().notNull().default([]),

  // Meta
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  discordId: varchar("discord_id", { length: 20 }).notNull(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  email: text("email").notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("verif_discord_guild_idx").on(table.discordId, table.guildId),
  index("verif_expires_idx").on(table.expiresAt),
]);

export const suggestions = pgTable("suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  discordId: varchar("discord_id", { length: 20 }).notNull(),
  discordUsername: text("discord_username").notNull(),
  suggestion: text("suggestion").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("suggestions_guild_idx").on(table.guildId),
]);

export const guildAdmins = pgTable("guild_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  discordId: varchar("discord_id", { length: 20 }).notNull(),
  permissions: text("permissions").array().notNull().default([]),
  addedBy: varchar("added_by", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("guild_admins_guild_id_discord_id_unique").on(table.guildId, table.discordId),
]);

export const scheduledMessages = pgTable("scheduled_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  channelId: varchar("channel_id", { length: 20 }).notNull(),
  message: text("message").notNull(),
  cronExpression: text("cron_expression").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isEmbed: boolean("is_embed").notNull().default(false),
  embedColor: varchar("embed_color", { length: 7 }),
  embedTitle: text("embed_title"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdBy: varchar("created_by", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const syncFlags = pgTable("sync_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  dirty: boolean("dirty").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  discordId: varchar("discord_id", { length: 20 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  commandInteractionId: text("command_interaction_id"),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("auth_tokens_token_idx").on(table.token),
]);

export const userXp = pgTable("user_xp", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  discordId: varchar("discord_id", { length: 20 }).notNull(),
  totalXp: integer("total_xp").notNull().default(0),
  level: integer("level").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  xpMessageCount: integer("xp_message_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("user_xp_guild_id_discord_id_unique").on(table.guildId, table.discordId),
  index("user_xp_leaderboard_idx").on(table.guildId, table.totalXp),
]);

export const youtubeSubscriptions = pgTable("youtube_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  youtubeChannelId: varchar("youtube_channel_id", { length: 100 }).notNull(),
  youtubeChannelName: varchar("youtube_channel_name", { length: 200 }),
  notifyChannelId: varchar("notify_channel_id", { length: 20 }).notNull(),
  customMessage: text("custom_message"),
  lastVideoId: text("last_video_id"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("youtube_subs_guild_channel_unique").on(table.guildId, table.youtubeChannelId),
  index("youtube_subs_guild_idx").on(table.guildId),
]);

export const xpArchives = pgTable("xp_archives", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 }).notNull(),
  archivedBy: varchar("archived_by", { length: 20 }).notNull(),
  reason: text("reason"),
  data: jsonb("data").notNull(),
  userCount: integer("user_count").notNull(),
  totalXpSum: integer("total_xp_sum").notNull(),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("xp_archives_guild_idx").on(table.guildId),
]);
