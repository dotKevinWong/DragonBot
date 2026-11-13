"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { redirectIfUnauthorized } from "@/lib/client-fetch";

interface GuildInfo {
  guildId: string;
  guildName: string | null;
  iconUrl: string | null;
  isAdmin: boolean;
}

interface UserInfo {
  discord_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/** A server's pages, in sidebar order. Members (not admins) see only the leaderboard. */
const GUILD_PAGES: { slug: string; label: string; adminOnly: boolean; icon: string }[] = [
  { slug: "", label: "Settings", adminOnly: true, icon: "M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.66 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.84c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" },
  { slug: "/schedules", label: "Schedules", adminOnly: true, icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.59 3.2 3.2-1.41 1.42L11 13.41V6h2v6.59Z" },
  { slug: "/youtube", label: "YouTube", adminOnly: true, icon: "M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" },
  { slug: "/suggestions", label: "Suggestions", adminOnly: true, icon: "M9 21h6v-1H9v1Zm3-19a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2Z" },
  { slug: "/leaderboard", label: "Leaderboard", adminOnly: false, icon: "M7 4V2h10v2h4v3a5 5 0 0 1-4.1 4.92A5 5 0 0 1 13 15.9V19h4v2H7v-2h4v-3.1a5 5 0 0 1-3.9-3.98A5 5 0 0 1 3 7V4h4Zm0 2H5v1a3 3 0 0 0 2 2.83V6Zm10 0v3.83A3 3 0 0 0 19 7V6h-2Z" },
];

function initialsOf(name: string | null): string {
  return (name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 3);
}

/**
 * A round server icon that turns into a rounded square when hovered or selected, as in Discord's server list.
 * The tooltip is position: fixed, so the scrolling rail can't clip it.
 */
function RailItem({ href, label, active, children }: { href: string; label: string; active: boolean; children: React.ReactNode }) {
  const [tipTop, setTipTop] = useState<number | null>(null);
  return (
    <div
      className="group relative flex justify-center w-full shrink-0"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTipTop(r.top + r.height / 2);
      }}
      onMouseLeave={() => setTipTop(null)}
    >
      {/* The white pill on the left edge: tall when selected, short on hover */}
      <span
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r bg-white transition-all ${
          active ? "h-10" : "h-0 group-hover:h-5"
        }`}
        aria-hidden
      />
      <Link
        prefetch={false}
        href={href}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={`w-12 h-12 flex items-center justify-center overflow-hidden transition-all duration-150 ${
          active ? "rounded-2xl" : "rounded-3xl group-hover:rounded-2xl"
        }`}
      >
        {children}
      </Link>
      {tipTop !== null && (
        <span
          className="pointer-events-none fixed left-[76px] -translate-y-1/2 z-50 hidden md:block whitespace-nowrap rounded-md bg-dc-bg-floating border border-dc-border px-3 py-1.5 text-sm font-semibold text-dc-text-primary shadow-xl"
          style={{ top: tipTop }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/guilds", { credentials: "same-origin" })
      .then(async (res) => {
        if (redirectIfUnauthorized(res)) return;
        if (res.ok) setGuilds(await res.json());
        setLoadingGuilds(false);
      })
      .catch(() => setLoadingGuilds(false));

    fetch("/api/auth", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.ok) setUser(await res.json());
      })
      .catch(() => {});
  }, []);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const activeGuild = guilds.find((g) => pathname === `/dashboard/server/${g.guildId}` || pathname.startsWith(`/dashboard/server/${g.guildId}/`));
  const isProfile = pathname === "/dashboard/profile";

  const rail = (
    <nav aria-label="Servers" className="w-[72px] shrink-0 bg-dc-bg-tertiary flex flex-col items-center gap-2 py-3 overflow-y-auto">
      <RailItem href="/dashboard/profile" label="Your profile" active={isProfile}>
        <span className={`w-full h-full flex items-center justify-center transition-colors ${isProfile ? "bg-dc-accent" : "bg-dc-bg-secondary group-hover:bg-dc-accent"}`}>
          <Image src="/dragonbot.png" alt="" width={30} height={30} className="rounded-md" />
        </span>
      </RailItem>
      <div className="w-8 h-0.5 rounded-full bg-dc-border shrink-0" aria-hidden />
      {loadingGuilds && (
        <>
          <div className="w-12 h-12 rounded-3xl bg-dc-bg-secondary animate-pulse shrink-0" />
          <div className="w-12 h-12 rounded-3xl bg-dc-bg-secondary animate-pulse shrink-0" />
        </>
      )}
      {guilds.map((guild) => {
        const active = guild === activeGuild;
        return (
          <RailItem
            key={guild.guildId}
            href={guild.isAdmin ? `/dashboard/server/${guild.guildId}` : `/dashboard/server/${guild.guildId}/leaderboard`}
            label={guild.guildName ?? guild.guildId}
            active={active}
          >
            {guild.iconUrl ? (
              <img src={guild.iconUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className={`w-full h-full flex items-center justify-center text-sm font-medium transition-colors ${
                active ? "bg-dc-accent text-white" : "bg-dc-bg-secondary text-dc-text-primary group-hover:bg-dc-accent group-hover:text-white"
              }`}>
                {initialsOf(guild.guildName)}
              </span>
            )}
          </RailItem>
        );
      })}
    </nav>
  );

  const pageLinkClass = (active: boolean) =>
    `flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[15px] font-medium transition-colors ${
      active ? "bg-dc-bg-modifier text-dc-text-primary" : "text-dc-text-muted hover:bg-dc-bg-modifier/50 hover:text-dc-text-secondary"
    }`;

  const sidebar = (
    <div className="w-60 shrink-0 flex flex-col bg-dc-bg-tertiary min-h-0">
      <div className="flex-1 min-h-0 flex flex-col bg-dc-bg-tertiary md:rounded-tl-xl md:border-l md:border-t border-dc-border overflow-hidden">
        <header className="h-12 shrink-0 px-4 flex items-center border-b border-dc-border">
          <h2 className="text-[15px] font-semibold text-dc-text-primary truncate">
            {activeGuild ? (activeGuild.guildName ?? activeGuild.guildId) : "DragonBot"}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {activeGuild ? (
            GUILD_PAGES.filter((p) => activeGuild.isAdmin || !p.adminOnly).map((p) => {
              const href = `/dashboard/server/${activeGuild.guildId}${p.slug}`;
              return (
                <Link key={p.label} prefetch={false} href={href} aria-current={pathname === href ? "page" : undefined} className={pageLinkClass(pathname === href)}>
                  <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 opacity-80" fill="currentColor" aria-hidden><path d={p.icon} /></svg>
                  {p.label}
                </Link>
              );
            })
          ) : (
            <>
              <Link prefetch={false} href="/dashboard/profile" aria-current={isProfile ? "page" : undefined} className={pageLinkClass(isProfile)}>
                <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0 opacity-80" fill="currentColor" aria-hidden><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.58-5-8-5Z" /></svg>
                Profile
              </Link>
              {!loadingGuilds && (
                <p className="px-2 pt-3 text-xs text-dc-text-muted">
                  {guilds.length > 0 ? "Pick a server on the left to manage it." : "No servers yet. Servers you manage or belong to with DragonBot show up here."}
                </p>
              )}
            </>
          )}
        </div>
        {/* User panel */}
        <div className="shrink-0 m-2 p-1.5 rounded-lg bg-dc-bg-secondary border border-dc-border flex items-center gap-2">
          <Link prefetch={false} href="/dashboard/profile" className="flex items-center gap-2 min-w-0 flex-1 rounded-md p-0.5 hover:bg-dc-bg-modifier/50">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full shrink-0" />
            ) : (
              <span className="w-8 h-8 rounded-full bg-dc-accent shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block text-sm font-medium text-dc-text-primary truncate leading-tight">{user?.display_name ?? user?.username ?? "User"}</span>
              {user?.username && <span className="block text-xs text-dc-text-muted truncate leading-tight">{user.username}</span>}
            </span>
          </Link>
          <button
            type="button"
            title="Log out"
            aria-label="Log out"
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
              window.location.href = "/";
            }}
            className="p-1.5 rounded-md text-dc-text-muted hover:text-dc-danger hover:bg-dc-bg-modifier/50 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-dc-bg-tertiary">
      {/* Desktop: server rail and sidebar */}
      <div className="hidden md:flex h-screen sticky top-0 shrink-0 pt-2">
        {rail}
        {sidebar}
      </div>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-dc-bg-tertiary border-b border-dc-border px-3 flex items-center gap-3">
        <button
          type="button"
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-dc-text-secondary hover:text-dc-text-primary cursor-pointer p-1"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d={mobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
          </svg>
        </button>
        <span className="text-[15px] font-semibold text-dc-text-primary truncate">
          {activeGuild ? (activeGuild.guildName ?? activeGuild.guildId) : "DragonBot"}
        </span>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute top-12 left-0 bottom-0 flex">
            {rail}
            {sidebar}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 bg-dc-bg-primary md:mt-2 md:border-l md:border-t border-dc-border p-4 pt-16 md:p-8">
        {children}
      </main>
    </div>
  );
}
