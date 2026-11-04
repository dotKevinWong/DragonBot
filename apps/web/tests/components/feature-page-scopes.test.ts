import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Audit B1 follow-up. The schedules, YouTube and suggestions pages hide their create, edit and
// delete controls when the caller lacks the page's scope, and show a one-line note instead. A
// caller with the scope (or "*", or whose grants are not known yet) must see exactly the HTML the
// pages rendered before. Effects do not run in renderToStaticMarkup, so each page's state is seeded
// through useState by call order, and the guild settings fetch hook is mocked.

const seed = vi.hoisted(() => ({ values: [] as unknown[], viewerScopes: undefined as unknown }));
const SKIP = Symbol("skip");

vi.mock("next/navigation", () => ({ useParams: () => ({ guildId: "222222222222222222" }) }));
vi.mock("@/lib/use-viewer-scopes", () => ({ useViewerScopes: () => seed.viewerScopes }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      // The page's own useState calls come first, in order; later calls (CronBuilder) are real
      if (seed.values.length > 0) {
        const value = seed.values.shift();
        if (value !== SKIP) return [value, () => {}];
      }
      return actual.useState(init);
    },
  };
});

import SchedulesPage from "@/app/dashboard/server/[guildId]/schedules/page";
import YouTubePage from "@/app/dashboard/server/[guildId]/youtube/page";
import SuggestionsPage from "@/app/dashboard/server/[guildId]/suggestions/page";
import LegacySchedulesPage from "./legacy-feature-pages/schedules";
import LegacyYouTubePage from "./legacy-feature-pages/youtube";
import LegacySuggestionsPage from "./legacy-feature-pages/suggestions";

const CH = "300000000000000001";
const CHANNELS = [{ id: CH, name: "general", type: "text" }, { id: "300000000000000002", name: "news", type: "announcement" }];
const ID1 = "123e4567-e89b-12d3-a456-426614174001";
const ID2 = "123e4567-e89b-12d3-a456-426614174002";

/** Each page's useState calls in source order (the YouTube page's viewerScopes is new). */
const ORDER = {
  schedules: ["schedules", "channels", "loading", "error", "message", "showForm", "formChannel", "formMessage", "formCron", "formTimezone", "formIsEmbed", "formEmbedTitle", "formEmbedColor", "saving", "editingId", "editData", "deleteConfirmId", "showReloadHint"],
  youtubeLegacy: ["subs", "channels", "loading", "error", "message", "moduleEnabled", "togglingModule", "showForm", "formSearch", "formYtChannel", "formYtName", "formNotifyChannel", "formCustomMessage", "saving", "resolving", "resolveError", "editingId", "editData", "deleteConfirmId"],
  youtube: ["subs", "channels", "loading", "error", "message", "moduleEnabled", "togglingModule", "viewerScopes", "showForm", "formSearch", "formYtChannel", "formYtName", "formNotifyChannel", "formCustomMessage", "saving", "resolving", "resolveError", "editingId", "editData", "deleteConfirmId"],
  suggestions: ["suggestions", "loading", "error", "message", "filter", "deleteConfirmId"],
};

type State = Record<string, unknown>;

function render(page: ComponentType, order: string[], state: State, viewerScopes: unknown): string {
  seed.values = order.map((name) => (name === "viewerScopes" ? viewerScopes : name in state ? state[name] : SKIP));
  seed.viewerScopes = viewerScopes;
  const html = renderToStaticMarkup(createElement(page));
  seed.values = [];
  return html;
}

const SCHEDULES = [
  { id: ID1, guildId: "g", channelId: CH, message: "Hello <world>", cronExpression: "0 9 * * *", timezone: "UTC", isEnabled: true, isEmbed: true, embedColor: "#ff0000", embedTitle: "T", lastRunAt: null, createdBy: "u" },
  { id: ID2, guildId: "g", channelId: "999", message: "Bye", cronExpression: "*/5 * * * *", timezone: "Europe/London", isEnabled: false, isEmbed: false, embedColor: null, embedTitle: null, lastRunAt: null, createdBy: "u" },
];
const SUBS = [
  { id: ID1, guildId: "g", youtubeChannelId: "UC123", youtubeChannelName: "Chan", notifyChannelId: CH, customMessage: "New {title}", lastVideoId: null, isEnabled: true },
  { id: ID2, guildId: "g", youtubeChannelId: "UC456", youtubeChannelName: null, notifyChannelId: "999", customMessage: null, lastVideoId: null, isEnabled: false },
];
const SUGGESTIONS = [
  { id: ID1, guildId: "g", discordId: "1", discordUsername: "amy", suggestion: "More <emoji>", status: "pending", createdAt: "2026-01-02T03:04:05.000Z" },
  { id: ID2, guildId: "g", discordId: "2", discordUsername: "bo", suggestion: "Old", status: "archived", createdAt: "2026-01-01T00:00:00.000Z" },
];
const MESSAGE = { type: "success", text: "Saved!" };

