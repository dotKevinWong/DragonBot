import { LOG_EVENTS, type LogEventType } from "@dragonbot/db/contracts";
import { Switch } from "./toggle";

/** A readable name and one line for each log event key. */
const EVENT_TEXT: Record<LogEventType, { label: string; description: string }> = {
  member_join: { label: "Member joined", description: "Someone joins the server" },
  member_leave: { label: "Member left", description: "Someone leaves (or is kicked)" },
  message_delete: { label: "Message deleted", description: "A message is deleted, with its text" },
  message_edit: { label: "Message edited", description: "A message is edited, before and after" },
  role_change: { label: "Roles changed", description: "A member gains or loses a role" },
  nickname_change: { label: "Nickname changed", description: "A member's server nickname changes" },
  voice_activity: { label: "Voice activity", description: "Joins, leaves and moves between voice channels" },
  kick: { label: "Kicks", description: "A member is kicked, with the moderator and reason" },
  ban: { label: "Bans", description: "A member is banned, with the moderator and reason" },
};

/** One switch per log event, in LOG_EVENTS order. */
export function EventPicker({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string, on: boolean) {
    if (!on) onChange(selected.filter((s) => s !== opt));
    else if (!selected.includes(opt)) onChange([...selected, opt]);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {LOG_EVENTS.map((opt) => (
        <div key={opt} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-dc-input border border-dc-border">
          <div className="min-w-0">
            <p className="text-sm text-dc-text-primary">{EVENT_TEXT[opt].label}</p>
            <p className="text-xs text-dc-text-muted truncate">{EVENT_TEXT[opt].description}</p>
          </div>
          <Switch checked={selected.includes(opt)} onChange={(v) => toggle(opt, v)} label={EVENT_TEXT[opt].label} />
        </div>
      ))}
    </div>
  );
}
