import type { DiscordChannel } from "@/lib/guild-settings";
import { FIELD_LABEL_CLASS, SELECT_CLASS } from "@/lib/form-classes";

export function ChannelSelect({ label, value, onChange, channels, filterType, showUnknown }: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  channels: DiscordChannel[];
  filterType?: string;
  /** Show a stored channel that isn't in the list as "Unknown channel (<id>)" instead of "None". */
  showUnknown?: boolean;
}) {
  const filtered = filterType ? channels.filter((c) => c.type === filterType) : channels.filter((c) => c.type !== "category");
  return (
    <div>
      <label className={FIELD_LABEL_CLASS}>{label}</label>
      <select
        className={SELECT_CLASS}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">None</option>
        {showUnknown && value && !filtered.some((ch) => ch.id === value) && (
          <option value={value}>Unknown channel ({value})</option>
        )}
        {filtered.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.type === "voice" ? "🔊" : "#"} {ch.name}
          </option>
        ))}
      </select>
    </div>
  );
}
