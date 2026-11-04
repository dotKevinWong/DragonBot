// Load and create/update/delete helpers shared by the schedules and YouTube dashboard pages,
// which manage a list of rows under /api/server/[guildId]/<resource>. The pages pass their
// state setters in; each helper makes the same requests and the same state updates, in the same
// order, as the page code it replaced (pinned by tests/lib/feature-pages.test.ts). Messages
// that differ per page are parameters. No React import: plain functions, called from handlers.
import type { DiscordChannel } from "@/lib/guild-settings";
import { getSameOrigin, redirectIfUnauthorized, sendDelete, sendJson } from "@/lib/client-fetch";

export type PageMessage = { type: "success" | "error"; text: string } | null;

/** Text and announcement channels: the ones a page can post to. */
export function filterTextChannels(channels: DiscordChannel[]): DiscordChannel[] {
  return channels.filter((c) => c.type === "text" || c.type === "announcement");
}

export interface FeatureListLoad<T> {
  guildId: string;
  /** The path segment after /api/server/[guildId]/, e.g. "schedules". */
  resource: string;
  setItems: (items: T[]) => void;
  setChannels: (channels: DiscordChannel[]) => void;
  setError: (error: string) => void;
  setLoading: (loading: boolean) => void;
  /** A third GET fired with the other two, read last if it is ok (the YouTube page reads its guild settings). */
  extra?: { url: string; onData: (data: any) => void }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Fetches the list, the guild's Discord channels and the optional extra URL in parallel.
 * A 401 on the list redirects to "/" with loading left on; a 403 shows "No permission.".
 * Any other non-ok list, channels or extra response is skipped silently; a network error or a
 * bad JSON body shows "Failed to load.". Returns nothing (call it from an effect).
 */
export function loadFeatureList<T>(opts: FeatureListLoad<T>): void {
  const { guildId, resource, setItems, setChannels, setError, setLoading, extra } = opts;
  Promise.all([
    getSameOrigin(`/api/server/${guildId}/${resource}`),
    getSameOrigin(`/api/server/${guildId}/discord`),
    ...(extra ? [getSameOrigin(extra.url)] : []),
  ]).then(async ([listRes, discordRes, extraRes]) => {
    if (redirectIfUnauthorized(listRes)) return;
    if (listRes.status === 403) { setError("No permission."); setLoading(false); return; }
    if (listRes.ok) setItems(await listRes.json());
    if (discordRes.ok) {
      const data = await discordRes.json();
      setChannels(data.channels ?? []);
    }
    if (extra && extraRes.ok) {
      extra.onData(await extraRes.json());
    }
    setLoading(false);
  }).catch(() => { setError("Failed to load."); setLoading(false); });
}

/**
 * The list a page manages and the setters its handlers share. The handlers read `items` as it was
 * when the page rendered (not a functional update), as the page code did.
 */
export interface FeatureList<T extends { id: string }> {
  /** The list endpoint, e.g. `/api/server/${guildId}/schedules`; a row is `${basePath}/${id}`. */
  basePath: string;
  items: T[];
  setItems: (items: T[]) => void;
  setSaving: (saving: boolean) => void;
  setMessage: (message: PageMessage) => void;
  /** Called last after every successful change (schedules shows its reload hint); never on failure. */
  onChanged?: () => void;
}

/**
 * POSTs a new row. On success appends it, runs `resetForm`, shows `successText` and calls onChanged;
 * otherwise shows the body's error or "Failed to create.". A non-JSON error body or a network
 * error rejects and leaves saving on, as before.
 */
export async function createFeatureItem<T extends { id: string }>(
  list: FeatureList<T>,
  body: unknown,
  successText: string,
  resetForm: () => void,
): Promise<void> {
  list.setSaving(true);
  list.setMessage(null);
  const res = await sendJson(list.basePath, "POST", body);
  if (res.ok) {
    const created = await res.json();
    list.setItems([...list.items, created]);
    resetForm();
    list.setMessage({ type: "success", text: successText });
    list.onChanged?.();
  } else {
    const data = await res.json();
    list.setMessage({ type: "error", text: data.error ?? "Failed to create." });
  }
  list.setSaving(false);
}

/** PATCHes { isEnabled: !currentlyEnabled }. On success swaps in the returned row; a failure shows nothing. */
export async function toggleFeatureItem<T extends { id: string }>(
  list: FeatureList<T>,
  id: string,
  currentlyEnabled: boolean,
): Promise<void> {
  const res = await sendJson(`${list.basePath}/${id}`, "PATCH", { isEnabled: !currentlyEnabled });
  if (res.ok) {
    const updated = await res.json();
    list.setItems(list.items.map((s) => (s.id === id ? updated : s)));
    list.onChanged?.();
  }
}

/**
 * PATCHes the edited fields of the open row (does nothing if none is open). On success swaps in
 * the returned row, runs `closeEditor`, shows `successText` and calls onChanged; otherwise shows
 * the body's error or "Failed to update.".
 */
export async function saveFeatureItemEdit<T extends { id: string }>(
  list: FeatureList<T>,
  editingId: string | null,
  editData: Partial<T>,
  successText: string,
  closeEditor: () => void,
): Promise<void> {
  if (editingId === null) return;
  list.setSaving(true);
  const res = await sendJson(`${list.basePath}/${editingId}`, "PATCH", editData);
  if (res.ok) {
    const updated = await res.json();
    list.setItems(list.items.map((s) => (s.id === editingId ? updated : s)));
    closeEditor();
    list.setMessage({ type: "success", text: successText });
    list.onChanged?.();
  } else {
    const data = await res.json();
    list.setMessage({ type: "error", text: data.error ?? "Failed to update." });
  }
  list.setSaving(false);
}

/**
 * DELETEs a row. On success removes it, shows `successText` and calls onChanged; a failure shows
 * nothing. `closeConfirm` runs after any response (not after a network error).
 */
export async function deleteFeatureItem<T extends { id: string }>(
  list: FeatureList<T>,
  id: string,
  successText: string,
  closeConfirm: () => void,
): Promise<void> {
  const res = await sendDelete(`${list.basePath}/${id}`);
  if (res.ok) {
    list.setItems(list.items.filter((s) => s.id !== id));
    list.setMessage({ type: "success", text: successText });
    list.onChanged?.();
  }
  closeConfirm();
}
