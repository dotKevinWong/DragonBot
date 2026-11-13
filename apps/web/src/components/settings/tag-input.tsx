"use client";

import { useState } from "react";

export function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      // Not lowercased: image hosts like imgur use case-sensitive paths
      const val = input.trim();
      if (!values.includes(val)) onChange([...values, val]);
      setInput("");
    }
    if (e.key === "Backspace" && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-dc-input border border-dc-border rounded-lg min-h-10 focus-within:border-dc-accent transition-colors">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 h-7 rounded-md bg-[#2e2e34] text-sm text-dc-text-primary max-w-full">
          <span className="truncate">{v}</span>
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="p-0.5 rounded text-dc-text-muted hover:text-dc-text-primary hover:bg-white/10 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={values.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[140px] px-1.5 bg-transparent border-none text-dc-text-primary text-sm outline-none placeholder:text-dc-text-muted"
      />
    </div>
  );
}
