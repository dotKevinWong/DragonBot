"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import type { GuildSettings, DiscordChannel, DiscordRole } from "@/lib/guild-settings";
import { buildSettingsPatch } from "@/lib/settings-patch";
import { redirectIfUnauthorized } from "@/lib/client-fetch";
import { SELECT_CLASS } from "@/lib/form-classes";
import { SETTINGS_GROUPS, SETTINGS_PANELS, type SettingsPanelDef } from "@/components/settings/panels";

const DEFAULT_PANEL = SETTINGS_PANELS[0]!.id;

function panelFromHash(): string {
  if (typeof window === "undefined") return DEFAULT_PANEL;
  const id = window.location.hash.slice(1);
  return SETTINGS_PANELS.some((p) => p.id === id) ? id : DEFAULT_PANEL;
}

function fieldChanged(a: GuildSettings, b: GuildSettings, key: keyof GuildSettings): boolean {
  return JSON.stringify(a[key]) !== JSON.stringify(b[key]);
}

export default function ServerSettingsPage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<GuildSettings | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasDiscordData, setHasDiscordData] = useState(false);
  const [activeId, setActiveId] = useState(DEFAULT_PANEL);
  const [search, setSearch] = useState("");
  // Bumped by Reset so the open panel remounts and drops its local UI state
  const [resetCount, setResetCount] = useState(0);

  const isDirty = useMemo(() => {
    if (!settings || !savedSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(savedSettings);
  }, [settings, savedSettings]);

  // The open panel follows the URL hash, so a panel can be linked and Back works
  useEffect(() => {
    setActiveId(panelFromHash());
    const onHash = () => setActiveId(panelFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`/api/server/${guildId}`, { credentials: "same-origin" }),
      fetch(`/api/server/${guildId}/discord`, { credentials: "same-origin" }),
    ])
      .then(async ([settingsRes, discordRes]) => {
        if (redirectIfUnauthorized(settingsRes)) return;
        if (settingsRes.status === 403) { setError("You don't have permission to manage this server."); setLoading(false); return; }

        const settingsData = await settingsRes.json();
        setSettings(settingsData);
        setSavedSettings(settingsData);

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

  // A success note fades on its own; errors stay until the next action
  useEffect(() => {
    if (message?.type !== "success") return;
    const t = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(t);
  }, [message]);

  function update<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  function openPanel(id: string) {
    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0 });
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);

    const updateFields = buildSettingsPatch(settings, savedSettings, hasDiscordData);

    try {
      const res = await fetch(`/api/server/${guildId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateFields),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setSavedSettings(data);
        setMessage({ type: "success", text: "Settings saved!" });
      } else {
        setMessage({ type: "error", text: data.error ?? "Failed to save settings." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save settings." });
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
  if (!settings || !savedSettings) return <p className="text-dc-text-muted">No settings found.</p>;

  const active = SETTINGS_PANELS.find((p) => p.id === activeId) ?? SETTINGS_PANELS[0]!;
  const ActivePanel = active.Component;
  const isPanelDirty = (p: SettingsPanelDef) => p.fields.some((f) => fieldChanged(settings, savedSettings, f));

  const q = search.trim().toLowerCase();
  const visible = q
    ? SETTINGS_PANELS.filter((p) => `${p.label} ${p.description} ${p.keywords ?? ""}`.toLowerCase().includes(q))
    : SETTINGS_PANELS;

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
      {/* Panel nav: a sidebar on large screens, a dropdown below that */}
      <nav aria-label="Settings sections" className="lg:w-52 shrink-0">
        <div className="lg:sticky lg:top-8">
          <p className="text-xs text-dc-text-muted truncate mb-2 px-2.5">{settings.guildName ?? guildId}</p>
          <div className="lg:hidden">
            <select className={SELECT_CLASS} value={active.id} onChange={(e) => openPanel(e.target.value)} aria-label="Settings section">
              {SETTINGS_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {SETTINGS_PANELS.filter((p) => p.group === g).map((p) => (
                    <option key={p.id} value={p.id}>{p.label}{isPanelDirty(p) ? " •" : ""}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="hidden lg:block">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              className="w-full mb-3 px-2.5 py-1.5 bg-dc-input border border-dc-border rounded-md text-sm text-dc-text-primary outline-none placeholder:text-dc-text-muted focus:border-dc-accent"
            />
            {SETTINGS_GROUPS.map((g) => {
              const items = visible.filter((p) => p.group === g);
              if (items.length === 0) return null;
              return (
                <div key={g} className="mb-4">
                  <p className="px-2.5 mb-1 text-[11px] font-semibold uppercase tracking-wide text-dc-text-muted">{g}</p>
                  {items.map((p) => {
                    const selected = p.id === active.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => openPanel(p.id)}
                        aria-current={selected ? "page" : undefined}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 mb-0.5 rounded-md text-sm text-left transition-colors cursor-pointer ${
                          selected ? "bg-dc-bg-modifier text-dc-text-primary" : "text-dc-text-secondary hover:bg-dc-bg-modifier/50 hover:text-dc-text-primary"
                        }`}
                      >
                        <span className="truncate">{p.label}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {isPanelDirty(p) && <span className="w-1.5 h-1.5 rounded-full bg-dc-warning" title="Unsaved changes" />}
                          {p.isOn && (
                            <span
                              className={`w-2 h-2 rounded-full ${p.isOn(settings) ? "bg-dc-success" : "bg-[#4e5058]"}`}
                              title={p.isOn(settings) ? "On" : "Off"}
                            />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {visible.length === 0 && <p className="px-2.5 text-sm text-dc-text-muted">No matching settings.</p>}
          </div>
        </div>
      </nav>

      <div className="flex-1 min-w-0 max-w-[760px] pb-28">
        {!hasDiscordData && (
          <div className="mb-5 flex gap-3 px-4 py-3 rounded-lg border border-dc-warning/30 bg-dc-warning/10 text-sm">
            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 text-dc-warning" fill="currentColor" aria-hidden>
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 8a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1Zm0 8.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
            </svg>
            <div className="text-dc-text-secondary">
              <p className="font-medium text-dc-text-primary">DragonBot can&apos;t see this server&apos;s channels and roles</p>
              <p className="mt-0.5">
                Channel and role names can&apos;t be shown or picked, and channel or role changes won&apos;t be saved. Check that DragonBot is
                still in the server and has the View Channels permission, then reload.
              </p>
            </div>
          </div>
        )}

        <header className="mb-6">
          <h1 className="text-xl font-semibold text-dc-text-primary">{active.label}</h1>
          <p className="text-sm text-dc-text-muted mt-1">{active.description}</p>
        </header>

        <ActivePanel
          key={`${active.id}:${resetCount}`}
          settings={settings}
          update={update}
          channels={channels}
          roles={roles}
          hasDiscordData={hasDiscordData}
        />
      </div>

      {/* Discord's unsaved-changes bar */}
      {(isDirty || message) && (
        <div className="fixed bottom-4 left-4 right-4 md:left-[calc(312px+2rem)] md:right-8 z-40 flex justify-center pointer-events-none">
          <div
            role="status"
            className={`pointer-events-auto w-full max-w-[760px] flex items-center gap-3 rounded-lg px-4 py-2.5 shadow-2xl shadow-black/60 ${
              message?.type === "error" ? "bg-dc-danger" : isDirty ? "bg-[#111214]" : "bg-dc-success"
            }`}
          >
            <span className="text-sm font-medium text-white flex-1 min-w-0">
              {message?.type === "error" ? message.text : isDirty ? "Careful — you have unsaved changes!" : message?.text}
            </span>
            {isDirty && (
              <>
                <button
                  type="button"
                  onClick={() => { setSettings(savedSettings); setMessage(null); setResetCount((n) => n + 1); }}
                  className="text-sm font-medium text-white hover:underline cursor-pointer px-2"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 h-8 bg-[#248046] hover:bg-[#1a6334] disabled:opacity-60 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
