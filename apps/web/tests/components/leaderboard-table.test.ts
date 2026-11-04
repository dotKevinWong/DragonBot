import { describe, expect, it } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { LegacyDashboardTable, LegacyPublicTable } from "./legacy-leaderboard-tables";

// Audit D6 (page part). Both leaderboard pages rendered the same table; <LeaderboardTable>
// replaces both copies and must render byte-identical HTML.

function entry(i: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    discordId: `1000000000000000${i.toString().padStart(2, "0")}`,
    totalXp: 1234567 - i * 1000,
    level: 50 - i,
    messageCount: 98765 - i,
    xpMessageCount: 4321 - i,
    displayName: `User <${i}> & "co"`,
    avatarUrl: i % 2 === 0 ? `https://cdn.discordapp.com/avatars/${i}/a.png?x=1&y=2` : null,
    ...overrides,
  };
}

const FIXTURES: [string, LeaderboardEntry[]][] = [
  ["empty", []],
  ["one", [entry(0)]],
  ["five, mixed avatars, counts over 999", [0, 1, 2, 3, 4].map((i) => entry(i))],
  ["zeros and an empty avatar string", [entry(0, { totalXp: 0, level: 0, messageCount: 0, xpMessageCount: 0, avatarUrl: "" })]],
  ["twelve", Array.from({ length: 12 }, (_, i) => entry(i))],
];

const render = (C: ComponentType<{ entries: LeaderboardEntry[] }>, entries: LeaderboardEntry[]) =>
  renderToStaticMarkup(createElement(C, { entries }));

const impls: [string, ComponentType<{ entries: LeaderboardEntry[] }>][] = [
  ["public page HEAD copy", LegacyPublicTable],
  ["LeaderboardTable", LeaderboardTable],
];

describe("leaderboard table markup", () => {
  it.each(FIXTURES)("the two HEAD copies render the same HTML (%s)", (_name, entries) => {
    expect(render(LegacyPublicTable, entries)).toBe(render(LegacyDashboardTable, entries));
  });

  for (const [name, C] of impls) {
    it.each(FIXTURES)(`${name} renders the dashboard HEAD copy's HTML (%s)`, (_name, entries) => {
      expect(render(C, entries)).toBe(render(LegacyDashboardTable, entries));
    });
  }

  it("pins the first rows (medals, avatar or placeholder, toLocaleString columns)", () => {
    const html = render(LegacyDashboardTable, [entry(0), entry(1), entry(2), entry(3)]);
    expect(html).toContain("🥇");
    expect(html).toContain("🥈");
    expect(html).toContain("🥉");
    expect(html).toContain('<span class="text-dc-text-muted">4</span>');
    expect(html).toContain('<img src="https://cdn.discordapp.com/avatars/0/a.png?x=1&amp;y=2" alt="" class="w-6 h-6 rounded-full shrink-0"/>');
    expect(html).toContain('<div class="w-6 h-6 rounded-full bg-dc-bg-tertiary shrink-0"></div>');
    expect(html).toContain((1234567).toLocaleString());
    expect(html.match(/bg-dc-bg-tertiary\/30/g)).toHaveLength(3);
  });
});
