// Values shared by the bot and the web app. This module has no imports, so any
// code, including a client component, can import it through "@dragonbot/db/contracts".

/** Log event types a guild can enable. The order is the dashboard checkbox order. */
export const LOG_EVENTS = [
  "member_join",
  "member_leave",
  "message_delete",
  "message_edit",
  "role_change",
  "nickname_change",
  "voice_activity",
  "kick",
  "ban",
] as const;

export type LogEventType = (typeof LOG_EVENTS)[number];

/** Every status a suggestion can have (the API accepts all five). */
export const SUGGESTION_STATUSES = ["pending", "approved", "rejected", "completed", "archived"] as const;

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

// The regexes below have no g or y flag, so .test() keeps no state between calls.

/** A Discord snowflake ID: 17 to 20 digits. */
export const DISCORD_SNOWFLAKE_RE = /^[0-9]{17,20}$/;

/** A UUID, any letter case. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A whole YouTube channel ID: "UC" and 22 word or dash characters. */
export const YOUTUBE_CHANNEL_ID_RE = /^UC[\w-]{22}$/;
