import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GuildSettings } from "@/lib/guild-settings";
import { SETTINGS_GROUPS, SETTINGS_PANELS } from "@/components/settings/panels";

// The settings page is a nav of panels from SETTINGS_PANELS. Each panel must render, and every
// setting the page can save must belong to exactly one panel (that drives its unsaved-changes dot).

function makeSettings(overrides: Partial<GuildSettings> = {}): GuildSettings {
  return {
    guildId: "100000000000000001",
    guildName: "Test Guild",
    verificationRoleId: "200000000000000001",
    isVerificationSyncEnabled: true,
    isBanSyncEnabled: false,
    welcomeChannelId: "300000000000000001",
    welcomeMessage: "Welcome {member} to {server}",
    isWelcomeEnabled: true,
    dmWelcomeMessage: null,
    isDmWelcomeEnabled: false,
    logChannelId: "300000000000000002",
    isLoggingEnabled: true,
    logEvents: ["member_join", "ban"],
    introChannelId: null,
    introRoleId: "200000000000000002",
    isIntroGateEnabled: false,
    introMinChars: 24,
    introMinWords: 5,
    introMinSubstantiveWords: 3,
    introUniqueWordRatio: 50,
    introMaxRepeatedCharPct: 50,
    modNotesChannelId: null,
    isHoneypotEnabled: false,
    honeypotChannelId: null,
    honeypotAction: "kick",
    isRepeatSpamEnabled: false,
    repeatSpamChannelCount: 3,
    repeatSpamMatchMode: "ignore_case",
    isSuggestionsEnabled: true,
    isAskEnabled: true,
    askSystemPrompt: null,
    offtopicImages: ["https://example.com/a.png"],
    offtopicMessage: "Off topic",
    isXpEnabled: false,
    xpMin: 15,
    xpMax: 25,
    xpCooldownSeconds: 60,
    xpLevelupChannelId: null,
    xpExcludedChannelIds: [],
    xpExcludedRoleIds: ["200000000000000003"],
    isBirthdayEnabled: false,
    birthdayChannelId: null,
    birthdayRoleId: null,
    birthdayMessage: null,
    birthdayTimezone: "America/New_York",
    ...overrides,
  };
}

const CHANNELS = [
  { id: "300000000000000001", name: "welcome", type: "text" },
  { id: "300000000000000002", name: "mod-log", type: "text" },
  { id: "300000000000000003", name: "Lounge VC", type: "voice" },
];
const ROLES = [{ id: "200000000000000001", name: "Verified", color: "#5865f2" }];

function renderPanel(id: string, settings: GuildSettings, withDiscord: boolean): string {
  const panel = SETTINGS_PANELS.find((p) => p.id === id)!;
  return renderToStaticMarkup(
    createElement(panel.Component, {
      settings,
      update: () => {},
      channels: withDiscord ? CHANNELS : [],
      roles: withDiscord ? ROLES : [],
      hasDiscordData: withDiscord,
    }),
  );
}

describe("settings panels", () => {
  it("have unique ids and known groups", () => {
    const ids = SETTINGS_PANELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SETTINGS_PANELS) expect(SETTINGS_GROUPS).toContain(p.group);
  });

  it("cover every saved setting exactly once", () => {
    const owned = SETTINGS_PANELS.flatMap((p) => p.fields);
    expect(new Set(owned).size).toBe(owned.length);
    const all = Object.keys(makeSettings()).filter((k) => k !== "guildId" && k !== "guildName");
    expect([...owned].sort()).toEqual(all.sort());
  });

  for (const p of SETTINGS_PANELS) {
    it(`${p.id} renders with and without Discord data`, () => {
      expect(renderPanel(p.id, makeSettings(), true).length).toBeGreaterThan(0);
      expect(renderPanel(p.id, makeSettings(), false).length).toBeGreaterThan(0);
    });
  }

  it("names a picked channel and role, and labels a stored ID it can't resolve as unknown", () => {
    expect(renderPanel("welcome", makeSettings(), true)).toContain(">welcome</span>");
    expect(renderPanel("verification", makeSettings(), true)).toContain(">Verified</span>");
    const blind = renderPanel("verification", makeSettings(), false);
    expect(blind).toContain("Unknown role");
    expect(blind).toContain("200000000000000001");
  });

  it("lists excluded XP roles even when the role list did not load", () => {
    const html = renderPanel("xp", makeSettings(), false);
    expect(html).toContain("Unknown role");
    expect(html).toContain("Add role");
  });
});
