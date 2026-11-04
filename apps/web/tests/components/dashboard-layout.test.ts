import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Audit P2. The sidebar's plain <a href> links became next/link <Link>s with the same hrefs,
// classNames and children. Rendered with the same state and pathname, the layout must produce the
// same HTML as the pre-P2 copy (only the order of each link's class and href attributes differs),
// so active-link highlighting, the guild rows and the sub-links are unchanged. Effects do not run in renderToStaticMarkup, so the state is seeded through useState.

const seed = vi.hoisted(() => ({ pathname: "/dashboard", values: [] as unknown[] }));

vi.mock("next/navigation", () => ({ usePathname: () => seed.pathname }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // The layout's four useState calls, in order: guilds, loadingGuilds, user, mobileMenuOpen
    useState: (init: unknown) => (seed.values.length > 0 ? [seed.values.shift(), () => {}] : actual.useState(init)),
  };
});

import DashboardLayout from "@/app/dashboard/layout";
import LegacyDashboardLayout from "./legacy-dashboard-layout";

const A = "222222222222222222";
const B = "333333333333333333";

const GUILDS = [
  { guildId: A, guildName: "Alpha Server", iconUrl: "https://cdn.discordapp.com/icons/a/x.png?size=64&a=1", isAdmin: true },
  { guildId: B, guildName: null, iconUrl: null, isAdmin: false },
  { guildId: "444444444444444444", guildName: "the <b> & co", iconUrl: null, isAdmin: true },
];

const USER = { discord_id: "1", username: "kev", display_name: "Kevin", avatar_url: "https://cdn.discordapp.com/avatars/1/a.png" };

const PATHS = [
  "/dashboard",
  "/dashboard/profile",
  `/dashboard/server/${A}`,
  `/dashboard/server/${A}/schedules`,
  `/dashboard/server/${A}/youtube`,
  `/dashboard/server/${A}/suggestions`,
  `/dashboard/server/${A}/leaderboard`,
  `/dashboard/server/${B}/leaderboard`,
  `/dashboard/server/${B}`,
];

type State = [guilds: unknown[], loading: boolean, user: unknown, mobileOpen: boolean];

const STATES: [string, State][] = [
  ["loading, no user", [[], true, null, false]],
  ["loaded, no guilds", [[], false, null, false]],
  ["loaded guilds and user", [GUILDS, false, USER, false]],
  ["user without avatar, mobile menu open", [GUILDS, false, { ...USER, avatar_url: null, display_name: null }, true]],
];

/** Puts each <a>'s attributes in name order: <Link> writes class before href, <a> wrote them as given. */
function sortAnchorAttributes(html: string): string {
  return html.replace(/<a ([^>]*)>/g, (_m, attrs: string) => {
    const list = attrs.match(/[\w-]+="[^"]*"/g) ?? [];
    expect(list.join(" ")).toBe(attrs);
    return `<a ${[...list].sort().join(" ")}>`;
  });
}

function render(Layout: ComponentType<{ children: ReactNode }>, pathname: string, state: State): string {
  seed.pathname = pathname;
  seed.values = [...state];
  const html = renderToStaticMarkup(createElement(Layout, null, createElement("p", null, "page")));
  expect(seed.values).toEqual([]);
  return sortAnchorAttributes(html);
}

describe("dashboard layout sidebar (P2)", () => {
  for (const [name, state] of STATES) {
    for (const pathname of PATHS) {
      it(`${name} at ${pathname}: same HTML as the <a href> sidebar (attribute order aside)`, () => {
        expect(render(DashboardLayout, pathname, state)).toBe(render(LegacyDashboardLayout, pathname, state));
      });
    }
  }

  it("highlights the active sub-link from the pathname", () => {
    const html = render(DashboardLayout, `/dashboard/server/${A}/youtube`, [GUILDS, false, USER, false]);
    expect(html).toContain(`<a class="block px-3 py-1.5 rounded-md text-sm transition-colors text-dc-text-primary bg-dc-bg-modifier" href="/dashboard/server/${A}/youtube">YouTube</a>`);
    expect(html).toContain(`<a class="block px-3 py-1.5 rounded-md text-sm transition-colors text-dc-text-muted hover:text-dc-text-secondary hover:bg-dc-bg-modifier/50" href="/dashboard/server/${A}/schedules">Schedules</a>`);
  });

  it("navigates with next/link, without prefetching, and has no plain <a> left", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/app/dashboard/layout.tsx", import.meta.url)), "utf8");
    expect(src).toContain('import Link from "next/link";');
    expect(src.match(/<Link\b/g)).toHaveLength(7);
    expect(src.match(/prefetch=\{false\}/g)).toHaveLength(7);
    expect(src).not.toMatch(/<a[\s>]/);
  });
});
