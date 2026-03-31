"use client";

import { useState, useEffect, useCallback } from "react";

const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
] as const;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const INTERVALS = [
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 2 hours", minutes: 120 },
  { label: "Every 6 hours", minutes: 360 },
  { label: "Every 12 hours", minutes: 720 },
  { label: "Every 24 hours", minutes: 1440 },
] as const;

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

type Mode = "single" | "multiple" | "advanced";

interface SingleState {
  hour: number;
  minute: number;
  period: "AM" | "PM";
  days: number[];
}

interface MultipleState {
  intervalMinutes: number;
  days: number[];
}

/** Parse a cron expression back into builder state if possible. */
function parseCron(cron: string): { mode: Mode; single: SingleState; multiple: MultipleState } {
  const defaults = {
    single: { hour: 9, minute: 0, period: "AM" as const, days: [] },
    multiple: { intervalMinutes: 1440, days: [] },
  };

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { mode: "advanced", ...defaults };

  const [minField, hourField, , , dowField] = parts;

  // Parse day-of-week
  const parseDays = (field: string): number[] => {
    if (field === "*") return [];
    const dayNums: number[] = [];
    for (const part of field.split(",")) {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        if (isNaN(start) || isNaN(end)) return [];
        for (let i = start; i <= end; i++) dayNums.push(i);
      } else {
        const n = Number(part);
        if (isNaN(n)) return [];
        dayNums.push(n);
      }
    }
    return dayNums;
  };

  const days = parseDays(dowField);

  // Try multiple mode: */N * * * [dow] or 0 */N * * [dow]
  if (minField.startsWith("*/") && hourField === "*") {
    const interval = Number(minField.slice(2));
    if (!isNaN(interval) && INTERVALS.some((i) => i.minutes === interval)) {
      return { mode: "multiple", single: defaults.single, multiple: { intervalMinutes: interval, days } };
    }
  }
  if (minField === "0" && hourField.startsWith("*/")) {
    const hourInterval = Number(hourField.slice(2));
    if (!isNaN(hourInterval)) {
      const intervalMinutes = hourInterval * 60;
      if (INTERVALS.some((i) => i.minutes === intervalMinutes)) {
        return { mode: "multiple", single: defaults.single, multiple: { intervalMinutes, days } };
      }
    }
  }

  // Try single mode: M H * * [dow]
  const min = Number(minField);
  const hour24 = Number(hourField);
  if (!isNaN(min) && !isNaN(hour24) && min >= 0 && min <= 59 && hour24 >= 0 && hour24 <= 23) {
    const period = hour24 >= 12 ? "PM" as const : "AM" as const;
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
    return {
      mode: "single",
      single: { hour: hour12, minute: min, period, days },
      multiple: defaults.multiple,
    };
  }

  return { mode: "advanced", ...defaults };
}

function buildCron(mode: Mode, single: SingleState, multiple: MultipleState, advancedValue: string): string {
  if (mode === "advanced") return advancedValue;

  const dowField = (days: number[]) => {
    if (days.length === 0 || days.length === 7) return "*";
    return days.sort((a, b) => a - b).join(",");
  };

  if (mode === "single") {
    let hour24 = single.hour;
    if (single.period === "AM" && single.hour === 12) hour24 = 0;
    else if (single.period === "PM" && single.hour !== 12) hour24 = single.hour + 12;
    return `${single.minute} ${hour24} * * ${dowField(single.days)}`;
  }

  // Multiple mode
  const dow = dowField(multiple.days);
  if (multiple.intervalMinutes < 60) {
    return `*/${multiple.intervalMinutes} * * * ${dow}`;
  }
  if (multiple.intervalMinutes === 60) {
    return `0 * * * ${dow}`;
  }
  const hours = multiple.intervalMinutes / 60;
  if (multiple.intervalMinutes === 1440) {
    return `0 0 * * ${dow}`;
  }
  return `0 */${hours} * * ${dow}`;
}

