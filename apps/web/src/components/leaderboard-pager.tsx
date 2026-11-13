import { SECONDARY_BUTTON_CLASS } from "@/lib/form-classes";

/** Rows per leaderboard page. Pages ask for one extra row to know whether a next page exists. */
export const LEADERBOARD_PAGE_SIZE = 10;

/** The API query for a zero-based page. */
export function leaderboardPageQuery(page: number): string {
  return `offset=${page * LEADERBOARD_PAGE_SIZE}&limit=${LEADERBOARD_PAGE_SIZE + 1}`;
}

/** Splits a fetched page into the rows to show and whether there are more. */
export function splitLeaderboardPage<T>(rows: T[]): { rows: T[]; hasMore: boolean } {
  return { rows: rows.slice(0, LEADERBOARD_PAGE_SIZE), hasMore: rows.length > LEADERBOARD_PAGE_SIZE };
}

export function LeaderboardPager({ page, hasMore, loading, onChange }: {
  page: number;
  hasMore: boolean;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  if (page === 0 && !hasMore) return null;
  const first = page * LEADERBOARD_PAGE_SIZE + 1;
  return (
    <div className="flex items-center justify-between gap-3 mt-3">
      <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={page === 0 || loading} onClick={() => onChange(page - 1)}>
        ← Previous
      </button>
      <span className="text-sm text-dc-text-muted">
        Ranks {first}–{first + LEADERBOARD_PAGE_SIZE - 1}
      </span>
      <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={!hasMore || loading} onClick={() => onChange(page + 1)}>
        Next →
      </button>
    </div>
  );
}
