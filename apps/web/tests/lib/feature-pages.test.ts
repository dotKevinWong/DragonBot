import { afterEach, describe, expect, it, vi } from "vitest";
import { installHarness, outcome, type Harness, type Reply } from "./feature-pages-harness";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as legacy from "./legacy-feature-pages";
import { redirectIfUnauthorized } from "@/lib/client-fetch";
import {
  createFeatureItem,
  deleteFeatureItem,
  loadFeatureList,
  saveFeatureItemEdit,
  toggleFeatureItem,
  type FeatureList,
} from "@/lib/feature-list";

// Audit D14. Characterization of the schedules and YouTube page load effects and CRUD handlers,
// and of the six other 401-redirect sites. Each scenario runs the HEAD copy and the shared helper
// against the same mocked fetch and compares the full ordered event log (fetch URL and init,
// json() reads, redirects, state setter calls) and how the call ended.

afterEach(() => {
  vi.unstubAllGlobals();
});

const G = "123456789012345678";
const A = `/api/server/${G}`;

type Runner = (h: Harness) => Promise<unknown> | void;
interface Op {
  name: string;
  legacy: Runner;
  lib?: Runner;
  scenarios: [string, Record<string, Reply>][];
  /** Load effects return nothing; the harness waits for the chain to finish instead. */
  isLoad?: boolean;
}

async function run(op: Op, which: "legacy" | "lib", replies: Record<string, Reply>) {
  const h = installHarness(replies);
  const runner = op[which]!;
  const ended = await outcome(async () => { await runner(h); });
  await h.settle();
  vi.unstubAllGlobals();
  return { events: h.events, ended };
}

// ---- fixtures ----

const SCHED_1 = { id: "s1", channelId: "c1", message: "hi", cronExpression: "0 9 * * *", isEnabled: true };
const SCHED_2 = { id: "s2", channelId: "c2", message: "yo", cronExpression: "0 * * * *", isEnabled: false };
const SUB_1 = { id: "y1", youtubeChannelId: "UC1", youtubeChannelName: "One", notifyChannelId: "c1", customMessage: null, isEnabled: true };
const SUB_2 = { id: "y2", youtubeChannelId: "UC2", youtubeChannelName: null, notifyChannelId: "c2", customMessage: "x", isEnabled: false };
const CHANNELS = [
  { id: "c1", name: "general", type: "text" },
  { id: "c2", name: "news", type: "announcement" },
  { id: "c3", name: "Voice", type: "voice" },
];

const ok = (body: unknown): Reply => ({ status: 200, body });
const status = (code: number, body: unknown = { error: `E${code}` }): Reply => ({ status: code, body });
const badJson = (code: number): Reply => ({ status: code, badJson: true });
const netErr: Reply = { networkError: true };

function loadScenarios(listUrl: string, list: unknown, extraUrl?: string): [string, Record<string, Reply>][] {
  const base = (listReply: Reply, discordReply: Reply, extraReply?: Reply): Record<string, Reply> => ({
    [listUrl]: listReply,
    [`${A}/discord`]: discordReply,
    ...(extraUrl ? { [extraUrl]: extraReply ?? ok({ isYoutubeEnabled: true }) } : {}),
  });
  const s: [string, Record<string, Reply>][] = [
    ["all ok", base(ok(list), ok({ channels: CHANNELS, roles: [] }))],
    ["discord body without channels", base(ok(list), ok({ roles: [] }))],
    ["list 401", base(status(401), ok({ channels: CHANNELS }))],
    ["list 403", base(status(403), ok({ channels: CHANNELS }))],
    ["list 500", base(status(500), ok({ channels: CHANNELS }))],
    ["list 404", base(status(404), ok({ channels: CHANNELS }))],
    ["discord 403", base(ok(list), status(403))],
    ["discord 500", base(ok(list), status(500))],
    ["discord 401", base(ok(list), status(401))],
    ["list bad JSON", base(badJson(200), ok({ channels: CHANNELS }))],
    ["discord bad JSON", base(ok(list), badJson(200))],
    ["list network error", base(netErr, ok({ channels: CHANNELS }))],
    ["discord network error", base(ok(list), netErr)],
  ];
  if (extraUrl) {
    s.push(
      ["guild disabled", base(ok(list), ok({ channels: CHANNELS }), ok({ isYoutubeEnabled: false }))],
      ["guild flag missing", base(ok(list), ok({ channels: CHANNELS }), ok({}))],
      ["guild flag truthy string", base(ok(list), ok({ channels: CHANNELS }), ok({ isYoutubeEnabled: "yes" }))],
      ["guild 403", base(ok(list), ok({ channels: CHANNELS }), status(403))],
      ["guild bad JSON", base(ok(list), ok({ channels: CHANNELS }), badJson(200))],
      ["guild network error", base(ok(list), ok({ channels: CHANNELS }), netErr)],
      ["list 401 and guild 401", base(status(401), ok({ channels: CHANNELS }), status(401))],
    );
  }
  return s;
}

