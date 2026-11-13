"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/** One choice in a picker. `kind` picks the leading icon: a channel hash, a speaker, or a role's colour dot. */
export interface PickerOption {
  id: string;
  label: string;
  kind: "channel" | "voice" | "role";
  /** Role colour, as a CSS colour. */
  color?: string;
}

export function OptionIcon({ option }: { option: Pick<PickerOption, "kind" | "color"> }) {
  if (option.kind === "role") {
    return <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: option.color ?? "#b5bac1" }} aria-hidden />;
  }
  if (option.kind === "voice") {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-dc-text-muted" fill="currentColor" aria-hidden>
        <path d="M12 3a1 1 0 0 0-1.7-.7L6.6 6H4a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h2.6l3.7 3.7A1 1 0 0 0 12 21V3ZM15.1 8.3a1 1 0 0 1 1.4 0 5 5 0 0 1 0 7.4 1 1 0 1 1-1.4-1.4 3 3 0 0 0 0-4.6 1 1 0 0 1 0-1.4Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-dc-text-muted" fill="currentColor" aria-hidden>
      <path d="M10.99 3.16A1 1 0 1 0 9 2.84L8.15 8H4a1 1 0 0 0 0 2h3.82l-.67 4H3a1 1 0 1 0 0 2h3.82l-.8 4.84a1 1 0 0 0 1.97.32L8.85 16h4.97l-.8 4.84a1 1 0 0 0 1.97.32l.86-5.16H20a1 1 0 1 0 0-2h-3.82l.67-4H21a1 1 0 1 0 0-2h-3.82l.8-4.84a1 1 0 1 0-1.97-.32L15.15 8h-4.97l.8-4.84ZM14.15 14l.67-4H9.85l-.67 4h4.97Z" />
    </svg>
  );
}

/** The search box and option list both pickers open. Arrow keys move, Enter picks, Escape closes. */
function OptionMenu({ options, onPick, onClose, emptyText }: {
  options: PickerOption[];
  onPick: (option: PickerOption) => void;
  onClose: () => void;
  emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[#@]/, "");
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="absolute z-30 left-0 right-0 mt-1 bg-dc-bg-floating border border-dc-border rounded-lg shadow-2xl shadow-black/50 overflow-hidden">
      <div className="p-2 border-b border-dc-border">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) onPick(o); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
          placeholder="Search"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          className="w-full px-2.5 py-1.5 bg-dc-input rounded-md text-sm text-dc-text-primary outline-none placeholder:text-dc-text-muted"
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1.5">
        {filtered.length === 0 && <p className="px-2 py-3 text-sm text-dc-text-muted text-center">{options.length === 0 ? emptyText : "No results"}</p>}
        {filtered.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={i === active}
            data-index={i}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(o)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left cursor-pointer ${
              i === active ? "bg-dc-accent text-white" : "text-dc-text-secondary"
            }`}
          >
            <OptionIcon option={o} />
            <span className="truncate" style={o.kind === "role" && i !== active && o.color && o.color !== "#b5bac1" ? { color: o.color } : undefined}>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Closes `open` when a pointer goes down outside `ref`. */
function useOutsideClose(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ref, open, close]);
}

/**
 * A single-choice searchable dropdown. A stored ID that isn't among the options (deleted, or
 * DragonBot can't see it) shows as "Unknown …" with the ID, never silently as "None".
 */
export function SinglePicker({ value, onChange, options, unknownKind, emptyText, disabled }: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: PickerOption[];
  unknownKind: "channel" | "role";
  emptyText: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useOutsideClose(ref, open, close);

  const current = value ? options.find((o) => o.id === value) : undefined;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-3 h-10 bg-dc-input border rounded-lg text-sm text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? "border-dc-accent" : "border-dc-border hover:border-[#3d3d45]"
        }`}
      >
        {current ? (
          <>
            <OptionIcon option={current} />
            <span className="truncate text-dc-text-primary">{current.label}</span>
          </>
        ) : value ? (
          <>
            <OptionIcon option={{ kind: unknownKind === "role" ? "role" : "channel", color: "#6d6f78" }} />
            <span className="truncate text-dc-text-muted">Unknown {unknownKind} <span className="font-mono text-xs">({value})</span></span>
          </>
        ) : (
          <span className="text-dc-text-muted">None</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear"
              onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange(null); } }}
              className="p-0.5 rounded text-dc-text-muted hover:text-dc-text-primary"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </span>
          )}
          <svg viewBox="0 0 24 24" className={`w-4 h-4 text-dc-text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>
      {open && (
        <OptionMenu
          options={options}
          emptyText={emptyText}
          onClose={close}
          onPick={(o) => { onChange(o.id); setOpen(false); }}
        />
      )}
    </div>
  );
}

/** A multi-choice picker: the chosen items as removable chips, and an Add button that opens a search. */
export function MultiPicker({ values, onChange, options, unknownKind, emptyText, addLabel, disabled }: {
  values: string[];
  onChange: (v: string[]) => void;
  options: PickerOption[];
  unknownKind: "channel" | "role";
  emptyText: string;
  addLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useOutsideClose(ref, open, close);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const remaining = useMemo(() => options.filter((o) => !values.includes(o.id)), [options, values]);

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-dc-input border border-dc-border rounded-lg min-h-10">
        {values.map((id) => {
          const o = byId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1.5 pl-2 pr-1 h-7 rounded-md bg-[#2e2e34] text-sm text-dc-text-primary max-w-full">
              <OptionIcon option={o ?? { kind: unknownKind === "role" ? "role" : "channel", color: "#6d6f78" }} />
              <span className={`truncate ${o ? "" : "text-dc-text-muted"}`} title={o ? undefined : id}>
                {o ? o.label : `Unknown ${unknownKind}`}
              </span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${o?.label ?? id}`}
                  onClick={() => onChange(values.filter((v) => v !== id))}
                  className="p-0.5 rounded text-dc-text-muted hover:text-dc-text-primary hover:bg-white/10 cursor-pointer"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              )}
            </span>
          );
        })}
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-sm text-dc-text-muted hover:text-dc-text-primary hover:bg-white/5 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            {addLabel}
          </button>
        )}
      </div>
      {open && (
        <OptionMenu
          options={remaining}
          emptyText={options.length === 0 ? emptyText : "Everything is already added"}
          onClose={close}
          onPick={(o) => onChange([...values, o.id])}
        />
      )}
    </div>
  );
}
