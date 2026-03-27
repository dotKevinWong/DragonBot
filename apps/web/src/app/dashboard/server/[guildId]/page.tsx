"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";

interface GuildSettings {
  guildId: string;
  guildName: string | null;
  verificationRoleId: string | null;
  isVerificationSyncEnabled: boolean;
  isBanSyncEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeMessage: string | null;
  isWelcomeEnabled: boolean;
  dmWelcomeMessage: string | null;
  isDmWelcomeEnabled: boolean;
  logChannelId: string | null;
  isLoggingEnabled: boolean;
  logEvents: string[];
  introChannelId: string | null;
  introRoleId: string | null;
  isIntroGateEnabled: boolean;
  introMinChars: number;
  introMinWords: number;
  modNotesChannelId: string | null;
  isSuggestionsEnabled: boolean;
  isAskEnabled: boolean;
  askSystemPrompt: string | null;
  offtopicImages: string[];
  offtopicMessage: string | null;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: string;
}

interface DiscordRole {
  id: string;
  name: string;
  color: string;
}

const LOG_EVENT_OPTIONS = [
  "member_join", "member_leave", "message_delete", "message_edit",
  "role_change", "nickname_change", "voice_activity", "kick", "ban",
];

// --- Reusable Components ---

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
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

function ChannelSelect({ label, value, onChange, channels, filterType }: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  channels: DiscordChannel[];
  filterType?: string;
}) {
  const filtered = filterType ? channels.filter((c) => c.type === filterType) : channels.filter((c) => c.type !== "category");
  return (
    <div>
      <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">{label}</label>
      <select
        className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors cursor-pointer"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">None</option>
        {filtered.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.type === "voice" ? "🔊" : "#"} {ch.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function RoleSelect({ label, value, onChange, roles }: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  roles: DiscordRole[];
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">{label}</label>
      <select
        className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors cursor-pointer"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">None</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            @{role.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function PlaceholderTextarea({ label, value, onChange, placeholder, placeholders, channels }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  placeholders?: { label: string; value: string }[];
  channels?: DiscordChannel[];
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [triggerChar, setTriggerChar] = useState<"#" | "@">("@");
  const isInternalChange = useRef(false);

  // Convert storage format → rich HTML for contenteditable
  function toHTML(raw: string): string {
    let html = raw.replace(/\\n/g, "\n");
    // Escape HTML entities in plain text
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Restore channel mentions as styled spans
    html = html.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
      const ch = channels?.find((c) => c.id === id);
      const name = ch ? ch.name : id;
      return `<span contenteditable="false" data-channel-id="${id}" class="inline-flex items-center gap-0.5 bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px align-baseline text-xs cursor-default">#${name}</span>`;
    });
    // Style {member} and {server} placeholders
    html = html.replace(/\{(member|server)\}/g,
      '<span contenteditable="false" class="bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px text-xs cursor-default">{$1}</span>',
    );
    // Newlines to <br>
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  // Extract storage format from the contenteditable DOM
  function fromDOM(el: HTMLElement): string {
    let result = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent ?? "";
      } else if (node.nodeName === "BR") {
        result += "\\n";
      } else if (node.nodeName === "DIV" || node.nodeName === "P") {
        // Block elements from Enter key in some browsers
        if (result.length > 0 && !result.endsWith("\\n")) result += "\\n";
        result += fromDOM(node as HTMLElement);
      } else if (node instanceof HTMLElement && node.dataset.channelId) {
        result += `<#${node.dataset.channelId}>`;
      } else if (node instanceof HTMLElement && node.textContent?.match(/^\{(member|server)\}$/)) {
        result += node.textContent;
      } else {
        result += node.textContent ?? "";
      }
    }
    return result;
  }

  // Sync HTML into editor when value changes externally
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    const html = toHTML(value);
    if (el.innerHTML !== html) {
      el.innerHTML = html || "";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, channels]);

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    isInternalChange.current = true;
    const storageVal = fromDOM(el);
    onChange(storageVal);

    // Check for # or @ mention trigger
    if (!channels || channels.length === 0) { setShowMentions(false); return; }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { setShowMentions(false); return; }

    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) { setShowMentions(false); return; }

    const textBefore = (textNode.textContent ?? "").slice(0, range.startOffset);

    // Check for # trigger first, then @
    const hashIdx = textBefore.lastIndexOf("#");
    const atIdx = textBefore.lastIndexOf("@");
    const bestIdx = Math.max(hashIdx, atIdx);
    const bestChar = bestIdx === hashIdx ? "#" : "@";

    if (bestIdx >= 0) {
      const filter = textBefore.slice(bestIdx + 1);
      if (!filter.includes("\n") && !filter.includes(" ") && filter.length <= 30) {
        // Get cursor position for dropdown placement
        const cursorRect = range.getBoundingClientRect();
        const editorRect = editorRef.current?.getBoundingClientRect();
        if (editorRect) {
          setMentionPos({
            top: cursorRect.top - editorRect.top,
            left: cursorRect.left - editorRect.left,
          });
        }
        setTriggerChar(bestChar as "#" | "@");
        setShowMentions(true);
        setMentionFilter(filter.toLowerCase());
        return;
      }
    }
    setShowMentions(false);
  }

  function insertAtCursor(text: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();

    // If it's a placeholder, insert as styled span
    if (text === "{member}" || text === "{server}") {
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.className = "bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px text-xs cursor-default";
      span.textContent = text;
      range.insertNode(span);
      // Move cursor after span
      range.setStartAfter(span);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    handleInput();
  }

  function insertChannelMention(channel: DiscordChannel) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;

    // Remove the trigger char + filter text
    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent ?? "";
      const cursorPos = range.startOffset;
      const beforeCursor = text.slice(0, cursorPos);
      const trigIdx = Math.max(beforeCursor.lastIndexOf("#"), beforeCursor.lastIndexOf("@"));
      if (trigIdx >= 0) {
        textNode.textContent = text.slice(0, trigIdx) + text.slice(cursorPos);
        range.setStart(textNode, trigIdx);
        range.collapse(true);
      }
    }

    // Insert channel span
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.channelId = channel.id;
    span.className = "inline-flex items-center gap-0.5 bg-[#404675] text-[#c9cdfb] rounded px-0.5 mx-px align-baseline text-xs cursor-default";
    span.textContent = `#${channel.name}`;
    range.insertNode(span);

    // Move cursor after
    range.setStartAfter(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    setShowMentions(false);
    setMentionFilter("");
    handleInput();
  }

  const filteredChannels = channels?.filter((c) =>
    c.type !== "category" && c.name.toLowerCase().includes(mentionFilter),
  ) ?? [];

  return (
    <div>
      {label && <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">{label}</label>}
      {(placeholders || channels) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {placeholders?.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => insertAtCursor(p.value)}
              className="px-2 py-0.5 bg-dc-accent/20 text-dc-accent text-xs rounded hover:bg-dc-accent/30 transition-colors cursor-pointer"
            >
              {p.label}
            </button>
          ))}
          {channels && channels.length > 0 && (
            <span className="text-[11px] text-dc-text-muted self-center ml-1">Type # to mention a channel</span>
          )}
        </div>
      )}
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={(e) => {
            if (showMentions && e.key === "Escape") {
              setShowMentions(false);
              e.preventDefault();
            }
          }}
          onBlur={() => setTimeout(() => setShowMentions(false), 200)}
          data-placeholder={placeholder}
          className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors min-h-20 whitespace-pre-wrap empty:before:content-[attr(data-placeholder)] empty:before:text-dc-text-muted"
        />
        {showMentions && filteredChannels.length > 0 && (
          <div
            className="absolute bg-dc-bg-tertiary border border-dc-border rounded-md shadow-lg max-h-48 overflow-y-auto z-10 w-56"
            style={{
              bottom: `calc(100% - ${mentionPos.top}px + 4px)`,
              left: `${Math.min(mentionPos.left, (editorRef.current?.offsetWidth ?? 224) - 224)}px`,
            }}
          >
            {filteredChannels.slice(0, 10).map((ch) => (
              <button
                key={ch.id}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm text-dc-text-secondary hover:bg-dc-bg-modifier hover:text-dc-text-primary transition-colors cursor-pointer"
                onMouseDown={(e) => { e.preventDefault(); insertChannelMention(ch); }}
              >
                {ch.type === "voice" ? "🔊" : "#"} {ch.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
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

function EventPicker({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-4">
      <h2 className="text-sm font-semibold text-dc-text-primary mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// --- Main Page ---

export default function ServerSettingsPage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasDiscordData, setHasDiscordData] = useState(false);

  useEffect(() => {
    const jwt = localStorage.getItem("jwt");
    if (!jwt) { window.location.href = "/"; return; }

    // Fetch settings and Discord data in parallel
    Promise.all([
      fetch(`/api/server/${guildId}`, { headers: { Authorization: `Bearer ${jwt}` } }),
      fetch(`/api/server/${guildId}/discord`, { headers: { Authorization: `Bearer ${jwt}` } }),
    ])
      .then(async ([settingsRes, discordRes]) => {
        if (settingsRes.status === 401) { localStorage.removeItem("jwt"); window.location.href = "/"; return; }
        if (settingsRes.status === 403) { setError("You don't have permission to manage this server."); setLoading(false); return; }

        const settingsData = await settingsRes.json();
        setSettings(settingsData);

        if (discordRes.ok) {
          const discordData = await discordRes.json();
          setChannels(discordData.channels ?? []);
          setRoles(discordData.roles ?? []);
          if ((discordData.channels?.length ?? 0) > 0 || (discordData.roles?.length ?? 0) > 0) {
            setHasDiscordData(true);
          }
        }
        setLoading(false);
      })
      .catch(() => { setError("Failed to load settings."); setLoading(false); });
  }, [guildId]);

  function update<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);

    const jwt = localStorage.getItem("jwt");
    // Always include non-Discord fields
    const updateFields: Record<string, unknown> = {
      isVerificationSyncEnabled: settings.isVerificationSyncEnabled,
      isBanSyncEnabled: settings.isBanSyncEnabled,
      welcomeMessage: settings.welcomeMessage,
      isWelcomeEnabled: settings.isWelcomeEnabled,
      dmWelcomeMessage: settings.dmWelcomeMessage,
      isDmWelcomeEnabled: settings.isDmWelcomeEnabled,
      isLoggingEnabled: settings.isLoggingEnabled,
      logEvents: settings.logEvents,
      isIntroGateEnabled: settings.isIntroGateEnabled,
      introMinChars: settings.introMinChars,
      introMinWords: settings.introMinWords,
      isSuggestionsEnabled: settings.isSuggestionsEnabled,
      isAskEnabled: settings.isAskEnabled,
      askSystemPrompt: settings.askSystemPrompt,
      offtopicImages: settings.offtopicImages,
      offtopicMessage: settings.offtopicMessage,
    };

    // Only include role/channel IDs if we successfully loaded Discord data
    // (prevents overwriting with null when API was rate-limited)
    if (hasDiscordData) {
      updateFields.verificationRoleId = settings.verificationRoleId;
      updateFields.welcomeChannelId = settings.welcomeChannelId;
      updateFields.logChannelId = settings.logChannelId;
      updateFields.introChannelId = settings.introChannelId;
      updateFields.introRoleId = settings.introRoleId;
      updateFields.modNotesChannelId = settings.modNotesChannelId;
    }

    const res = await fetch(`/api/server/${guildId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify(updateFields),
    });

    if (res.ok) {
      const data = await res.json();
      setSettings(data);
      setMessage({ type: "success", text: "Settings saved!" });
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to save settings." });
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-dc-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) return <p className="text-dc-danger">{error}</p>;
  if (!settings) return <p className="text-dc-text-muted">No settings found.</p>;

  const messagePlaceholders = [
    { label: "{member}", value: "{member}" },
    { label: "{server}", value: "{server}" },
  ];

  const textChannels = channels.filter((c) => c.type === "text" || c.type === "announcement");

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Server Settings</h1>
          <p className="text-dc-text-muted text-sm mt-0.5">{settings.guildName ?? guildId}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-dc-accent hover:bg-dc-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-md mb-6 text-sm ${
          message.type === "success"
            ? "bg-dc-success/10 border border-dc-success/30 text-dc-success"
            : "bg-dc-danger/10 border border-dc-danger/30 text-dc-danger"
        }`}>
          {message.text}
        </div>
      )}

      <Section title="Verification">
        <Toggle label="Auto-verify on join" checked={settings.isVerificationSyncEnabled} onChange={(v) => update("isVerificationSyncEnabled", v)} />
        <RoleSelect label="Verification Role" value={settings.verificationRoleId} onChange={(v) => update("verificationRoleId", v)} roles={roles} />
      </Section>

      <Section title="Welcome Messages">
        <Toggle label="Enable channel welcome" checked={settings.isWelcomeEnabled} onChange={(v) => update("isWelcomeEnabled", v)} />
        <ChannelSelect label="Welcome Channel" value={settings.welcomeChannelId} onChange={(v) => update("welcomeChannelId", v)} channels={channels} filterType="text" />
        <PlaceholderTextarea
          label="Welcome Message"
          value={settings.welcomeMessage ?? ""}
          onChange={(v) => update("welcomeMessage", v || null)}
          placeholder="Welcome to {server}, {member}!"
          placeholders={messagePlaceholders}
          channels={textChannels}
        />
        <div className="border-t border-dc-border pt-3 mt-1">
          <Toggle label="Enable DM welcome" checked={settings.isDmWelcomeEnabled} onChange={(v) => update("isDmWelcomeEnabled", v)} />
          <PlaceholderTextarea
            label="DM Welcome Message"
            value={settings.dmWelcomeMessage ?? ""}
            onChange={(v) => update("dmWelcomeMessage", v || null)}
            placeholder="Welcome! Please introduce yourself."
            placeholders={messagePlaceholders}
            channels={textChannels}
          />
        </div>
      </Section>

      <Section title="Audit Logging">
        <Toggle label="Enable logging" checked={settings.isLoggingEnabled} onChange={(v) => update("isLoggingEnabled", v)} />
        <ChannelSelect label="Log Channel" value={settings.logChannelId} onChange={(v) => update("logChannelId", v)} channels={channels} filterType="text" />
        <div>
          <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Log Events</label>
          <EventPicker selected={settings.logEvents} onChange={(v) => update("logEvents", v)} />
        </div>
      </Section>

      <Section title="Introduction Gate">
        <Toggle label="Enable intro gate" checked={settings.isIntroGateEnabled} onChange={(v) => update("isIntroGateEnabled", v)} />
        <ChannelSelect label="Intro Channel" value={settings.introChannelId} onChange={(v) => update("introChannelId", v)} channels={channels} filterType="text" />
        <RoleSelect label="Intro Role" value={settings.introRoleId} onChange={(v) => update("introRoleId", v)} roles={roles} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Min Characters</label>
            <input type="number" className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors" value={settings.introMinChars} onChange={(e) => update("introMinChars", parseInt(e.target.value) || 0)} min={0} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Min Words</label>
            <input type="number" className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors" value={settings.introMinWords} onChange={(e) => update("introMinWords", parseInt(e.target.value) || 0)} min={0} />
          </div>
        </div>
      </Section>

      <Section title="Moderation">
        <Toggle label="Cross-guild ban sync" checked={settings.isBanSyncEnabled} onChange={(v) => update("isBanSyncEnabled", v)} />
        <ChannelSelect label="Mod Notes Channel" value={settings.modNotesChannelId} onChange={(v) => update("modNotesChannelId", v)} channels={channels} filterType="text" />
      </Section>

      <Section title="Suggestions">
        <Toggle label="Enable suggestions" checked={settings.isSuggestionsEnabled} onChange={(v) => update("isSuggestionsEnabled", v)} />
      </Section>

      <Section title="AI / Ask">
        <Toggle label="Enable /ask command" checked={settings.isAskEnabled} onChange={(v) => update("isAskEnabled", v)} />
        <div>
          <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">System Prompt</label>
          <textarea
            className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors resize-y min-h-24"
            value={settings.askSystemPrompt ?? ""}
            onChange={(e) => update("askSystemPrompt", e.target.value || null)}
            placeholder="Custom system prompt for the AI..."
          />
        </div>
      </Section>

      <Section title="Off-Topic">
        <PlaceholderTextarea
          label="Response Message"
          value={settings.offtopicMessage ?? ""}
          onChange={(v) => update("offtopicMessage", v || null)}
          placeholder="Off-topic response message..."
          channels={textChannels}
        />
        <div>
          <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Image URLs</label>
          <TagInput values={settings.offtopicImages} onChange={(v) => update("offtopicImages", v)} placeholder="Paste image URL and press Enter" />
        </div>
      </Section>

    </div>
  );
}
