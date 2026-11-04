export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-dc-text-secondary">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${checked ? "bg-dc-accent" : "bg-dc-border"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-[left] ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
