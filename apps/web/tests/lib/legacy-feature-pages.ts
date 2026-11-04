// Verbatim copies of the load effects and CRUD handlers of the schedules and YouTube dashboard
// pages at git HEAD d09dc0c, each wrapped in a function:
//   apps/web/src/app/dashboard/server/[guildId]/schedules/page.tsx lines 90-102 (load), 105-200 (handlers)
//   apps/web/src/app/dashboard/server/[guildId]/youtube/page.tsx lines 49-66 (load), 97-125, 146-200 (handlers)
// Every closure variable the bodies read (guildId, state values, setters) is a destructured
// parameter with its original name, so each body is unchanged apart from a `: any` on the
// map/filter callback parameter (the list is untyped here). Kept so the characterization
// tests can prove the shared helpers in src/lib/feature-list.ts make the same requests and the
// same state updates in the same order. Do not edit.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- schedules/page.tsx ----

export function legacySchedulesLoad({ guildId, setSchedules, setChannels, setError, setLoading }: any) {
    Promise.all([
      fetch(`/api/server/${guildId}/schedules`, { credentials: "same-origin" }),
      fetch(`/api/server/${guildId}/discord`, { credentials: "same-origin" }),
    ]).then(async ([schedRes, discordRes]) => {
      if (schedRes.status === 401) { window.location.href = "/"; return; }
      if (schedRes.status === 403) { setError("No permission."); setLoading(false); return; }
      if (schedRes.ok) setSchedules(await schedRes.json());
      if (discordRes.ok) {
        const data = await discordRes.json();
        setChannels(data.channels ?? []);
      }
      setLoading(false);
    }).catch(() => { setError("Failed to load."); setLoading(false); });
}

export async function legacySchedulesCreate({
  guildId, schedules, setSchedules, setSaving, setMessage, setShowForm, setFormMessage, setFormEmbedTitle, setShowReloadHint,
  formChannel, formMessage, formCron, formTimezone, formIsEmbed, formEmbedTitle, formEmbedColor,
}: any) {
    setSaving(true);
    setMessage(null);

    const res = await fetch(`/api/server/${guildId}/schedules`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: formChannel,
        message: formMessage,
        cronExpression: formCron,
        timezone: formTimezone,
        isEmbed: formIsEmbed,
        embedTitle: formIsEmbed && formEmbedTitle ? formEmbedTitle : null,
        embedColor: formIsEmbed ? formEmbedColor : null,
      }),
    });

    if (res.ok) {
      const newSchedule = await res.json();
      setSchedules([...schedules, newSchedule]);
      setShowForm(false);
      setFormMessage("");
      setFormEmbedTitle("");
      setMessage({ type: "success", text: "Schedule created!" });
      setShowReloadHint(true);
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to create." });
    }
    setSaving(false);
}

export async function legacySchedulesToggle(
  { guildId, schedules, setSchedules, setShowReloadHint }: any,
  id: string,
  currentlyEnabled: boolean,
) {
    const res = await fetch(`/api/server/${guildId}/schedules/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !currentlyEnabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSchedules(schedules.map((s: any) => (s.id === id ? updated : s)));
      setShowReloadHint(true);
    }
}

export async function legacySchedulesSaveEdit({
  guildId, schedules, setSchedules, editingId, editData, setEditingId, setEditData, setSaving, setMessage, setShowReloadHint,
}: any) {
    if (editingId === null) return;
    setSaving(true);
    const res = await fetch(`/api/server/${guildId}/schedules/${editingId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    if (res.ok) {
      const updated = await res.json();
      setSchedules(schedules.map((s: any) => (s.id === editingId ? updated : s)));
      setEditingId(null);
      setEditData({});
      setMessage({ type: "success", text: "Schedule updated!" });
      setShowReloadHint(true);
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to update." });
    }
    setSaving(false);
}

export async function legacySchedulesDelete(
  { guildId, schedules, setSchedules, setMessage, setShowReloadHint, setDeleteConfirmId }: any,
  id: string,
) {
    const res = await fetch(`/api/server/${guildId}/schedules/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      setSchedules(schedules.filter((s: any) => s.id !== id));
      setMessage({ type: "success", text: "Schedule deleted." });
      setShowReloadHint(true);
    }
    setDeleteConfirmId(null);
}

// ---- youtube/page.tsx ----

export function legacyYoutubeLoad({ guildId, setSubs, setChannels, setModuleEnabled, setError, setLoading }: any) {
    Promise.all([
      fetch(`/api/server/${guildId}/youtube`, { credentials: "same-origin" }),
      fetch(`/api/server/${guildId}/discord`, { credentials: "same-origin" }),
      fetch(`/api/server/${guildId}`, { credentials: "same-origin" }),
    ]).then(async ([ytRes, discordRes, guildRes]) => {
      if (ytRes.status === 401) { window.location.href = "/"; return; }
      if (ytRes.status === 403) { setError("No permission."); setLoading(false); return; }
      if (ytRes.ok) setSubs(await ytRes.json());
      if (discordRes.ok) {
        const data = await discordRes.json();
        setChannels(data.channels ?? []);
      }
      if (guildRes.ok) {
        const guild = await guildRes.json();
        setModuleEnabled(Boolean(guild.isYoutubeEnabled));
      }
      setLoading(false);
    }).catch(() => { setError("Failed to load."); setLoading(false); });
}

export async function legacyYoutubeCreate({
  guildId, subs, setSubs, setSaving, setMessage, setShowForm, setFormSearch, setFormYtChannel, setFormYtName, setFormCustomMessage,
  formYtChannel, formYtName, formNotifyChannel, formCustomMessage,
}: any) {
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/server/${guildId}/youtube`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        youtubeChannelId: formYtChannel.trim(),
        youtubeChannelName: formYtName.trim() || null,
        notifyChannelId: formNotifyChannel,
        customMessage: formCustomMessage.trim() || null,
      }),
    });
    if (res.ok) {
      const newSub = await res.json();
      setSubs([...subs, newSub]);
      setShowForm(false);
      setFormSearch("");
      setFormYtChannel("");
      setFormYtName("");
      setFormCustomMessage("");
      setMessage({ type: "success", text: "YouTube subscription added!" });
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to create." });
    }
    setSaving(false);
}

