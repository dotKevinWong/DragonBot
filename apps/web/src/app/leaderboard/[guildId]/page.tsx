"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

interface LeaderboardEntry {
  discordId: string;
  totalXp: number;
  level: number;
  messageCount: number;
  xpMessageCount: number;
  displayName: string;
  avatarUrl: string | null;
}

export default function PublicLeaderboardPage() {
  const params = useParams();
  const guildId = params.guildId as string;
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [guildName, setGuildName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/leaderboard/${guildId}`)
      .then(async (res) => {
        if (res.status === 404) { setError("Server not found."); setLoading(false); return; }
        if (!res.ok) { setError("Failed to load leaderboard."); setLoading(false); return; }
        const data = await res.json();
        setGuildName(data.guildName);
        setEntries(data.entries);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load leaderboard."); setLoading(false); });
  }, [guildId]);

  return (
    <div className="min-h-screen bg-dc-bg-primary text-dc-text-primary">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Image src="/dragonbot.png" alt="DragonBot" width={36} height={36} className="rounded-lg" />
          <div>
            <h1 className="text-2xl font-bold">Leaderboard</h1>
            <p className="text-dc-text-muted text-sm">{guildName ?? guildId}</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-dc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && <p className="text-dc-danger">{error}</p>}

        {!loading && !error && entries.length === 0 && (
          <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8 text-center">
            <p className="text-dc-text-muted">No XP data yet.</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="bg-dc-bg-secondary border border-dc-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dc-border">
                  <th className="text-left text-xs font-semibold text-dc-text-secondary uppercase tracking-wide px-4 py-3 w-12">#</th>
                  <th className="text-left text-xs font-semibold text-dc-text-secondary uppercase tracking-wide px-4 py-3">User</th>
                  <th className="text-right text-xs font-semibold text-dc-text-secondary uppercase tracking-wide px-4 py-3">Level</th>
                  <th className="text-right text-xs font-semibold text-dc-text-secondary uppercase tracking-wide px-4 py-3">XP</th>
                  <th className="text-right text-xs font-semibold text-dc-text-secondary uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Messages</th>
                  <th className="text-right text-xs font-semibold text-dc-text-secondary uppercase tracking-wide px-4 py-3 hidden sm:table-cell">XP Msgs</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr
                    key={entry.discordId}
                    className={`border-b border-dc-border last:border-b-0 ${i < 3 ? "bg-dc-bg-tertiary/30" : ""}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="text-dc-text-muted">{i + 1}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-dc-text-primary font-medium">
                      <div className="flex items-center gap-2">
                        {entry.avatarUrl ? (
                          <img src={entry.avatarUrl} alt="" className="w-6 h-6 rounded-full shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-dc-bg-tertiary shrink-0" />
                        )}
                        {entry.displayName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-dc-text-secondary text-right">
                      {entry.level}
                    </td>
                    <td className="px-4 py-3 text-sm text-dc-text-secondary text-right">
                      {entry.totalXp.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-dc-text-muted text-right hidden sm:table-cell">
                      {entry.messageCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-dc-text-muted text-right hidden sm:table-cell">
                      {entry.xpMessageCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-dc-text-muted mt-4 text-center">
          Powered by DragonBot
        </p>
      </div>
    </div>
  );
}
