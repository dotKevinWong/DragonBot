// The leaderboard table shared by the public leaderboard page and the dashboard leaderboard page.
// Markup moved verbatim from both pages (they were identical apart from indentation); each page
// keeps its own loading, error, empty state, header and footer. Pinned by
// tests/components/leaderboard-table.test.ts. The entry type is a type-only import, so the
// server-only query in lib/leaderboard.ts never reaches the browser bundle.
import type { LeaderboardEntry } from "@/lib/leaderboard";

/** `startRank` is the rank of the first entry (for later pages); medals and highlighting go to ranks 1 to 3. */
export function LeaderboardTable({ entries, startRank = 1 }: { entries: LeaderboardEntry[]; startRank?: number }) {
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
          {entries.map((entry, idx) => {
            const i = startRank - 1 + idx;
            return (
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