function mutationScenarios(url: string, okBody: unknown): [string, Record<string, Reply>][] {
  return [
    ["ok", { [url]: ok(okBody) }],
    ["400 with error", { [url]: status(400, { error: "Invalid data" }) }],
    ["400 without error", { [url]: status(400, { code: "X" }) }],
    ["401", { [url]: status(401, { error: "Unauthorized", code: "UNAUTHORIZED" }) }],
    ["403", { [url]: status(403, { error: "Forbidden" }) }],
    ["500 non-JSON body", { [url]: badJson(500) }],
    ["ok non-JSON body", { [url]: badJson(200) }],
    ["network error", { [url]: netErr }],
  ];
}

// ---- state passed to each runner (setters record into the harness log) ----

function schedulesState(h: Harness) {
  return {
    guildId: G,
    schedules: [SCHED_1, SCHED_2],
    setSchedules: h.setter("setSchedules"),
    setChannels: h.setter("setChannels"),
    setError: h.setter("setError"),
    setLoading: h.setter("setLoading"),
    setSaving: h.setter("setSaving"),
    setMessage: h.setter("setMessage"),
    setShowForm: h.setter("setShowForm"),
    setFormMessage: h.setter("setFormMessage"),
    setFormEmbedTitle: h.setter("setFormEmbedTitle"),
    setShowReloadHint: h.setter("setShowReloadHint"),
    setEditingId: h.setter("setEditingId"),
    setEditData: h.setter("setEditData"),
    setDeleteConfirmId: h.setter("setDeleteConfirmId"),
    formChannel: "c1",
    formMessage: "Good morning",
    formCron: "0 9 * * 1-5",
    formTimezone: "Europe/London",
    formIsEmbed: true,
    formEmbedTitle: "Title",
    formEmbedColor: "#ff0000",
    editingId: "s2" as string | null,
    editData: { channelId: "c1", message: "edited", cronExpression: "0 10 * * *", timezone: "UTC", isEmbed: false, embedTitle: null, embedColor: null },
  };
}

function youtubeState(h: Harness) {
  return {
    guildId: G,
    subs: [SUB_1, SUB_2],
    setSubs: h.setter("setSubs"),
    setChannels: h.setter("setChannels"),
    setModuleEnabled: h.setter("setModuleEnabled"),
    setError: h.setter("setError"),
    setLoading: h.setter("setLoading"),
    setSaving: h.setter("setSaving"),
    setMessage: h.setter("setMessage"),
    setShowForm: h.setter("setShowForm"),
    setFormSearch: h.setter("setFormSearch"),
    setFormYtChannel: h.setter("setFormYtChannel"),
    setFormYtName: h.setter("setFormYtName"),
    setFormCustomMessage: h.setter("setFormCustomMessage"),
    setEditingId: h.setter("setEditingId"),
    setEditData: h.setter("setEditData"),
    setDeleteConfirmId: h.setter("setDeleteConfirmId"),
    formYtChannel: "  UCabcdefghijklmnopqrstuv  ",
    formYtName: "  ",
    formNotifyChannel: "c2",
    formCustomMessage: " New video: {url} ",
    editingId: "y1" as string | null,
    editData: { notifyChannelId: "c2", youtubeChannelName: "Renamed", customMessage: null },
  };
}

// ---- the shared helpers, called exactly as the pages call them ----

