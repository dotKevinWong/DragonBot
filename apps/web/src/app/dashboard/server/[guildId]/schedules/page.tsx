"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Schedule {
  id: string;
  guildId: string;
  channelId: string;
  message: string;
  cronExpression: string;
  timezone: string;
  isEnabled: boolean;
  isEmbed: boolean;
  embedColor: string | null;
  embedTitle: string | null;
  lastRunAt: string | null;
  createdBy: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: string;
}

const PRESET_INTERVALS = [
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at 9 AM", cron: "0 9 * * *" },
  { label: "Daily at 12 PM", cron: "0 12 * * *" },
  { label: "Weekdays at 9 AM", cron: "0 9 * * 1-5" },
  { label: "Weekly on Monday at 9 AM", cron: "0 9 * * 1" },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "UTC",
];

function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} min`;
  if (min === "0" && hour === "*") return "Hourly";
  if (min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)}h`;

  const h = parseInt(hour);
  const m = parseInt(min);
  if (!isNaN(h) && !isNaN(m)) {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const timeStr = m === 0 ? `${h12}${period}` : `${h12}:${m.toString().padStart(2, "0")}${period}`;
    if (dow === "*") return `Daily ${timeStr}`;
    if (dow === "1-5") return `Weekdays ${timeStr}`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const d = parseInt(dow);
    if (!isNaN(d) && d >= 0 && d <= 6) return `${days[d]} ${timeStr}`;
  }
  return cron;
}

