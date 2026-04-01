"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Suggestion {
  id: string;
  guildId: string;
  discordId: string;
  discordUsername: string;
  suggestion: string;
  status: string;
  createdAt: string;
}

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "completed" | "archived";

const STATUS_OPTIONS = ["pending", "approved", "rejected", "completed"] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-dc-success/20 text-dc-success",
  rejected: "bg-dc-danger/20 text-dc-danger",
  completed: "bg-dc-accent/20 text-dc-accent",
  archived: "bg-dc-border text-dc-text-muted",
};

export default function SuggestionsPage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/server/${guildId}/suggestions`, { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) { window.location.href = "/"; return; }
        if (res.status === 403) { setError("No permission."); setLoading(false); return; }
        if (res.ok) setSuggestions(await res.json());
        setLoading(false);
      })
      .catch(() => { setError("Failed to load."); setLoading(false); });
  }, [guildId]);

  async function handleStatusChange(id: string, newStatus: string) {
    const res = await fetch(`/api/server/${guildId}/suggestions/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSuggestions(suggestions.map((s) => (s.id === id ? updated : s)));
      setMessage({ type: "success", text: `Suggestion marked as ${newStatus}.` });
    } else {
      setMessage({ type: "error", text: "Failed to update status." });
    }
  }

  async function handleArchive(id: string) {
    const res = await fetch(`/api/server/${guildId}/suggestions/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      const updated = await res.json();
      setSuggestions(suggestions.map((s) => (s.id === id ? updated : s)));
      setMessage({ type: "success", text: "Suggestion archived." });
    }
    setDeleteConfirmId(null);
  }

  async function handleUnarchive(id: string) {
    await handleStatusChange(id, "pending");
  }

  const filtered = filter === "all"
    ? suggestions.filter((s) => s.status !== "archived")
    : suggestions.filter((s) => s.status === filter);
  const counts = {
    all: suggestions.filter((s) => s.status !== "archived").length,
    pending: suggestions.filter((s) => s.status === "pending").length,
    approved: suggestions.filter((s) => s.status === "approved").length,
    rejected: suggestions.filter((s) => s.status === "rejected").length,
    completed: suggestions.filter((s) => s.status === "completed").length,
    archived: suggestions.filter((s) => s.status === "archived").length,
  };

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
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Suggestions</h1>
        <p className="text-dc-text-muted text-sm mt-0.5">Review and manage feature suggestions from members</p>
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

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {(["all", "pending", "approved", "rejected", "completed", "archived"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer capitalize whitespace-nowrap ${
              filter === f
                ? "bg-dc-accent text-white"
                : "bg-dc-bg-secondary text-dc-text-muted hover:text-dc-text-secondary"
            }`}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Suggestion list */}
      {filtered.length === 0 && (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8 text-center">
          <p className="text-dc-text-muted">
            {filter === "all" ? "No suggestions yet." : `No ${filter} suggestions.`}
          </p>
          {filter === "all" && (
            <p className="text-dc-text-muted text-sm mt-1">Members can submit suggestions with the /suggest command.</p>
          )}
        </div>
      )}

      {filtered.map((s) => (
        <div key={s.id} className="bg-dc-bg-secondary border border-dc-border rounded-lg p-4 mb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-medium text-dc-text-primary">{s.discordUsername}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${STATUS_COLORS[s.status] ?? "bg-dc-border text-dc-text-muted"}`}>
                  {s.status}
                </span>
              </div>
              <p className="text-sm text-dc-text-secondary whitespace-pre-wrap break-words">{s.suggestion}</p>
              <p className="text-xs text-dc-text-muted mt-2">
                {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {s.status === "archived" ? (
                <button
                  onClick={() => handleUnarchive(s.id)}
                  className="px-2 py-1 text-xs text-dc-text-muted hover:text-dc-accent transition-colors cursor-pointer"
                >
                  Unarchive
                </button>
              ) : (
                <>
                  <select
                    className="px-2 py-1 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-xs outline-none focus:border-dc-accent cursor-pointer"
                    value={s.status}
                    onChange={(e) => handleStatusChange(s.id, e.target.value)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setDeleteConfirmId(s.id)}
                    className="text-dc-text-muted hover:text-dc-danger transition-colors cursor-pointer text-xs px-1"
                    title="Archive"
                  >
                    Archive
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Delete confirmation modal */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-dc-text-primary mb-2">Archive Suggestion</h3>
            <p className="text-sm text-dc-text-secondary mb-6">Are you sure you want to archive this suggestion? You can unarchive it later.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-sm text-dc-text-secondary hover:text-dc-text-primary bg-dc-bg-tertiary rounded-md transition-colors cursor-pointer">Cancel</button>
              <button onClick={() => handleArchive(deleteConfirmId)} className="px-4 py-2 text-sm text-white bg-dc-danger hover:bg-dc-danger/80 rounded-md transition-colors cursor-pointer">Archive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
