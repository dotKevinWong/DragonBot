"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CronBuilder } from "@/components/cron-builder";
import type { DiscordChannel } from "@/lib/guild-settings";
import { cronToHuman } from "@/lib/cron-text";
import { TIMEZONES } from "@/lib/timezones";
import { canWriteScope, missingScopeNote } from "@/lib/viewer-scopes";
import { useViewerScopes } from "@/lib/use-viewer-scopes";
import {
  createFeatureItem,
  deleteFeatureItem,
  filterTextChannels,
  loadFeatureList,
  saveFeatureItemEdit,
  toggleFeatureItem,
  type FeatureList,
} from "@/lib/feature-list";

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
  const [formTimezone, setFormTimezone] = useState("America/New_York");
  const [formIsEmbed, setFormIsEmbed] = useState(false);
  const [formEmbedTitle, setFormEmbedTitle] = useState("");
  const [formEmbedColor, setFormEmbedColor] = useState("#5865f2");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Schedule>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showReloadHint, setShowReloadHint] = useState(false);
  const canWrite = canWriteScope(useViewerScopes(guildId), "schedules");

  useEffect(() => {
    loadFeatureList({ guildId, resource: "schedules", setItems: setSchedules, setChannels, setError, setLoading });
  }, [guildId]);

  const list: FeatureList<Schedule> = {
    basePath: `/api/server/${guildId}/schedules`,
    items: schedules,
    setItems: setSchedules,
    setSaving,
    setMessage,
    onChanged: () => setShowReloadHint(true),
  };

  async function handleCreate() {
    await createFeatureItem(
      list,
      {
        channelId: formChannel,
        message: formMessage,
        cronExpression: formCron,
        timezone: formTimezone,
        isEmbed: formIsEmbed,
        embedTitle: formIsEmbed && formEmbedTitle ? formEmbedTitle : null,
        embedColor: formIsEmbed ? formEmbedColor : null,
      },
      "Schedule created!",
      () => {
        setShowForm(false);
        setFormMessage("");
        setFormEmbedTitle("");
      },
    );
  }

  async function handleToggle(id: string, currentlyEnabled: boolean) {
    await toggleFeatureItem(list, id, currentlyEnabled);
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
    await saveFeatureItemEdit(list, editingId, editData, "Schedule updated!", () => {
      setEditingId(null);
      setEditData({});
    });
  }

  async function handleDelete(id: string) {
    await deleteFeatureItem(list, id, "Schedule deleted.", () => setDeleteConfirmId(null));
  }

  const textChannels = filterTextChannels(channels);

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
        {canWrite && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-dc-accent hover:bg-dc-accent-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
          >
            {showForm ? "Cancel" : "+ New Schedule"}
          </button>
        )}
      </div>

      {!canWrite && <p className="text-dc-text-muted text-sm mb-6">{missingScopeNote("schedules")}</p>}

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
        <div className="px-4 py-3 rounded-md mb-6 text-sm bg-dc-success/10 border border-dc-success/30 text-dc-success flex items-start gap-2">
          <span className="shrink-0 mt-0.5">✓</span>
          <div>
            <p>Changes saved and synced to the bot.</p>
            <button onClick={() => setShowReloadHint(false)} className="text-xs text-dc-text-muted hover:text-dc-text-secondary mt-1 cursor-pointer">Dismiss</button>
          </div>
        </div>
      )}

      {/* New schedule form */}
      {showForm && canWrite && (
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

            <div className="bg-dc-bg-tertiary/50 border border-dc-border rounded-lg p-4">
              <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-3">Schedule</label>
              <CronBuilder value={formCron} onChange={setFormCron} />
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
      {schedules.length === 0 && !(showForm && canWrite) && (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8 text-center">
          <p className="text-dc-text-muted">No scheduled messages yet.</p>
          {canWrite && <p className="text-dc-text-muted text-sm mt-1">Click &quot;+ New Schedule&quot; to create one.</p>}
        </div>
      )}

      {schedules.map((s, idx) => {
        const channelName = channels.find((c) => c.id === s.channelId)?.name ?? s.channelId;
        const isEditing = canWrite && editingId === s.id;

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
                <div className="bg-dc-bg-tertiary/50 border border-dc-border rounded-lg p-4">
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-3">Schedule</label>
                  <CronBuilder value={editData.cronExpression ?? "0 9 * * *"} onChange={(cron) => setEditData({ ...editData, cronExpression: cron })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Timezone</label>
                  <select className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer" value={editData.timezone ?? "America/New_York"} onChange={(e) => setEditData({ ...editData, timezone: e.target.value })}>
                    {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
                  </select>
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
              {canWrite && (
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
              )}
            </div>
          </div>
        );
      })}

      {/* Delete confirmation modal */}
      {deleteConfirmId !== null && canWrite && (
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