type St = ReturnType<typeof schedulesState>;
type Yt = ReturnType<typeof youtubeState>;
/* eslint-disable @typescript-eslint/no-explicit-any */
const schedulesList = (st: St): FeatureList<any> => ({
  basePath: `/api/server/${st.guildId}/schedules`,
  items: st.schedules,
  setItems: st.setSchedules,
  setSaving: st.setSaving,
  setMessage: st.setMessage,
  onChanged: () => st.setShowReloadHint(true),
});
const youtubeList = (st: Yt): FeatureList<any> => ({
  basePath: `/api/server/${st.guildId}/youtube`,
  items: st.subs,
  setItems: st.setSubs,
  setSaving: st.setSaving,
  setMessage: st.setMessage,
});
const libSchedulesCreate = (st: St) =>
  createFeatureItem(
    schedulesList(st),
    {
      channelId: st.formChannel,
      message: st.formMessage,
      cronExpression: st.formCron,
      timezone: st.formTimezone,
      isEmbed: st.formIsEmbed,
      embedTitle: st.formIsEmbed && st.formEmbedTitle ? st.formEmbedTitle : null,
      embedColor: st.formIsEmbed ? st.formEmbedColor : null,
    },
    "Schedule created!",
    () => {
      st.setShowForm(false);
      st.setFormMessage("");
      st.setFormEmbedTitle("");
    },
  );
const libSchedulesSaveEdit = (st: St) =>
  saveFeatureItemEdit(schedulesList(st), st.editingId, st.editData, "Schedule updated!", () => {
    st.setEditingId(null);
    st.setEditData({});
  });
const libYoutubeCreate = (st: Yt) =>
  createFeatureItem(
    youtubeList(st),
    {
      youtubeChannelId: st.formYtChannel.trim(),
      youtubeChannelName: st.formYtName.trim() || null,
      notifyChannelId: st.formNotifyChannel,
      customMessage: st.formCustomMessage.trim() || null,
    },
    "YouTube subscription added!",
    () => {
      st.setShowForm(false);
      st.setFormSearch("");
      st.setFormYtChannel("");
      st.setFormYtName("");
      st.setFormCustomMessage("");
    },
  );
const libYoutubeSaveEdit = (st: Yt) =>
  saveFeatureItemEdit(youtubeList(st), st.editingId, st.editData, "Subscription updated!", () => {
    st.setEditingId(null);
    st.setEditData({});
  });