const PAGES = [
  {
    name: "schedules",
    scope: "schedules",
    page: SchedulesPage,
    legacy: LegacySchedulesPage,
    order: ORDER.schedules,
    legacyOrder: ORDER.schedules,
    controls: ["+ New Schedule", ">Edit<", "✕", "Create Schedule", "Delete Schedule", "Click &quot;+ New Schedule&quot;"],
    states: {
      "list": { schedules: SCHEDULES, channels: CHANNELS, loading: false },
      "empty": { schedules: [], channels: CHANNELS, loading: false },
      "form open, message, reload hint": { schedules: SCHEDULES, channels: CHANNELS, loading: false, showForm: true, formIsEmbed: true, message: MESSAGE, showReloadHint: true },
      "empty with form open": { schedules: [], channels: CHANNELS, loading: false, showForm: true },
      "editing": { schedules: SCHEDULES, channels: CHANNELS, loading: false, editingId: ID1, editData: { channelId: CH, message: "m", cronExpression: "0 9 * * *", timezone: "UTC", isEmbed: true, embedTitle: null, embedColor: null } },
      "delete confirm": { schedules: SCHEDULES, channels: CHANNELS, loading: false, deleteConfirmId: ID2 },
      "loading": {},
      "error": { loading: false, error: "No permission." },
    } as Record<string, State>,
  },
  {
    name: "youtube",
    scope: "youtube",
    page: YouTubePage,
    legacy: LegacyYouTubePage,
    order: ORDER.youtube,
    legacyOrder: ORDER.youtubeLegacy,
    controls: ["+ Add Channel", ">Edit<", "&#x2715;", "✕", "Add YouTube Channel", "Remove Subscription", "Click &quot;+ Add Channel&quot;"],
    states: {
      "list, module on": { subs: SUBS, channels: CHANNELS, loading: false, moduleEnabled: true },
      "empty, module off": { subs: [], channels: CHANNELS, loading: false },
      "form open with a resolved channel, toggling": { subs: SUBS, channels: CHANNELS, loading: false, showForm: true, formYtChannel: "UC9", formYtName: "Nine", resolveError: "x", togglingModule: true, message: MESSAGE },
      "empty with form open": { subs: [], channels: CHANNELS, loading: false, showForm: true },
      "editing": { subs: SUBS, channels: CHANNELS, loading: false, editingId: ID2, editData: { notifyChannelId: CH, youtubeChannelName: null, customMessage: null } },
      "delete confirm": { subs: SUBS, channels: CHANNELS, loading: false, deleteConfirmId: ID1 },
      "loading": {},
      "error": { loading: false, error: "Failed to load." },
    } as Record<string, State>,
  },
  {
    name: "suggestions",
    scope: "suggestions",
    page: SuggestionsPage,
    legacy: LegacySuggestionsPage,
    order: ORDER.suggestions,
    legacyOrder: ORDER.suggestions,
    controls: ["<select", "Unarchive", "title=\"Archive\"", "Archive Suggestion"],
    states: {
      "all": { suggestions: SUGGESTIONS, loading: false },
      "archived filter": { suggestions: SUGGESTIONS, loading: false, filter: "archived" },
      "empty": { suggestions: [], loading: false },
      "message and delete confirm": { suggestions: SUGGESTIONS, loading: false, message: MESSAGE, deleteConfirmId: ID1 },
      "loading": {},
      "error": { loading: false, error: "No permission." },
    } as Record<string, State>,
  },
] as const;

for (const p of PAGES) {
  describe(`${p.name} page write controls (B1 follow-up)`, () => {
    const allowed: [string, unknown][] = [
      ["unknown grants", undefined],
      ["full access", ["*"]],
      [`the ${p.scope} scope`, [p.scope]],
      ["other scopes and this one", ["welcome", p.scope]],
      ["a response without an array", "*"],
    ];
    const missing: [string, unknown][] = [
      ["another scope only", ["welcome"]],
      ["several other scopes", ["schedules", "youtube", "suggestions"].filter((s) => s !== p.scope)],
      ["no grants", []],
    ];
    const note = `You need the ${p.scope} permission to make changes.`;

    for (const [stateName, state] of Object.entries(p.states)) {
      for (const [who, scopes] of allowed) {
        it(`${stateName}, ${who}: same HTML as before`, () => {
          const before = render(p.legacy, p.legacyOrder, state, undefined);
          expect(render(p.page, p.order, state, scopes)).toBe(before);
        });
      }

      for (const [who, scopes] of missing) {
        it(`${stateName}, ${who}: note shown, no write controls`, () => {
          const html = render(p.page, p.order, state, scopes);
          const before = render(p.legacy, p.legacyOrder, state, undefined);
          const pageShown = before.includes("max-w-2xl");
          expect(html.includes(note)).toBe(pageShown);
          // Not vacuous: wherever the page renders, the old HTML had at least one of the controls
          // (an empty suggestions list never had any: suggestions come from /suggest, not the page)
          if (pageShown && !(p.name === "suggestions" && stateName === "empty")) expect(p.controls.some((control) => before.includes(control))).toBe(true);
          for (const control of p.controls) expect(html).not.toContain(control);
        });
      }
    }
  });
}

describe("YouTube module toggle without the youtube scope", () => {
  it("stays visible but disabled", () => {
    const state = PAGES[1].states["list, module on"]!;
    const html = render(YouTubePage, ORDER.youtube, state, ["welcome"]);
    expect(html).toMatch(/<button disabled="" aria-label="Enable YouTube notifications"/);
    expect(render(YouTubePage, ORDER.youtube, state, ["youtube"])).not.toMatch(/<button disabled=""/);
  });
});
