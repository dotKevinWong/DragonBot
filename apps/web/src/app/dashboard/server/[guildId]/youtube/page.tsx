"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Subscription {
  id: string;
  guildId: string;
  youtubeChannelId: string;
  youtubeChannelName: string | null;
  notifyChannelId: string;
  customMessage: string | null;
  lastVideoId: string | null;
  isEnabled: boolean;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: string;
}

export default function YouTubePage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formSearch, setFormSearch] = useState("");
  const [formYtChannel, setFormYtChannel] = useState("");
  const [formYtName, setFormYtName] = useState("");
  const [formNotifyChannel, setFormNotifyChannel] = useState("");
  const [formCustomMessage, setFormCustomMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Subscription>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/server/${guildId}/youtube`, { credentials: "same-origin" }),
      fetch(`/api/server/${guildId}/discord`, { credentials: "same-origin" }),
    ]).then(async ([ytRes, discordRes]) => {
      if (ytRes.status === 401) { window.location.href = "/"; return; }
      if (ytRes.status === 403) { setError("No permission."); setLoading(false); return; }
      if (ytRes.ok) setSubs(await ytRes.json());
      if (discordRes.ok) {
        const data = await discordRes.json();
        setChannels(data.channels ?? []);
      }
      setLoading(false);
    }).catch(() => { setError("Failed to load."); setLoading(false); });
  }, [guildId]);

  async function handleResolve() {
    if (!formSearch.trim()) return;
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/server/${guildId}/youtube/resolve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: formSearch.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setFormYtChannel(data.channelId);
        setFormYtName(data.channelName);
        setResolveError(null);
      } else {
        const data = await res.json();
        setResolveError(data.error ?? "Could not find channel.");
        setFormYtChannel("");
        setFormYtName("");
      }
    } catch {
      setResolveError("Failed to look up channel.");
    }
    setResolving(false);
  }

  async function handleCreate() {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/server/${guildId}/youtube`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        youtubeChannelId: formYtChannel.trim(),
        youtubeChannelName: formYtName.trim() || null,
        notifyChannelId: formNotifyChannel,
        customMessage: formCustomMessage.trim() || null,
      }),
    });
    if (res.ok) {
      const newSub = await res.json();
      setSubs([...subs, newSub]);
      setShowForm(false);
      setFormSearch("");
      setFormYtChannel("");
      setFormYtName("");
      setFormCustomMessage("");
      setMessage({ type: "success", text: "YouTube subscription added!" });
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to create." });
    }
    setSaving(false);
  }

  async function handleToggle(id: string, currentlyEnabled: boolean) {
    const res = await fetch(`/api/server/${guildId}/youtube/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !currentlyEnabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSubs(subs.map((s) => (s.id === id ? updated : s)));
    }
  }

  function startEdit(s: Subscription) {
    setEditingId(s.id);
    setEditData({
      notifyChannelId: s.notifyChannelId,
      youtubeChannelName: s.youtubeChannelName,
      customMessage: s.customMessage,
    });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setSaving(true);
    const res = await fetch(`/api/server/${guildId}/youtube/${editingId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    if (res.ok) {
      const updated = await res.json();
      setSubs(subs.map((s) => (s.id === editingId ? updated : s)));
      setEditingId(null);
      setEditData({});
      setMessage({ type: "success", text: "Subscription updated!" });
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to update." });
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/server/${guildId}/youtube/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      setSubs(subs.filter((s) => s.id !== id));
      setMessage({ type: "success", text: "Subscription deleted." });
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
          <h1 className="text-2xl font-bold">YouTube Notifications</h1>
          <p className="text-dc-text-muted text-sm mt-0.5">Get notified when YouTube channels upload new videos</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-dc-accent hover:bg-dc-accent-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
        >
          {showForm ? "Cancel" : "+ Add Channel"}
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

      {showForm && (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-6">
          <h2 className="text-sm font-semibold text-dc-text-primary mb-4">Add YouTube Channel</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">YouTube Channel</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent"
                  value={formSearch}
                  onChange={(e) => setFormSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleResolve(); } }}
                  placeholder="Paste URL, @handle, or channel name"
                />
                <button
                  onClick={handleResolve}
                  disabled={resolving || !formSearch.trim()}
                  className="px-4 py-2 bg-dc-accent hover:bg-dc-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
                >
                  {resolving ? "Looking up..." : "Look up"}
                </button>
              </div>
              {resolveError && (
                <p className="text-xs text-dc-danger mt-1">{resolveError}</p>
              )}
              {formYtChannel && (
                <div className="mt-2 px-3 py-2 bg-dc-bg-tertiary/50 border border-dc-border rounded-md">
                  <p className="text-sm text-dc-text-primary font-medium">{formYtName || formYtChannel}</p>
                  <p className="text-xs text-dc-text-muted font-mono">{formYtChannel}</p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Notification Channel</label>
              <select
                className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer"
                value={formNotifyChannel}
                onChange={(e) => setFormNotifyChannel(e.target.value)}
              >
                <option value="">Select a channel</option>
                {textChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}># {ch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Custom Message (optional)</label>
              <textarea
                className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent resize-y min-h-20"
                value={formCustomMessage}
                onChange={(e) => setFormCustomMessage(e.target.value)}
                placeholder="Use {title}, {url}, {channel} as placeholders"
              />
              <p className="text-xs text-dc-text-muted mt-1">
                Leave blank for default: &quot;**Channel** just uploaded a new video!&quot;
              </p>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={handleCreate}
                disabled={saving || !formYtChannel || !formNotifyChannel}
                className="px-4 py-2 bg-dc-success hover:bg-dc-success/80 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {saving ? "Adding..." : "Add Channel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {subs.length === 0 && !showForm && (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8 text-center">
          <p className="text-dc-text-muted">No YouTube subscriptions yet.</p>
          <p className="text-dc-text-muted text-sm mt-1">Click &quot;+ Add Channel&quot; to get started.</p>
        </div>
      )}

      {subs.map((s) => {
        const channelName = channels.find((c) => c.id === s.notifyChannelId)?.name ?? s.notifyChannelId;
        const isEditing = editingId === s.id;

        if (isEditing) {
          return (
            <div key={s.id} className="bg-dc-bg-secondary border border-dc-accent rounded-lg p-5 mb-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-dc-text-primary">
                  Editing: {s.youtubeChannelName ?? s.youtubeChannelId}
                </h3>
                <button onClick={() => { setEditingId(null); setEditData({}); }} className="text-dc-text-muted hover:text-dc-text-secondary text-xs cursor-pointer">Cancel</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Channel Name</label>
                  <input className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent" value={editData.youtubeChannelName ?? ""} onChange={(e) => setEditData({ ...editData, youtubeChannelName: e.target.value || null })} placeholder="Display name" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Notification Channel</label>
                  <select className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent cursor-pointer" value={editData.notifyChannelId ?? ""} onChange={(e) => setEditData({ ...editData, notifyChannelId: e.target.value })}>
                    {textChannels.map((ch) => (<option key={ch.id} value={ch.id}># {ch.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">Custom Message</label>
                  <textarea className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent resize-y min-h-20" value={editData.customMessage ?? ""} onChange={(e) => setEditData({ ...editData, customMessage: e.target.value || null })} placeholder="Use {title}, {url}, {channel} as placeholders" />
                </div>
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
                  <span className="text-sm font-medium text-dc-text-primary">
                    {s.youtubeChannelName ?? s.youtubeChannelId}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${s.isEnabled ? "bg-dc-success/20 text-dc-success" : "bg-dc-border text-dc-text-muted"}`}>
                    {s.isEnabled ? "Active" : "Paused"}
                  </span>
                </div>
                <p className="text-xs text-dc-text-muted">Posting to #{channelName}</p>
                {s.customMessage && <p className="text-xs text-dc-text-muted mt-0.5 truncate">Template: {s.customMessage}</p>}
                {!s.youtubeChannelName && <p className="text-xs text-dc-text-muted mt-0.5 font-mono">{s.youtubeChannelId}</p>}
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <button onClick={() => startEdit(s)} className="text-dc-text-muted hover:text-dc-accent transition-colors cursor-pointer text-xs">Edit</button>
                <button onClick={() => handleToggle(s.id, s.isEnabled)} className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${s.isEnabled ? "bg-dc-accent" : "bg-dc-border"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-[left] ${s.isEnabled ? "left-[20px]" : "left-0.5"}`} />
                </button>
                <button onClick={() => setDeleteConfirmId(s.id)} className="text-dc-text-muted hover:text-dc-danger transition-colors cursor-pointer text-sm">&#x2715;</button>
              </div>
            </div>
          </div>
        );
      })}

      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-dc-text-primary mb-2">Remove Subscription</h3>
            <p className="text-sm text-dc-text-secondary mb-6">Are you sure you want to remove this YouTube subscription? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-sm text-dc-text-secondary hover:text-dc-text-primary bg-dc-bg-tertiary rounded-md transition-colors cursor-pointer">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirmId)} className="px-4 py-2 text-sm text-white bg-dc-danger hover:bg-dc-danger/80 rounded-md transition-colors cursor-pointer">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
