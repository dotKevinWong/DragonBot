export function MultiSelect({ items, selected, onChange }: {
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-dc-input border border-dc-border rounded-md min-h-[38px]">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => toggle(item.id)}
          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            selected.includes(item.id)
              ? "bg-dc-accent/20 text-dc-accent border border-dc-accent/40"
              : "bg-dc-bg-tertiary text-dc-text-muted border border-dc-border hover:border-dc-text-muted"
          }`}
        >
          {item.label}
        </button>
      ))}
      {items.length === 0 && <span className="text-xs text-dc-text-muted">No items available</span>}
    </div>
  );
}
