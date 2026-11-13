import type { DiscordChannel, DiscordRole } from "@/lib/guild-settings";
import type { PickerOption } from "./picker";

/** Channels as picker options. With `type`, only that channel type; without it, everything but categories. */
export function channelOptions(channels: DiscordChannel[], type?: string): PickerOption[] {
  return channels
    .filter((c) => (type ? c.type === type : c.type !== "category"))
    .map((c) => ({ id: c.id, label: c.name, kind: c.type === "voice" ? "voice" : "channel" }));
}

/** Roles as picker options, in the order the API gives them (highest first). */
export function roleOptions(roles: DiscordRole[]): PickerOption[] {
  return roles.map((r) => ({ id: r.id, label: r.name, kind: "role", color: r.color }));
}

/** What an empty picker says: no data at all means DragonBot couldn't read the server. */
export function emptyPickerText(hasDiscordData: boolean, what: "channels" | "roles"): string {
  return hasDiscordData ? `No ${what} to choose from` : `DragonBot can't see this server's ${what}`;
}
