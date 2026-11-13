import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The dashboard shell: a Discord-style server rail and a sidebar with the open server's pages.
// Effects do not run in renderToStaticMarkup, so the layout's state is seeded through useState.

const seed = vi.hoisted(() => ({ pathname: "/dashboard", values: [] as unknown[] }));

vi.mock("next/navigation", () => ({ usePathname: () => seed.pathname }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // The layout's four useState calls come first, in order: guilds, loadingGuilds, user, mobileMenuOpen
    useState: (init: unknown) => (seed.values.length > 0 ? [seed.values.shift(), () => {}] : actual.useState(init)),
  };
});

import DashboardLayout from "@/app/dashboard/layout";

const A = "222222222222222222";
const B = "333333333333333333";

const GUILDS = [
  { guildId: A, guildName: "Alpha Server", iconUrl: "https://cdn.discordapp.com/icons/a/x.png?size=64", isAdmin: true },
  { guildId: B, guildName: null, iconUrl: null, isAdmin: false },
];
const USER = { discord_id: "1", username: "kev", display_name: "Kevin", avatar_url: "https://cdn.discordapp.com/avatars/1/a.png" };

function render(pathname: string, state: unknown[] = [GUILDS, false, USER, false]): string {
  seed.pathname = pathname;
  seed.values = [...state];
  return renderToStaticMarkup(createElement(DashboardLayout, null, createElement("p", null, "page")));
}

/** Every href in the rendered HTML, in order. */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("dashboard layout", () => {
  it("renders the page content", () => {
    expect(render("/dashboard/profile")).toContain("<p>page</p>");
  });

  it("links each server from the rail: admins to settings, members to the leaderboard", () => {
    const html = render("/dashboard/profile");
    expect(html).toMatch(new RegExp(`aria-label="Alpha Server"[^>]*href="/dashboard/server/${A}"`));
    expect(html).toMatch(new RegExp(`aria-label="${B}"[^>]*href="/dashboard/server/${B}/leaderboard"`));
  });

  it("shows an admin every page of the open server, and marks the current one", () => {
    const html = render(`/dashboard/server/${A}/youtube`);
    for (const slug of ["", "/schedules", "/youtube", "/suggestions", "/leaderboard"]) {
      expect(hrefs(html)).toContain(`/dashboard/server/${A}${slug}`);
    }
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="/dashboard/server/${A}/youtube"`));
    expect(html).not.toMatch(new RegExp(`aria-current="page"[^>]*href="/dashboard/server/${A}/schedules"`));
    expect(html).toContain(">Alpha Server</h2>");
  });

  it("shows a member only the leaderboard", () => {
    const html = render(`/dashboard/server/${B}/leaderboard`);
    expect(hrefs(html)).toContain(`/dashboard/server/${B}/leaderboard`);
    for (const slug of ["/schedules", "/youtube", "/suggestions"]) {
      expect(hrefs(html)).not.toContain(`/dashboard/server/${B}${slug}`);
    }
  });

  it("does not treat a longer guild id with the same prefix as the open server", () => {
    const html = render(`/dashboard/server/${A}9/leaderboard`);
    expect(html).not.toContain(">Alpha Server</h2>");
  });

  it("shows skeletons while servers load and the user's name once known", () => {
    expect(render("/dashboard/profile", [[], true, null, false])).toContain("animate-pulse");
    expect(render("/dashboard/profile")).toContain("Kevin");
  });

  it("opens the mobile drawer with the rail and sidebar", () => {
    const closed = render("/dashboard/profile");
    const open = render("/dashboard/profile", [GUILDS, false, USER, true]);
    expect(open).toContain('aria-label="Close menu"');
    expect((open.match(/aria-label="Servers"/g) ?? []).length).toBe((closed.match(/aria-label="Servers"/g) ?? []).length + 1);
  });

  it("navigates with next/link without prefetching, and has no plain <a>", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/app/dashboard/layout.tsx", import.meta.url)), "utf8");
    const links = src.match(/<Link\b/g)?.length ?? 0;
    expect(links).toBeGreaterThan(0);
    expect(src.match(/prefetch=\{false\}/g)).toHaveLength(links);
    expect(src).not.toMatch(/<a[\s>]/);
  });
});