export default function SchedulesPage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New schedule form
  const [showForm, setShowForm] = useState(false);
  const [formChannel, setFormChannel] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formCron, setFormCron] = useState("0 9 * * *");
  const [formCustomCron, setFormCustomCron] = useState("");
  const [formTimezone, setFormTimezone] = useState("America/New_York");
  const [formIsEmbed, setFormIsEmbed] = useState(false);
  const [formEmbedTitle, setFormEmbedTitle] = useState("");
  const [formEmbedColor, setFormEmbedColor] = useState("#5865f2");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Schedule>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showReloadHint, setShowReloadHint] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/server/${guildId}/schedules`, { credentials: "same-origin" }),
      fetch(`/api/server/${guildId}/discord`, { credentials: "same-origin" }),
    ]).then(async ([schedRes, discordRes]) => {
      if (schedRes.status === 401) { window.location.href = "/"; return; }
      if (schedRes.status === 403) { setError("No permission."); setLoading(false); return; }
      if (schedRes.ok) setSchedules(await schedRes.json());
      if (discordRes.ok) {
        const data = await discordRes.json();
        setChannels(data.channels ?? []);
      }
      setLoading(false);
    }).catch(() => { setError("Failed to load."); setLoading(false); });
  }, [guildId]);

  async function handleCreate() {
    setSaving(true);
    setMessage(null);
    const cronExpr = formCron === "custom" ? formCustomCron : formCron;

    const res = await fetch(`/api/server/${guildId}/schedules`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: formChannel,
        message: formMessage,
        cronExpression: cronExpr,
        timezone: formTimezone,
        isEmbed: formIsEmbed,
        embedTitle: formIsEmbed && formEmbedTitle ? formEmbedTitle : null,
        embedColor: formIsEmbed ? formEmbedColor : null,
      }),
    });

    if (res.ok) {
      const newSchedule = await res.json();
      setSchedules([...schedules, newSchedule]);
      setShowForm(false);
      setFormMessage("");
      setFormEmbedTitle("");
      setMessage({ type: "success", text: "Schedule created!" });
      setShowReloadHint(true);
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to create." });
    }
    setSaving(false);
  }

  async function handleToggle(id: string, currentlyEnabled: boolean) {
    const res = await fetch(`/api/server/${guildId}/schedules/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !currentlyEnabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSchedules(schedules.map((s) => (s.id === id ? updated : s)));
      setShowReloadHint(true);
    }
  }

  function startEdit(s: Schedule) {
    setEditingId(s.id);
    setEditData({
      channelId: s.channelId,
      message: s.message,
      cronExpression: s.cronExpression,
      timezone: s.timezone,
      isEmbed: s.isEmbed,
      embedTitle: s.embedTitle,
      embedColor: s.embedColor,
    });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setSaving(true);
    const res = await fetch(`/api/server/${guildId}/schedules/${editingId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    if (res.ok) {
      const updated = await res.json();
      setSchedules(schedules.map((s) => (s.id === editingId ? updated : s)));
      setEditingId(null);
      setEditData({});
      setMessage({ type: "success", text: "Schedule updated!" });
      setShowReloadHint(true);
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to update." });
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/server/${guildId}/schedules/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      setSchedules(schedules.filter((s) => s.id !== id));
      setMessage({ type: "success", text: "Schedule deleted." });
      setShowReloadHint(true);
    }
    setDeleteConfirmId(null);
  }

  const textChannels = channels.filter((c) => c.type === "text" || c.type === "announcement");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-dc-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) return <p className="text-dc-danger">{error}</p>;

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Scheduled Messages</h1>
          <p className="text-dc-text-muted text-sm mt-0.5">Automated messages sent on a schedule</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-dc-accent hover:bg-dc-accent-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
        >
          {showForm ? "Cancel" : "+ New Schedule"}
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

      {showReloadHint && (
        <div className="px-4 py-3 rounded-md mb-6 text-sm bg-dc-warning/10 border border-dc-warning/30 text-dc-warning flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠️</span>
          <div>
            <p>Run <code className="bg-dc-bg-tertiary px-1.5 py-0.5 rounded text-xs">/schedule reload</code> in Discord to apply these changes to the bot.</p>
            <button onClick={() => setShowReloadHint(false)} className="text-xs text-dc-text-muted hover:text-dc-text-secondary mt-1 cursor-pointer">Dismiss</button>
          </div>
        </div>
      )}

      {/* New schedule form */}
      {showForm && (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-6">
          <h2 className="text-sm font-semibold text-dc-text-primary mb-4">New Scheduled Message</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Channel</label>
              <select
                className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
                value={formChannel}
                onChange={(e) => setFormChannel(e.target.value)}
              >
                <option value="">Select a channel</option>
                {textChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}># {ch.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Message</label>
              <textarea
                className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent resize-y min-h-20"
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Message content (supports Discord markdown)"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Interval</label>
                <select
                  className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                >
                  {PRESET_INTERVALS.map((p) => (
                    <option key={p.cron} value={p.cron}>{p.label}</option>
                  ))}
                  <option value="custom">Custom cron...</option>
                </select>
                {formCron === "custom" && (
                  <input
                    className="w-full px-3 py-2 mt-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent"
                    value={formCustomCron}
                    onChange={(e) => setFormCustomCron(e.target.value)}
                    placeholder="*/30 * * * *"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Timezone</label>
                <select
                  className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
                  value={formTimezone}
                  onChange={(e) => setFormTimezone(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-dc-text-secondary">Send as embed</span>
              <button
                type="button"
                onClick={() => setFormIsEmbed(!formIsEmbed)}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${formIsEmbed ? "bg-dc-accent" : "bg-dc-border"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-[left] ${formIsEmbed ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>

            {formIsEmbed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Embed Title</label>
                  <input
                    className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent"
                    value={formEmbedTitle}
                    onChange={(e) => setFormEmbedTitle(e.target.value)}
                    placeholder="Optional title"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Embed Color</label>
                  <input
                    type="color"
                    className="w-full h-[38px] bg-dc-input border border-dc-border rounded-md cursor-pointer"
                    value={formEmbedColor}
                    onChange={(e) => setFormEmbedColor(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={handleCreate}
                disabled={saving || !formChannel || !formMessage}
                className="px-4 py-2 bg-dc-success hover:bg-dc-success/80 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {saving ? "Creating..." : "Create Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule list */}
      {schedules.length === 0 && !showForm && (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8 text-center">
          <p className="text-dc-text-muted">No scheduled messages yet.</p>
          <p className="text-dc-text-muted text-sm mt-1">Click &quot;+ New Schedule&quot; to create one.</p>
        </div>
      )}

      {schedules.map((s, idx) => {
        const channelName = channels.find((c) => c.id === s.channelId)?.name ?? s.channelId;
        const isEditing = editingId === s.id;

        if (isEditing) {
          return (
            <div key={s.id} className="bg-dc-bg-secondary border border-dc-accent rounded-lg p-5 mb-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-dc-text-primary">Editing Schedule #{idx + 1}</h3>
                <button onClick={() => { setEditingId(null); setEditData({}); }} className="text-dc-text-muted hover:text-dc-text-secondary text-xs cursor-pointer">Cancel</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Channel</label>
                  <select className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer" value={editData.channelId ?? ""} onChange={(e) => setEditData({ ...editData, channelId: e.target.value })}>
                    {textChannels.map((ch) => (<option key={ch.id} value={ch.id}># {ch.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Message</label>
                  <textarea className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent resize-y min-h-20" value={editData.message ?? ""} onChange={(e) => setEditData({ ...editData, message: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Cron Expression</label>
                    <select className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer" value={PRESET_INTERVALS.some((p) => p.cron === editData.cronExpression) ? editData.cronExpression : "custom"} onChange={(e) => { if (e.target.value !== "custom") setEditData({ ...editData, cronExpression: e.target.value }); }}>
                      {PRESET_INTERVALS.map((p) => (<option key={p.cron} value={p.cron}>{p.label}</option>))}
                      <option value="custom">Custom cron...</option>
                    </select>
                    {!PRESET_INTERVALS.some((p) => p.cron === editData.cronExpression) && (
                      <input className="w-full px-3 py-2 mt-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent" value={editData.cronExpression ?? ""} onChange={(e) => setEditData({ ...editData, cronExpression: e.target.value })} placeholder="*/30 * * * *" />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Timezone</label>
                    <select className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer" value={editData.timezone ?? "America/New_York"} onChange={(e) => setEditData({ ...editData, timezone: e.target.value })}>
                      {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-dc-text-secondary">Send as embed</span>
                  <button type="button" onClick={() => setEditData({ ...editData, isEmbed: !editData.isEmbed })} className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${editData.isEmbed ? "bg-dc-accent" : "bg-dc-border"}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-[left] ${editData.isEmbed ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
                {editData.isEmbed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Embed Title</label>
                      <input className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent" value={editData.embedTitle ?? ""} onChange={(e) => setEditData({ ...editData, embedTitle: e.target.value || null })} placeholder="Optional title" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Embed Color</label>
                      <input type="color" className="w-full h-[38px] bg-dc-input border border-dc-border rounded-md cursor-pointer" value={editData.embedColor ?? "#5865f2"} onChange={(e) => setEditData({ ...editData, embedColor: e.target.value })} />
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button onClick={handleSaveEdit} disabled={saving} className="px-4 py-2 bg-dc-success hover:bg-dc-success/80 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed">
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={s.id} className="bg-dc-bg-secondary border border-dc-border rounded-lg p-4 mb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-dc-text-muted">#{idx + 1}</span>
                  <span className="text-sm font-medium text-dc-text-primary">#{channelName}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${s.isEnabled ? "bg-dc-success/20 text-dc-success" : "bg-dc-border text-dc-text-muted"}`}>
                    {s.isEnabled ? "Active" : "Paused"}
                  </span>
                  {s.isEmbed && <span className="text-xs px-1.5 py-0.5 rounded bg-dc-accent/20 text-dc-accent">Embed</span>}
                </div>
                <p className="text-sm text-dc-text-secondary truncate">{s.message}</p>
                <p className="text-xs text-dc-text-muted mt-1">
                  {cronToHuman(s.cronExpression)} &middot; {s.timezone}
                  {s.lastRunAt && ` · Last: ${new Date(s.lastRunAt).toLocaleString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <button
                  onClick={() => startEdit(s)}
                  className="text-dc-text-muted hover:text-dc-accent transition-colors cursor-pointer text-xs"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleToggle(s.id, s.isEnabled)}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${s.isEnabled ? "bg-dc-accent" : "bg-dc-border"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-[left] ${s.isEnabled ? "left-[20px]" : "left-0.5"}`} />
                </button>
                <button
                  onClick={() => setDeleteConfirmId(s.id)}
                  className="text-dc-text-muted hover:text-dc-danger transition-colors cursor-pointer text-sm"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Delete confirmation modal */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-dc-text-primary mb-2">Delete Schedule</h3>
            <p className="text-sm text-dc-text-secondary mb-6">
              Are you sure you want to delete this schedule? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm text-dc-text-secondary hover:text-dc-text-primary bg-dc-bg-tertiary rounded-md transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 text-sm text-white bg-dc-danger hover:bg-dc-danger/80 rounded-md transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