// The four single-fetch load effects after the change: the HEAD bodies with the 401 line
// replaced by redirectIfUnauthorized (the pages' effects are otherwise untouched; the source
// check at the bottom of this file pins that each page contains that line).
function newSuggestionsLoad({ guildId, setSuggestions, setError, setLoading }: any) {
    fetch(`/api/server/${guildId}/suggestions`, { credentials: "same-origin" })
      .then(async (res) => {
        if (redirectIfUnauthorized(res)) return;
        if (res.status === 403) { setError("No permission."); setLoading(false); return; }
        if (res.ok) setSuggestions(await res.json());
        setLoading(false);
      })
      .catch(() => { setError("Failed to load."); setLoading(false); });
}
function newDashboardLeaderboardLoad({ guildId, setEntries, setError, setLoading }: any) {
    fetch(`/api/server/${guildId}/leaderboard`, { credentials: "same-origin" })
      .then(async (res) => {
        if (redirectIfUnauthorized(res)) return;
        if (res.status === 403) { setError("You don't have permission to view this server."); setLoading(false); return; }
        if (!res.ok) { setError("Failed to load leaderboard."); setLoading(false); return; }
        const data = await res.json();
        setEntries(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load leaderboard."); setLoading(false); });
}
function newLayoutGuildsLoad({ setGuilds, setLoadingGuilds }: any) {
    fetch("/api/guilds", { credentials: "same-origin" })
      .then(async (res) => {
        if (redirectIfUnauthorized(res)) return;
        if (res.ok) setGuilds(await res.json());
        setLoadingGuilds(false);
      })
      .catch(() => setLoadingGuilds(false));
}
function newProfileLoad({ setProfile, setSavedProfile, setLoading }: any) {
    fetch("/api/profile", { credentials: "same-origin" })
      .then((res) => {
        if (redirectIfUnauthorized(res)) return null;
        return res.json();
      })
      .then((data) => {
        if (data) { setProfile(data); setSavedProfile(data); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---- the operations ----

const OPS: Op[] = [
  {
    name: "schedules load",
    isLoad: true,
    legacy: (h) => legacy.legacySchedulesLoad(schedulesState(h)),
    lib: (h) => {
      const st = schedulesState(h);
      loadFeatureList({ guildId: st.guildId, resource: "schedules", setItems: st.setSchedules, setChannels: st.setChannels, setError: st.setError, setLoading: st.setLoading });
    },
    scenarios: loadScenarios(`${A}/schedules`, [SCHED_1, SCHED_2]),
  },
  {
    name: "schedules create",
    legacy: (h) => legacy.legacySchedulesCreate(schedulesState(h)),
    lib: (h) => libSchedulesCreate(schedulesState(h)),
    scenarios: [
      ...mutationScenarios(`${A}/schedules`, { ...SCHED_1, id: "s3" }),
      ["create without embed", { [`${A}/schedules`]: ok({ id: "s4" }) }],
    ],
  },
  {
    name: "schedules create, embed off and empty title",
    legacy: (h) => legacy.legacySchedulesCreate({ ...schedulesState(h), formIsEmbed: false, formEmbedTitle: "" }),
    lib: (h) => libSchedulesCreate({ ...schedulesState(h), formIsEmbed: false, formEmbedTitle: "" }),
    scenarios: [["ok", { [`${A}/schedules`]: ok({ id: "s4" }) }]],
  },
  {
    name: "schedules create, embed on and empty title",
    legacy: (h) => legacy.legacySchedulesCreate({ ...schedulesState(h), formEmbedTitle: "" }),
    lib: (h) => libSchedulesCreate({ ...schedulesState(h), formEmbedTitle: "" }),
    scenarios: [["ok", { [`${A}/schedules`]: ok({ id: "s4" }) }]],
  },
  {
    name: "schedules toggle (enabled -> off)",
    legacy: (h) => legacy.legacySchedulesToggle(schedulesState(h), "s1", true),
    lib: (h) => toggleFeatureItem(schedulesList(schedulesState(h)), "s1", true),
    scenarios: mutationScenarios(`${A}/schedules/s1`, { ...SCHED_1, isEnabled: false }),
  },
  {
    name: "schedules toggle (disabled -> on)",
    legacy: (h) => legacy.legacySchedulesToggle(schedulesState(h), "s2", false),
    lib: (h) => toggleFeatureItem(schedulesList(schedulesState(h)), "s2", false),
    scenarios: mutationScenarios(`${A}/schedules/s2`, { ...SCHED_2, isEnabled: true }),
  },
  {
    name: "schedules save edit",
    legacy: (h) => legacy.legacySchedulesSaveEdit(schedulesState(h)),
    lib: (h) => libSchedulesSaveEdit(schedulesState(h)),
    scenarios: mutationScenarios(`${A}/schedules/s2`, { ...SCHED_2, message: "edited" }),
  },
  {
    name: "schedules save edit with no row open",
    legacy: (h) => legacy.legacySchedulesSaveEdit({ ...schedulesState(h), editingId: null }),
    lib: (h) => libSchedulesSaveEdit({ ...schedulesState(h), editingId: null }),
    scenarios: [["no request", {}]],
  },
  {
    name: "schedules delete",
    legacy: (h) => legacy.legacySchedulesDelete(schedulesState(h), "s1"),
    lib: (h) => {
      const st = schedulesState(h);
      return deleteFeatureItem(schedulesList(st), "s1", "Schedule deleted.", () => st.setDeleteConfirmId(null));
    },
    scenarios: mutationScenarios(`${A}/schedules/s1`, { success: true }),
  },
  {
    name: "youtube load",
    isLoad: true,
    legacy: (h) => legacy.legacyYoutubeLoad(youtubeState(h)),
    lib: (h) => {
      const st = youtubeState(h);
      loadFeatureList({
        guildId: st.guildId,
        resource: "youtube",
        setItems: st.setSubs,
        setChannels: st.setChannels,
        setError: st.setError,
        setLoading: st.setLoading,
        extra: { url: `/api/server/${st.guildId}`, onData: (guild) => st.setModuleEnabled(Boolean(guild.isYoutubeEnabled)) },
      });
    },
    scenarios: loadScenarios(`${A}/youtube`, [SUB_1, SUB_2], A),
  },
  {
    name: "youtube create",
    legacy: (h) => legacy.legacyYoutubeCreate(youtubeState(h)),
    lib: (h) => libYoutubeCreate(youtubeState(h)),
    scenarios: mutationScenarios(`${A}/youtube`, { ...SUB_1, id: "y3" }),
  },
  {
    name: "youtube create, name and message given",
    legacy: (h) => legacy.legacyYoutubeCreate({ ...youtubeState(h), formYtName: " Chan ", formCustomMessage: "" }),
    lib: (h) => libYoutubeCreate({ ...youtubeState(h), formYtName: " Chan ", formCustomMessage: "" }),
    scenarios: [["ok", { [`${A}/youtube`]: ok({ id: "y4" }) }]],
  },
  {
    name: "youtube toggle",
    legacy: (h) => legacy.legacyYoutubeToggle(youtubeState(h), "y1", true),
    lib: (h) => toggleFeatureItem(youtubeList(youtubeState(h)), "y1", true),
    scenarios: mutationScenarios(`${A}/youtube/y1`, { ...SUB_1, isEnabled: false }),
  },
  {
    name: "youtube save edit",
    legacy: (h) => legacy.legacyYoutubeSaveEdit(youtubeState(h)),
    lib: (h) => libYoutubeSaveEdit(youtubeState(h)),
    scenarios: mutationScenarios(`${A}/youtube/y1`, { ...SUB_1, youtubeChannelName: "Renamed" }),
  },
  {
    name: "youtube save edit with no row open",
    legacy: (h) => legacy.legacyYoutubeSaveEdit({ ...youtubeState(h), editingId: null }),
    lib: (h) => libYoutubeSaveEdit({ ...youtubeState(h), editingId: null }),
    scenarios: [["no request", {}]],
  },
  {
    name: "youtube delete",
    legacy: (h) => legacy.legacyYoutubeDelete(youtubeState(h), "y2"),
    lib: (h) => {
      const st = youtubeState(h);
      return deleteFeatureItem(youtubeList(st), "y2", "Subscription deleted.", () => st.setDeleteConfirmId(null));
    },
    scenarios: mutationScenarios(`${A}/youtube/y2`, { success: true }),
  },
  {
    name: "suggestions load",
    isLoad: true,
    legacy: (h) => legacy.legacySuggestionsLoad({ guildId: G, setSuggestions: h.setter("setSuggestions"), setError: h.setter("setError"), setLoading: h.setter("setLoading") }),
    lib: (h) => newSuggestionsLoad({ guildId: G, setSuggestions: h.setter("setSuggestions"), setError: h.setter("setError"), setLoading: h.setter("setLoading") }),
    scenarios: [
      ["ok", { [`${A}/suggestions`]: ok([{ id: "x" }]) }],
      ["401", { [`${A}/suggestions`]: status(401) }],
      ["403", { [`${A}/suggestions`]: status(403) }],
      ["500", { [`${A}/suggestions`]: status(500) }],
      ["bad JSON", { [`${A}/suggestions`]: badJson(200) }],
      ["network error", { [`${A}/suggestions`]: netErr }],
    ],
  },
  {
    name: "dashboard leaderboard load",
    isLoad: true,
    legacy: (h) => legacy.legacyDashboardLeaderboardLoad({ guildId: G, setEntries: h.setter("setEntries"), setError: h.setter("setError"), setLoading: h.setter("setLoading") }),
    lib: (h) => newDashboardLeaderboardLoad({ guildId: G, setEntries: h.setter("setEntries"), setError: h.setter("setError"), setLoading: h.setter("setLoading") }),
    scenarios: [
      ["ok", { [`${A}/leaderboard`]: ok([{ discordId: "1" }]) }],
      ["401", { [`${A}/leaderboard`]: status(401) }],
      ["403", { [`${A}/leaderboard`]: status(403) }],
      ["500", { [`${A}/leaderboard`]: status(500) }],
      ["bad JSON", { [`${A}/leaderboard`]: badJson(200) }],
      ["network error", { [`${A}/leaderboard`]: netErr }],
    ],
  },
  {
    name: "layout guilds load",
    isLoad: true,
    legacy: (h) => legacy.legacyLayoutGuildsLoad({ setGuilds: h.setter("setGuilds"), setLoadingGuilds: h.setter("setLoadingGuilds") }),
    lib: (h) => newLayoutGuildsLoad({ setGuilds: h.setter("setGuilds"), setLoadingGuilds: h.setter("setLoadingGuilds") }),
    scenarios: [
      ["ok", { "/api/guilds": ok([{ guildId: G }]) }],
      ["401", { "/api/guilds": status(401) }],
      ["500", { "/api/guilds": status(500) }],
      ["bad JSON", { "/api/guilds": badJson(200) }],
      ["network error", { "/api/guilds": netErr }],
    ],
  },
  {
    name: "profile load",
    isLoad: true,
    legacy: (h) => legacy.legacyProfileLoad({ setProfile: h.setter("setProfile"), setSavedProfile: h.setter("setSavedProfile"), setLoading: h.setter("setLoading") }),
    lib: (h) => newProfileLoad({ setProfile: h.setter("setProfile"), setSavedProfile: h.setter("setSavedProfile"), setLoading: h.setter("setLoading") }),
    scenarios: [
      ["ok", { "/api/profile": ok({ name: "Kev" }) }],
      ["401", { "/api/profile": status(401) }],
      ["500 with JSON body", { "/api/profile": status(500, { error: "x" }) }],
      ["ok null body", { "/api/profile": ok(null) }],
      ["bad JSON", { "/api/profile": badJson(200) }],
      ["network error", { "/api/profile": netErr }],
    ],
  },
];

it("every operation has a shared-helper runner", () => {
  expect(OPS.filter((o) => !o.lib).map((o) => o.name)).toEqual([]);
});

describe.each(OPS)("$name", (op) => {
  it.each(op.scenarios)("HEAD copy and shared helper agree: %s", async (_name, replies) => {
    const before = await run(op, "legacy", replies);
    expect(before.events.length > 0 || _name === "no request").toBe(true);
    if (!op.lib) return;
    const after = await run(op, "lib", replies);
    expect(after.ended).toBe(before.ended);
    expect(after.events).toEqual(before.events);
  });
});

// ---- pinned logs: the exact behaviour, written out (not only "same as the HEAD copy") ----

describe("pinned behaviour", () => {
  const find = (name: string) => OPS.find((o) => o.name === name)!;
  const both = (op: Op) => (op.lib ? (["legacy", "lib"] as const) : (["legacy"] as const));

  it("schedules load, all ok: two GETs with same-origin credentials, list then channels, then loading off", async () => {
    const op = find("schedules load");
    for (const which of both(op)) {
      const { events } = await run(op, which, op.scenarios[0]![1]);
      expect(events).toEqual([
        ["fetch", `${A}/schedules`, { credentials: "same-origin" }],
        ["fetch", `${A}/discord`, { credentials: "same-origin" }],
        ["json", `${A}/schedules`],
        ["setSchedules", [SCHED_1, SCHED_2]],
        ["json", `${A}/discord`],
        ["setChannels", CHANNELS],
        ["setLoading", false],
      ]);
    }
  });

  it("a 401 on the list redirects to / and leaves loading on; a 403 shows No permission.", async () => {
    const op = find("youtube load");
    const r401 = op.scenarios.find(([n]) => n === "list 401")![1];
    const r403 = op.scenarios.find(([n]) => n === "list 403")![1];
    for (const which of both(op)) {
      const a = await run(op, which, r401);
      expect(a.events.slice(3)).toEqual([["redirect", "/"]]);
      const b = await run(op, which, r403);
      expect(b.events.slice(3)).toEqual([["setError", "No permission."], ["setLoading", false]]);
    }
  });

  it("youtube load reads the guild flag last, as a boolean", async () => {
    const op = find("youtube load");
    for (const which of both(op)) {
      const { events } = await run(op, which, op.scenarios.find(([n]) => n === "guild flag truthy string")![1]);
      expect(events.slice(0, 3).map((e) => e[1])).toEqual([`${A}/youtube`, `${A}/discord`, A]);
      expect(events.slice(-3)).toEqual([["json", A], ["setModuleEnabled", true], ["setLoading", false]]);
    }
  });

  it("schedules create ok: POST body, then list, form resets, message, reload hint, saving off", async () => {
    const op = find("schedules create");
    for (const which of both(op)) {
      const { events, ended } = await run(op, which, op.scenarios[0]![1]);
      expect(ended).toBe("resolved");
      expect(events).toEqual([
        ["setSaving", true],
        ["setMessage", null],
        ["fetch", `${A}/schedules`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: "c1", message: "Good morning", cronExpression: "0 9 * * 1-5", timezone: "Europe/London", isEmbed: true, embedTitle: "Title", embedColor: "#ff0000" }),
        }],
        ["json", `${A}/schedules`],
        ["setSchedules", [SCHED_1, SCHED_2, { ...SCHED_1, id: "s3" }]],
        ["setShowForm", false],
        ["setFormMessage", ""],
        ["setFormEmbedTitle", ""],
        ["setMessage", { type: "success", text: "Schedule created!" }],
        ["setShowReloadHint", true],
        ["setSaving", false],
      ]);
    }
  });

  it("create with a non-JSON error body rejects and leaves saving on", async () => {
    const op = find("youtube create");
    for (const which of both(op)) {
      const { events, ended } = await run(op, which, op.scenarios.find(([n]) => n === "500 non-JSON body")![1]);
      expect(ended).toMatch(/^rejected: SyntaxError/);
      expect(events.at(-1)).toEqual(["json", `${A}/youtube`]);
      expect(events.filter((e) => e[0] === "setSaving")).toEqual([["setSaving", true]]);
    }
  });

  it("youtube never sets a reload hint; schedules sets it on every success and never on failure", async () => {
    for (const op of OPS.filter((o) => !o.isLoad)) {
      for (const [scenario, replies] of op.scenarios) {
        for (const which of both(op)) {
          const { events } = await run(op, which, replies);
          const hints = events.filter((e) => e[0] === "setShowReloadHint");
          const succeeded = events.some((e) => e[0] === "setSchedules");
          if (op.name.startsWith("youtube") || !succeeded) expect(hints, `${op.name} / ${scenario}`).toEqual([]);
          else expect(hints, `${op.name} / ${scenario}`).toEqual([["setShowReloadHint", true]]);
        }
      }
    }
  });

  it("delete clears the confirm dialog whether or not the request succeeded, but not on a network error", async () => {
    const op = find("schedules delete");
    for (const which of both(op)) {
      for (const [scenario, replies] of op.scenarios) {
        const { events, ended } = await run(op, which, replies);
        const cleared = events.at(-1)?.[0] === "setDeleteConfirmId";
        if (scenario === "network error") {
          expect(ended).toMatch(/^rejected/);
          expect(cleared).toBe(false);
        } else {
          expect(cleared, scenario).toBe(true);
        }
      }
    }
  });
});

describe("redirectIfUnauthorized", () => {
  it("redirects to / and returns true only for a 401", () => {
    for (const code of [200, 201, 204, 302, 400, 401, 403, 404, 429, 500]) {
      const hrefs: string[] = [];
      const location = {};
      Object.defineProperty(location, "href", { set(v: string) { hrefs.push(v); } });
      vi.stubGlobal("window", { location });
      const result = redirectIfUnauthorized({ status: code } as Response);
      expect(result).toBe(code === 401);
      expect(hrefs).toEqual(code === 401 ? ["/"] : []);
      vi.unstubAllGlobals();
    }
  });

  it("is the only 401 check in the web app's client code, and each of the six sites uses it", () => {
    const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8");
    const sites: [string, string][] = [
      ["app/dashboard/layout.tsx", "if (redirectIfUnauthorized(res)) return;"],
      ["app/dashboard/server/[guildId]/page.tsx", "if (redirectIfUnauthorized(settingsRes)) return;"],
      ["app/dashboard/server/[guildId]/leaderboard/page.tsx", "if (redirectIfUnauthorized(res)) return;"],
      ["app/dashboard/server/[guildId]/suggestions/page.tsx", "if (redirectIfUnauthorized(res)) return;"],
      ["app/dashboard/profile/page.tsx", "if (redirectIfUnauthorized(res)) return null;"],
      ["lib/feature-list.ts", "if (redirectIfUnauthorized(listRes)) return;"],
    ];
    for (const [file, line] of sites) {
      const text = src(file);
      expect(text, file).toContain(line);
      expect(text, file).not.toMatch(/status === 401/);
      expect(text.split("redirectIfUnauthorized(").length - 1, file).toBe(1); // one call per file
    }
    for (const page of ["app/dashboard/server/[guildId]/schedules/page.tsx", "app/dashboard/server/[guildId]/youtube/page.tsx"]) {
      expect(src(page), page).not.toMatch(/status === 401|window\.location/);
    }
  });
});

// The characterization tests above drive the helpers through test-local wrappers that mirror the
// page call sites. This pins the real call sites' arguments (whitespace-insensitive) so a later edit
// to a success text, reset callback, onChanged or extra read in a page is caught.
describe("schedules and YouTube page wiring", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const page = (name: string) =>
    norm(readFileSync(fileURLToPath(new URL(`../../src/app/dashboard/server/[guildId]/${name}/page.tsx`, import.meta.url)), "utf8"));

  it("schedules page passes the HEAD texts, resets and reload hint", () => {
    const text = page("schedules");
    for (const snippet of [
      `loadFeatureList({ guildId, resource: "schedules", setItems: setSchedules, setChannels, setError, setLoading });`,
      `const list: FeatureList<Schedule> = { basePath: \`/api/server/\${guildId}/schedules\`, items: schedules, setItems: setSchedules, setSaving, setMessage, onChanged: () => setShowReloadHint(true), };`,
      `await createFeatureItem( list, { channelId: formChannel, message: formMessage, cronExpression: formCron, timezone: formTimezone, isEmbed: formIsEmbed, embedTitle: formIsEmbed && formEmbedTitle ? formEmbedTitle : null, embedColor: formIsEmbed ? formEmbedColor : null, }, "Schedule created!", () => { setShowForm(false); setFormMessage(""); setFormEmbedTitle(""); }, );`,
      `await toggleFeatureItem(list, id, currentlyEnabled);`,
      `await saveFeatureItemEdit(list, editingId, editData, "Schedule updated!", () => { setEditingId(null); setEditData({}); });`,
      `await deleteFeatureItem(list, id, "Schedule deleted.", () => setDeleteConfirmId(null));`,
    ]) {
      expect(text).toContain(norm(snippet));
    }
  });

  it("YouTube page passes the HEAD texts, resets and module flag read, and no onChanged", () => {
    const text = page("youtube");
    for (const snippet of [
      // B1 follow-up: the same extra read also keeps the caller's grants (viewerScopes)
      `loadFeatureList({ guildId, resource: "youtube", setItems: setSubs, setChannels, setError, setLoading, extra: { url: \`/api/server/\${guildId}\`, onData: (guild) => { setModuleEnabled(Boolean(guild.isYoutubeEnabled)); setViewerScopes(guild.viewerScopes); }, }, });`,
      `const list: FeatureList<Subscription> = { basePath: \`/api/server/\${guildId}/youtube\`, items: subs, setItems: setSubs, setSaving, setMessage, };`,
      `await createFeatureItem( list, { youtubeChannelId: formYtChannel.trim(), youtubeChannelName: formYtName.trim() || null, notifyChannelId: formNotifyChannel, customMessage: formCustomMessage.trim() || null, }, "YouTube subscription added!", () => { setShowForm(false); setFormSearch(""); setFormYtChannel(""); setFormYtName(""); setFormCustomMessage(""); }, );`,
      `await toggleFeatureItem(list, id, currentlyEnabled);`,
      `await saveFeatureItemEdit(list, editingId, editData, "Subscription updated!", () => { setEditingId(null); setEditData({}); });`,
      `await deleteFeatureItem(list, id, "Subscription deleted.", () => setDeleteConfirmId(null));`,
    ]) {
      expect(text).toContain(norm(snippet));
    }
    expect(text).not.toContain("onChanged");
  });
});
