"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface GuildInfo {
  guildId: string;
  guildName: string | null;
  iconUrl: string | null;
}

interface UserInfo {
  discord_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

function GuildIcon({ name, iconUrl, size = "md" }: { name: string | null; iconUrl: string | null; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-7 h-7 rounded-lg text-xs" : "w-10 h-10 rounded-xl text-sm";
  if (iconUrl) {
    return <img src={iconUrl} alt={name ?? "Server"} className={`${cls} shrink-0 object-cover`} />;
  }

  const initials = (name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className={`${cls} bg-dc-bg-tertiary flex items-center justify-center font-semibold text-dc-text-secondary shrink-0`}>
      {initials}
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
    // Cookie is sent automatically — no need to read localStorage
    fetch("/api/guilds", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) { window.location.href = "/"; return; }
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

  const sidebarContent = (
    <>
      {/* Profile link */}
      <div className="px-2 pt-3 pb-1">
        <a
          href="/dashboard/profile"
          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
            pathname === "/dashboard/profile"
              ? "bg-dc-bg-modifier text-dc-text-primary"
              : "text-dc-text-secondary hover:bg-dc-bg-modifier/50 hover:text-dc-text-primary"
          }`}
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="Avatar" className="w-5 h-5 rounded-full" />
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          )}
          Profile
        </a>
      </div>

      {/* Servers */}
      <div className="px-4 pt-4 pb-1">
        <p className="text-[11px] font-semibold text-dc-text-muted uppercase tracking-wide">
          Your Servers
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loadingGuilds && (
          <div className="px-3 py-2 space-y-1">
            <div className="h-10 bg-dc-bg-tertiary rounded-md animate-pulse" />
            <div className="h-10 bg-dc-bg-tertiary rounded-md animate-pulse" />
          </div>
        )}

        {!loadingGuilds && guilds.length === 0 && (
          <p className="px-3 py-2 text-xs text-dc-text-muted">
            No servers found.
          </p>
        )}

        {guilds.map((guild) => {
          const isGuildActive = pathname.startsWith(`/dashboard/server/${guild.guildId}`);
          const isSettings = pathname === `/dashboard/server/${guild.guildId}`;
          const isSchedules = pathname === `/dashboard/server/${guild.guildId}/schedules`;
          return (
            <div key={guild.guildId} className="mt-0.5">
              <a
                href={`/dashboard/server/${guild.guildId}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isGuildActive
                    ? "bg-dc-bg-modifier text-dc-text-primary"
                    : "text-dc-text-secondary hover:bg-dc-bg-modifier/50 hover:text-dc-text-primary"
                }`}
              >
                <GuildIcon name={guild.guildName} iconUrl={guild.iconUrl} />
                <span className="truncate">{guild.guildName ?? guild.guildId}</span>
              </a>
              {isGuildActive && (
                <div className="mt-1 ml-4 border-l-2 border-dc-border pl-3 space-y-0.5">
                  <a
                    href={`/dashboard/server/${guild.guildId}`}
                    className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isSettings
                        ? "text-dc-text-primary bg-dc-bg-modifier"
                        : "text-dc-text-muted hover:text-dc-text-secondary hover:bg-dc-bg-modifier/50"
                    }`}
                  >
                    Settings
                  </a>
                  <a
                    href={`/dashboard/server/${guild.guildId}/schedules`}
                    className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                      isSchedules
                        ? "text-dc-text-primary bg-dc-bg-modifier"
                        : "text-dc-text-muted hover:text-dc-text-secondary hover:bg-dc-bg-modifier/50"
                    }`}
                  >
                    Schedules
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer with user info */}
      <div className="px-3 py-3 border-t border-dc-border flex items-center gap-2">
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-dc-bg-tertiary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-dc-text-primary truncate">
            {user?.display_name ?? user?.username ?? "User"}
          </p>
          <button
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" });
              window.location.href = "/";
            }}
            className="text-[11px] text-dc-text-muted hover:text-dc-danger transition-colors cursor-pointer"
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-60 h-screen sticky top-0 bg-dc-bg-secondary border-r border-dc-border flex-col shrink-0">
        <div className="px-4 py-5 border-b border-dc-border">
          <h2 className="text-base font-semibold text-dc-text-primary">DragonBot</h2>
        </div>
        {sidebarContent}
      </nav>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-dc-bg-secondary border-b border-dc-border px-4 py-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-dc-text-primary">DragonBot</h2>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-dc-text-secondary hover:text-dc-text-primary cursor-pointer p-1"
        >
          {mobileMenuOpen ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <nav className="absolute top-[53px] left-0 bottom-0 w-72 bg-dc-bg-secondary border-r border-dc-border flex flex-col overflow-y-auto">
            {sidebarContent}
          </nav>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-dc-bg-primary pt-[69px] md:pt-8">
        {children}
      </main>
    </div>
  );
}
