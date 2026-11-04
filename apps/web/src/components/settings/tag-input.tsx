"use client";

import { useState } from "react";

export function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      const val = input.trim().toLowerCase();
      if (!values.includes(val)) onChange([...values, val]);
      setInput("");
    }
    if (e.key === "Backspace" && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-dc-input border border-dc-border rounded-md min-h-[38px]">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 bg-dc-accent/20 text-dc-accent text-xs px-2 py-1 rounded">
          {v}
          <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="text-dc-danger hover:text-dc-danger/80 cursor-pointer">×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={values.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[100px] bg-transparent border-none text-dc-text-primary text-sm outline-none"
      />
    </div>
  );
}
