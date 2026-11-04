import { LOG_EVENTS } from "@dragonbot/db/contracts";

// The checkbox order and the text on each button are the event keys themselves.
const LOG_EVENT_OPTIONS = LOG_EVENTS;

export function EventPicker({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string) {
    if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt));
    else onChange([...selected, opt]);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {LOG_EVENT_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            selected.includes(opt)
              ? "bg-dc-accent/20 text-dc-accent border border-dc-accent/40"
              : "bg-dc-bg-tertiary text-dc-text-muted border border-dc-border hover:border-dc-text-muted"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