/** Describe a cron expression in plain English. */
function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minField, hourField, domField, monthField, dowField] = parts;
  if (domField !== "*" || monthField !== "*") return cron;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const describeDays = (field: string): string => {
    if (field === "*") return "every day";
    if (field === "1-5") return "weekdays";
    if (field === "0,6" || field === "6,0") return "weekends";
    const nums: number[] = [];
    for (const p of field.split(",")) {
      if (p.includes("-")) {
        const [s, e] = p.split("-").map(Number);
        for (let i = s; i <= e; i++) nums.push(i);
      } else {
        nums.push(Number(p));
      }
    }
    if (nums.length === 7) return "every day";
    return nums.map((n) => dayNames[n] ?? String(n)).join(", ");
  };

  const formatTime = (h: number, m: number): string => {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
  };

  const daysStr = describeDays(dowField);

  // Interval patterns
  if (minField.startsWith("*/") && hourField === "*") {
    return `Every ${minField.slice(2)} minutes, ${daysStr}`;
  }
  if (minField === "0" && hourField === "*") {
    return `Every hour, ${daysStr}`;
  }
  if (minField === "0" && hourField.startsWith("*/")) {
    const h = Number(hourField.slice(2));
    return `Every ${h} hours, ${daysStr}`;
  }

  // Specific time
  const min = Number(minField);
  const hour = Number(hourField);
  if (!isNaN(min) && !isNaN(hour)) {
    return `At ${formatTime(hour, min)}, ${daysStr}`;
  }

  return cron;
}

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const parsed = parseCron(value);
  const [mode, setMode] = useState<Mode>(parsed.mode);
  const [single, setSingle] = useState<SingleState>(parsed.single);
  const [multiple, setMultiple] = useState<MultipleState>(parsed.multiple);
  const [advancedValue, setAdvancedValue] = useState(mode === "advanced" ? value : "");

  const emitCron = useCallback(
    (m: Mode, s: SingleState, mul: MultipleState, adv: string) => {
      const cron = buildCron(m, s, mul, adv);
      onChange(cron);
    },
    [onChange],
  );

  // When mode changes, emit new cron
  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    if (newMode === "advanced") {
      setAdvancedValue(buildCron(mode, single, multiple, advancedValue));
    }
    emitCron(newMode, single, multiple, newMode === "advanced" ? buildCron(mode, single, multiple, advancedValue) : advancedValue);
  };

  const updateSingle = (patch: Partial<SingleState>) => {
    const next = { ...single, ...patch };
    setSingle(next);
    emitCron(mode, next, multiple, advancedValue);
  };

  const updateMultiple = (patch: Partial<MultipleState>) => {
    const next = { ...multiple, ...patch };
    setMultiple(next);
    emitCron(mode, single, next, advancedValue);
  };

  const toggleDay = (dayValue: number, forMode: "single" | "multiple") => {
    if (forMode === "single") {
      const days = single.days.includes(dayValue)
        ? single.days.filter((d) => d !== dayValue)
        : [...single.days, dayValue];
      updateSingle({ days });
    } else {
      const days = multiple.days.includes(dayValue)
        ? multiple.days.filter((d) => d !== dayValue)
        : [...multiple.days, dayValue];
      updateMultiple({ days });
    }
  };

  const currentDays = mode === "single" ? single.days : multiple.days;
  const preview = describeCron(value);

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-lg bg-dc-bg-tertiary p-1">
          <button
            type="button"
            onClick={() => handleModeChange("single")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              mode === "single"
                ? "bg-dc-bg-secondary text-dc-text-primary shadow-sm"
                : "text-dc-text-muted hover:text-dc-text-secondary"
            }`}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("multiple")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              mode === "multiple"
                ? "bg-dc-bg-secondary text-dc-text-primary shadow-sm"
                : "text-dc-text-muted hover:text-dc-text-secondary"
            }`}
          >
            Multiple
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("advanced")}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              mode === "advanced"
                ? "bg-dc-bg-secondary text-dc-text-primary shadow-sm"
                : "text-dc-text-muted hover:text-dc-text-secondary"
            }`}
          >
            Advanced
          </button>
        </div>
      </div>

      {/* Single mode: time picker */}
      {mode === "single" && (
        <div>
          <label className="block text-xs font-semibold text-dc-text-muted uppercase tracking-wide mb-1.5">At</label>
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
              value={single.hour}
              onChange={(e) => updateSingle({ hour: Number(e.target.value) })}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-dc-text-muted">:</span>
            <select
              className="px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
              value={single.minute}
              onChange={(e) => updateSingle({ minute: Number(e.target.value) })}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
              ))}
            </select>
            <select
              className="px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
              value={single.period}
              onChange={(e) => updateSingle({ period: e.target.value as "AM" | "PM" })}
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </div>
      )}

      {/* Multiple mode: interval picker */}
      {mode === "multiple" && (
        <div>
          <label className="block text-xs font-semibold text-dc-text-muted uppercase tracking-wide mb-1.5">Every</label>
          <select
            className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
            value={multiple.intervalMinutes}
            onChange={(e) => updateMultiple({ intervalMinutes: Number(e.target.value) })}
          >
            {INTERVALS.map((i) => (
              <option key={i.minutes} value={i.minutes}>{i.label.replace("Every ", "")}</option>
            ))}
          </select>
        </div>
      )}

      {/* Advanced mode: raw cron input */}
      {mode === "advanced" && (
        <div>
          <label className="block text-xs font-semibold text-dc-text-muted uppercase tracking-wide mb-1.5">Cron Expression</label>
          <input
            className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm font-mono outline-none focus:border-dc-accent"
            value={advancedValue}
            onChange={(e) => {
              setAdvancedValue(e.target.value);
              emitCron("advanced", single, multiple, e.target.value);
            }}
            placeholder="0 20 * * 4"
          />
          <p className="text-xs text-dc-text-muted mt-1">
            Format: minute hour day-of-month month day-of-week (e.g. <code className="text-dc-accent">0 20 * * 4</code> = Thu 8 PM)
          </p>
        </div>
      )}

      {/* Day of week picker (single + multiple modes) */}
      {mode !== "advanced" && (
        <div>
          <label className="block text-xs font-semibold text-dc-text-muted uppercase tracking-wide mb-1.5">Day of the week</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const active = currentDays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value, mode as "single" | "multiple")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer border ${
                    active
                      ? "bg-dc-success/20 border-dc-success text-dc-success"
                      : "bg-dc-bg-tertiary border-dc-border text-dc-text-muted hover:text-dc-text-secondary hover:border-dc-text-muted"
                  }`}
                >
                  {active ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="5.5" />
                      <line x1="5.5" y1="8" x2="10.5" y2="8" />
                    </svg>
                  )}
                  {day.label}
                </button>
              );
            })}
          </div>
          {currentDays.length === 0 && (
            <p className="text-xs text-dc-text-muted mt-1">No days selected = every day</p>
          )}
        </div>
      )}

      {/* Preview */}
      <div className="flex items-center gap-2 pt-1 border-t border-dc-border">
        <span className="text-xs text-dc-text-muted">Preview:</span>
        <span className="text-sm text-dc-text-primary font-medium">{preview}</span>
        {mode !== "advanced" && (
          <code className="text-xs text-dc-text-muted ml-auto font-mono">{value}</code>
        )}
      </div>
    </div>
  );
}
