/** Discord's switch: a pill track with a knob that carries a check or a cross. */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name (the visible label lives next to the switch). */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-dc-accent" : "bg-[#4e5058]"}`}
    >
      <span
        className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white flex items-center justify-center transition-[left] ${checked ? "left-[19px]" : "left-[3px]"}`}
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-dc-accent" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2.5 6.5l2.2 2.2L9.5 3.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="w-2 h-2 text-[#4e5058]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        )}
      </span>
    </button>
  );
}

/** A settings row: label and optional description on the left, the switch on the right. */
export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-dc-text-primary">{label}</p>
        {description && <p className="text-xs text-dc-text-muted mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}
