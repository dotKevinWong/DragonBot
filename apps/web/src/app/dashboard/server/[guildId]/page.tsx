"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import type { GuildSettings, DiscordChannel, DiscordRole } from "@/lib/guild-settings";
import { buildSettingsPatch } from "@/lib/settings-patch";
import { Toggle } from "@/components/settings/toggle";
import { ChannelSelect } from "@/components/settings/channel-select";
import { RoleSelect } from "@/components/settings/role-select";
import { PlaceholderTextarea } from "@/components/settings/placeholder-textarea";
import { TagInput } from "@/components/settings/tag-input";
import { MultiSelect } from "@/components/settings/multi-select";
import { EventPicker } from "@/components/settings/event-picker";
import { Section } from "@/components/settings/section";
import { FIELD_LABEL_CLASS, TEXT_INPUT_CLASS, SELECT_CLASS } from "@/lib/form-classes";
import { redirectIfUnauthorized } from "@/lib/client-fetch";
import { filterTextChannels } from "@/lib/feature-list";
import { TIMEZONES } from "@/lib/timezones";

// --- Main Page ---

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
  const [showHoneypotChannelHint, setShowHoneypotChannelHint] = useState(false);
  // Typed text of the repeated-message channel count; null when not being edited
  const [repeatCountText, setRepeatCountText] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (!settings || !savedSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(savedSettings);
  }, [settings, savedSettings]);

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

  function update<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);

    const updateFields = buildSettingsPatch(settings, savedSettings, hasDiscordData);

    const res = await fetch(`/api/server/${guildId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateFields),
    });

    if (res.ok) {
      const data = await res.json();
      setSettings(data);
      setSavedSettings(data);
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

  const textChannels = filterTextChannels(channels);
  // The same filter the honeypot channel picker uses, so the guard accepts only a channel the picker can show
  const canEnableHoneypot = hasDiscordData && channels.some((c) => c.type === "text" && c.id === settings.honeypotChannelId);

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Server Settings</h1>
          <p className="text-dc-text-muted text-sm mt-0.5">{settings.guildName ?? guildId}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
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
          <label className={FIELD_LABEL_CLASS}>Log Events</label>
          <EventPicker selected={settings.logEvents} onChange={(v) => update("logEvents", v)} />
        </div>
      </Section>

      <Section title="Introduction Gate">
        <Toggle label="Enable intro gate" checked={settings.isIntroGateEnabled} onChange={(v) => update("isIntroGateEnabled", v)} />
        <ChannelSelect label="Intro Channel" value={settings.introChannelId} onChange={(v) => update("introChannelId", v)} channels={channels} filterType="text" />
        <RoleSelect label="Intro Role" value={settings.introRoleId} onChange={(v) => update("introRoleId", v)} roles={roles} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>Min Characters</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.introMinChars} onChange={(e) => update("introMinChars", parseInt(e.target.value) || 0)} min={0} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Min Words</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.introMinWords} onChange={(e) => update("introMinWords", parseInt(e.target.value) || 0)} min={0} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>
              Min Substantive Words
              <span className="ml-1 inline-block cursor-help text-dc-text-secondary/60" title="Words that aren't common filler (hi, hey, the, from, etc.). A real intro should mention names, majors, hobbies. Set to 0 to disable.">&#9432;</span>
            </label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.introMinSubstantiveWords} onChange={(e) => update("introMinSubstantiveWords", parseInt(e.target.value) || 0)} min={0} max={100} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>
              Unique Word Ratio %
              <span className="ml-1 inline-block cursor-help text-dc-text-secondary/60" title="Minimum percentage of words that must be unique. Catches repetitive spam like 'hi hi hi hi hi'. Set to 0 to disable.">&#9432;</span>
            </label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.introUniqueWordRatio} onChange={(e) => update("introUniqueWordRatio", parseInt(e.target.value) || 0)} min={0} max={100} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>
              Max Repeated Char %
              <span className="ml-1 inline-block cursor-help text-dc-text-secondary/60" title="Reject if any single character makes up more than this percentage of the message. Catches padding like 'aaaaaaa'. Set to 0 to disable.">&#9432;</span>
            </label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.introMaxRepeatedCharPct} onChange={(e) => update("introMaxRepeatedCharPct", parseInt(e.target.value) || 0)} min={0} max={100} />
          </div>
        </div>
      </Section>

      <Section title="Moderation">
        <Toggle label="Cross-guild ban sync" checked={settings.isBanSyncEnabled} onChange={(v) => update("isBanSyncEnabled", v)} />
        <ChannelSelect label="Mod Notes Channel" value={settings.modNotesChannelId} onChange={(v) => update("modNotesChannelId", v)} channels={channels} filterType="text" />
      </Section>

      <Section title="Honeypot">
        <p className="text-xs font-semibold text-dc-text-secondary uppercase tracking-wide">Channel trap</p>
        <Toggle
          label="Enable channel trap"
          checked={settings.isHoneypotEnabled}
          onChange={(v) => {
            // Turning it on needs a channel from the loaded list; turning it off always works
            if (v && !canEnableHoneypot) {
              setShowHoneypotChannelHint(true);
              return;
            }
            setShowHoneypotChannelHint(false);
            update("isHoneypotEnabled", v);
          }}
        />
        {showHoneypotChannelHint && !canEnableHoneypot && <p className="text-xs text-dc-danger">Pick a channel first.</p>}
        <ChannelSelect label="Honeypot Channel" value={settings.honeypotChannelId} onChange={(v) => { setShowHoneypotChannelHint(false); update("honeypotChannelId", v); }} channels={channels} filterType="text" showUnknown />
        <div>
          <label className={FIELD_LABEL_CLASS}>Action</label>
          <select
            className={SELECT_CLASS}
            value={settings.honeypotAction}
            onChange={(e) => update("honeypotAction", e.target.value === "ban" ? "ban" : "kick")}
          >
            <option value="ban">Ban: removed for good</option>
            <option value="kick">Kick: removed, can rejoin</option>
          </select>
        </div>
        <div className="space-y-1 text-xs text-dc-text-muted">
          <p>Their messages from the last hour are cleaned up across the whole server either way.</p>
          <p>Verified members only have the message deleted. Staff (Administrator, Manage Server, Kick Members or Ban Members) are ignored.</p>
          <p>Pick a channel everyone can see and post in but nobody has a reason to use. Test it with an alt account: if you aren&apos;t staff, posting there removes you.</p>
        </div>
        <div className="border-t border-dc-border pt-3 mt-1 space-y-3">
          <p className="text-xs font-semibold text-dc-text-secondary uppercase tracking-wide">Repeated messages</p>
          <Toggle label="Enable repeated-message check" checked={settings.isRepeatSpamEnabled} onChange={(v) => update("isRepeatSpamEnabled", v)} />
          <div>
            <label className={FIELD_LABEL_CLASS}>Kick after the same message in this many channels</label>
            {/* The 2 and 10 are REPEAT_SPAM_MIN_CHANNELS and REPEAT_SPAM_MAX_CHANNELS; this client component can't import @dragonbot/db */}
            <input
              type="number"
              className={TEXT_INPUT_CLASS}
              value={repeatCountText ?? String(settings.repeatSpamChannelCount)}
              onChange={(e) => {
                setRepeatCountText(e.target.value);
                // A valid in-range number counts at once, so Save enables while typing and a click on it can't beat the blur
                const n = Number(e.target.value);
                if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= 2 && n <= 10) update("repeatSpamChannelCount", n);
              }}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) update("repeatSpamChannelCount", Math.min(10, Math.max(2, n)));
                setRepeatCountText(null);
              }}
              min={2}
              max={10}
            />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Matching</label>
            <select
              className={SELECT_CLASS}
              value={settings.repeatSpamMatchMode}
              onChange={(e) => update("repeatSpamMatchMode", e.target.value === "exact" ? "exact" : e.target.value === "similar" ? "similar" : "ignore_case")}
            >
              <option value="exact">Word for word, case-sensitive</option>
              <option value="ignore_case">Word for word, ignoring case</option>
              <option value="similar">Too similar</option>
            </select>
          </div>
          <p className="text-xs text-dc-text-muted">Kicks an account that posts the same message in several different channels within a minute, and cleans up its messages from the last hour. Short messages like &quot;gm&quot; never count. Verified members and staff are never affected.</p>
        </div>
        <div className="border-t border-dc-border pt-3 mt-1 space-y-1 text-xs text-dc-text-muted">
          <p>Changing these settings needs Manage Server or full dashboard access.</p>
          <p>Honeypot bans are never copied to other servers by ban sync.</p>
        </div>
      </Section>

      <Section title="Suggestions">
        <Toggle label="Enable suggestions" checked={settings.isSuggestionsEnabled} onChange={(v) => update("isSuggestionsEnabled", v)} />
      </Section>

      <Section title="AI / Ask">
        <Toggle label="Enable /ask command" checked={settings.isAskEnabled} onChange={(v) => update("isAskEnabled", v)} />
        <div>
          <label className={FIELD_LABEL_CLASS}>System Prompt</label>
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
          <label className={FIELD_LABEL_CLASS}>Image URLs</label>
          <TagInput values={settings.offtopicImages} onChange={(v) => update("offtopicImages", v)} placeholder="Paste image URL and press Enter" />
        </div>
      </Section>

      <Section title="XP / Leveling">
        <Toggle label="Enable XP system" checked={settings.isXpEnabled} onChange={(v) => update("isXpEnabled", v)} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={FIELD_LABEL_CLASS}>Min XP per Message</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.xpMin} onChange={(e) => update("xpMin", parseInt(e.target.value) || 1)} min={1} max={1000} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Max XP per Message</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.xpMax} onChange={(e) => update("xpMax", parseInt(e.target.value) || 1)} min={1} max={1000} />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Cooldown (seconds)</label>
            <input type="number" className={TEXT_INPUT_CLASS} value={settings.xpCooldownSeconds} onChange={(e) => update("xpCooldownSeconds", parseInt(e.target.value) || 0)} min={0} max={3600} />
          </div>
        </div>
        <ChannelSelect label="Level-up Announcement Channel" value={settings.xpLevelupChannelId} onChange={(v) => update("xpLevelupChannelId", v)} channels={channels} filterType="text" />
        <div>
          <label className={FIELD_LABEL_CLASS}>Excluded Channels (no XP earned)</label>
          <MultiSelect
            items={filterTextChannels(channels).map((c) => ({ id: c.id, label: `# ${c.name}` }))}
            selected={settings.xpExcludedChannelIds}
            onChange={(v) => update("xpExcludedChannelIds", v)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS}>Excluded Roles (no XP earned)</label>
          <MultiSelect
            items={roles.map((r) => ({ id: r.id, label: `@ ${r.name}` }))}
            selected={settings.xpExcludedRoleIds}
            onChange={(v) => update("xpExcludedRoleIds", v)}
          />
        </div>
      </Section>

      <Section title="Birthdays">
        <Toggle label="Enable birthday announcements" checked={settings.isBirthdayEnabled} onChange={(v) => update("isBirthdayEnabled", v)} />
        <ChannelSelect label="Birthday Announcement Channel" value={settings.birthdayChannelId} onChange={(v) => update("birthdayChannelId", v)} channels={channels} filterType="text" />
        <RoleSelect label="Birthday Role (assigned for the day)" value={settings.birthdayRoleId} onChange={(v) => update("birthdayRoleId", v)} roles={roles} />
        <div>
          <label className={FIELD_LABEL_CLASS}>Custom Message (optional)</label>
          <textarea
            className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent resize-y min-h-16 transition-colors"
            value={settings.birthdayMessage ?? ""}
            onChange={(e) => update("birthdayMessage", e.target.value || null)}
            placeholder="Happy {age} birthday {user}! 🎂🎉"
          />
          <p className="text-xs text-dc-text-muted mt-1">Use <code className="text-dc-accent">{"{user}"}</code> for the mention and <code className="text-dc-accent">{"{age}"}</code> for the ordinal age (e.g. 27th). Leave blank for default.</p>
        </div>
        <div>
          <label className={FIELD_LABEL_CLASS}>Timezone</label>
          <select
            className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer transition-colors"
            value={settings.birthdayTimezone}
            onChange={(e) => update("birthdayTimezone", e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <p className="text-xs text-dc-text-muted mt-1">Birthdays are announced at 9 AM in this timezone.</p>
        </div>
      </Section>

      {/* Sticky unsaved changes banner */}
      {isDirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-dc-bg-tertiary border border-dc-border rounded-lg px-5 py-3 shadow-xl">
          <span className="text-sm text-dc-text-primary">Careful — you have unsaved changes!</span>
          <button
            type="button"
            onClick={() => { setSettings(savedSettings); setMessage(null); setShowHoneypotChannelHint(false); }}
            className="text-sm text-dc-text-secondary hover:text-dc-text-primary transition-colors cursor-pointer"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-dc-success hover:bg-dc-success/80 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      )}

    </div>
  );
}
