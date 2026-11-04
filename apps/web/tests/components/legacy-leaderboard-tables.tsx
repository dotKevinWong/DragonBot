// Verbatim copies of the leaderboard table markup at git HEAD d09dc0c, each wrapped in a component:
//   LegacyDashboardTable: apps/web/src/app/dashboard/server/[guildId]/leaderboard/page.tsx lines 74-121
//   LegacyPublicTable: apps/web/src/app/leaderboard/[guildId]/page.tsx lines 65-112
// Only the wrapper (the function, its `entries` parameter and `return (`) is new. Kept so the
// characterization tests can prove <LeaderboardTable> renders the same HTML. Do not edit.
/* eslint-disable @next/next/no-img-element */
import type { LeaderboardEntry } from "@/lib/leaderboard";

export function LegacyDashboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
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
  );
}

export function LegacyPublicTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
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
  );
}
