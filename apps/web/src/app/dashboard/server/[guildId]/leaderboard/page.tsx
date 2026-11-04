"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { redirectIfUnauthorized } from "@/lib/client-fetch";

export default function LeaderboardPage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch(`/api/server/${guildId}/leaderboard`, { credentials: "same-origin" })
      .then(async (res) => {
        if (redirectIfUnauthorized(res)) return;
        if (res.status === 403) { setError("You don't have permission to view this server."); setLoading(false); return; }
        if (!res.ok) { setError("Failed to load leaderboard."); setLoading(false); return; }
        const data = await res.json();
        setEntries(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load leaderboard."); setLoading(false); });

    // Check if user has admin access (to show/hide settings link)
    fetch(`/api/server/${guildId}`, { credentials: "same-origin" })
      .then((res) => { if (res.ok) setIsAdmin(true); })
      .catch(() => {});
  }, [guildId]);

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
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="text-dc-text-muted text-sm mt-0.5">Top members by XP</p>
        </div>
        {isAdmin && (
          <Link
            href={`/dashboard/server/${guildId}`}
            className="text-sm text-dc-accent hover:underline"
          >
            ← Back to Settings
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8 text-center">
          <p className="text-dc-text-muted">No XP data yet. XP is earned by sending messages in the server.</p>
        </div>
      ) : (
        <LeaderboardTable entries={entries} />
      )}

      <p className="text-xs text-dc-text-muted mt-4">
        Note: Leaderboard data is synced from the bot every few hours. Recent XP may not be reflected yet.
      </p>
    </div>
  );
}