export async function legacyYoutubeToggle({ guildId, subs, setSubs }: any, id: string, currentlyEnabled: boolean) {
    const res = await fetch(`/api/server/${guildId}/youtube/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !currentlyEnabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSubs(subs.map((s: any) => (s.id === id ? updated : s)));
    }
}

export async function legacyYoutubeSaveEdit({
  guildId, subs, setSubs, editingId, editData, setEditingId, setEditData, setSaving, setMessage,
}: any) {
    if (editingId === null) return;
    setSaving(true);
    const res = await fetch(`/api/server/${guildId}/youtube/${editingId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    if (res.ok) {
      const updated = await res.json();
      setSubs(subs.map((s: any) => (s.id === editingId ? updated : s)));
      setEditingId(null);
      setEditData({});
      setMessage({ type: "success", text: "Subscription updated!" });
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to update." });
    }
    setSaving(false);
}

export async function legacyYoutubeDelete({ guildId, subs, setSubs, setMessage, setDeleteConfirmId }: any, id: string) {
    const res = await fetch(`/api/server/${guildId}/youtube/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      setSubs(subs.filter((s: any) => s.id !== id));
      setMessage({ type: "success", text: "Subscription deleted." });
    }
    setDeleteConfirmId(null);
}

// ---- the other 401 sites (single-fetch load effects) ----

// suggestions/page.tsx lines 39-46
export function legacySuggestionsLoad({ guildId, setSuggestions, setError, setLoading }: any) {
    fetch(`/api/server/${guildId}/suggestions`, { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) { window.location.href = "/"; return; }
        if (res.status === 403) { setError("No permission."); setLoading(false); return; }
        if (res.ok) setSuggestions(await res.json());
        setLoading(false);
      })
      .catch(() => { setError("Failed to load."); setLoading(false); });
}

// dashboard/server/[guildId]/leaderboard/page.tsx lines 26-35
export function legacyDashboardLeaderboardLoad({ guildId, setEntries, setError, setLoading }: any) {
    fetch(`/api/server/${guildId}/leaderboard`, { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) { window.location.href = "/"; return; }
        if (res.status === 403) { setError("You don't have permission to view this server."); setLoading(false); return; }
        if (!res.ok) { setError("Failed to load leaderboard."); setLoading(false); return; }
        const data = await res.json();
        setEntries(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load leaderboard."); setLoading(false); });
}

// dashboard/layout.tsx lines 44-50
export function legacyLayoutGuildsLoad({ setGuilds, setLoadingGuilds }: any) {
    fetch("/api/guilds", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) { window.location.href = "/"; return; }
        if (res.ok) setGuilds(await res.json());
        setLoadingGuilds(false);
      })
      .catch(() => setLoadingGuilds(false));
}

// dashboard/profile/page.tsx lines 135-147
export function legacyProfileLoad({ setProfile, setSavedProfile, setLoading }: any) {
    fetch("/api/profile", { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = "/";
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) { setProfile(data); setSavedProfile(data); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
}
