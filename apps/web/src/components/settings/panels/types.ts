import type { DiscordChannel, DiscordRole, GuildSettings } from "@/lib/guild-settings";

/** What every settings panel receives from the page. Panels hold no saved state of their own. */
export interface PanelProps {
  settings: GuildSettings;
  update: <K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) => void;
  channels: DiscordChannel[];
  roles: DiscordRole[];
  /** True when the channel and role lists loaded (DragonBot can see the server). */
  hasDiscordData: boolean;
}

/** The two placeholders the welcome messages support. */
export const MESSAGE_PLACEHOLDERS = [
  { label: "{member}", value: "{member}" },
  { label: "{server}", value: "{server}" },
];
