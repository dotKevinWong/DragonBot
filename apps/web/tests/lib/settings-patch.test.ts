import { describe, expect, it } from "vitest";
import { FIELD_SCOPE_MAP } from "@dragonbot/db/permissions";
import { guildSettingsUpdateSchema } from "@/lib/validators";
import { buildSettingsPatch } from "@/lib/settings-patch";
import type { GuildSettings } from "@/lib/guild-settings";
import { legacyBuildUpdateFields } from "./legacy-settings-save";

// Characterization of the settings page's save request (audit C3). The PATCH body's key set
// decides which scopes the route demands, so every test pins Object.keys in order, not only values.

const ALWAYS_SENT = [
  "isVerificationSyncEnabled",
  "isBanSyncEnabled",
  "welcomeMessage",
  "isWelcomeEnabled",
  "dmWelcomeMessage",
  "isDmWelcomeEnabled",
  "isLoggingEnabled",
  "logEvents",
  "isIntroGateEnabled",
  "introMinChars",
  "introMinWords",
  "introMinSubstantiveWords",
  "introUniqueWordRatio",
  "introMaxRepeatedCharPct",
  "isSuggestionsEnabled",
  "isAskEnabled",
  "askSystemPrompt",
  "offtopicImages",
  "offtopicMessage",
  "isXpEnabled",
  "xpMin",
  "xpMax",
  "xpCooldownSeconds",
  "xpExcludedChannelIds",
  "xpExcludedRoleIds",
  "isBirthdayEnabled",
  "birthdayMessage",
  "birthdayTimezone",
];

const DISCORD_IDS = [
  "verificationRoleId",
  "welcomeChannelId",
  "logChannelId",
  "introChannelId",
  "introRoleId",
  "modNotesChannelId",
  "xpLevelupChannelId",
  "birthdayChannelId",
  "birthdayRoleId",
];

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

const HP_CHANNEL = "300000000000000009";
const OTHER_CHANNEL = "300000000000000010";

/** Runs both the legacy copy and the extracted builder; asserts they agree byte for byte and returns the result. */
function build(settings: GuildSettings, saved: GuildSettings | null, hasDiscordData: boolean) {
  const legacy = legacyBuildUpdateFields(settings, saved, hasDiscordData);
  const extracted = buildSettingsPatch(settings, saved, hasDiscordData);
  expect(Object.keys(extracted)).toEqual(Object.keys(legacy));
  expect(JSON.stringify(extracted)).toBe(JSON.stringify(legacy));
  return legacy;
}

describe("buildSettingsPatch", () => {
  it("always sends exactly the 28 non-Discord fields, in this order, with the settings values", () => {
    const s = makeSettings();
    const body = build(s, makeSettings(), false);
    expect(Object.keys(body)).toEqual(ALWAYS_SENT);
    for (const k of ALWAYS_SENT) expect(body[k]).toBe(s[k as keyof GuildSettings]);
  });

  it("pins the exact JSON body of a plain edit without Discord data", () => {
    const s = makeSettings({ welcomeMessage: "Hi" });
    expect(JSON.stringify(build(s, makeSettings(), false))).toBe(
      '{"isVerificationSyncEnabled":true,"isBanSyncEnabled":false,"welcomeMessage":"Hi","isWelcomeEnabled":true,' +
        '"dmWelcomeMessage":null,"isDmWelcomeEnabled":false,"isLoggingEnabled":true,"logEvents":["member_join","ban"],' +
        '"isIntroGateEnabled":false,"introMinChars":24,"introMinWords":5,"introMinSubstantiveWords":3,' +
        '"introUniqueWordRatio":50,"introMaxRepeatedCharPct":50,"isSuggestionsEnabled":true,"isAskEnabled":true,' +
        '"askSystemPrompt":null,"offtopicImages":["https://example.com/a.png"],"offtopicMessage":"Off topic",' +
        '"isXpEnabled":false,"xpMin":15,"xpMax":25,"xpCooldownSeconds":60,"xpExcludedChannelIds":[],' +
        '"xpExcludedRoleIds":["200000000000000003"],"isBirthdayEnabled":false,"birthdayMessage":null,' +
        '"birthdayTimezone":"America/New_York"}',
    );
  });

  it("leaves out all honeypot fields when they equal the saved ones", () => {
    const s = makeSettings({ isHoneypotEnabled: true, honeypotAction: "ban", honeypotChannelId: HP_CHANNEL });
    const body = build(s, { ...s }, true);
    expect(Object.keys(body)).toEqual([...ALWAYS_SENT, ...DISCORD_IDS]);
  });

  it("sends all three honeypot fields when the save turns it on with Discord data, even if action and channel are unchanged", () => {
    const saved = makeSettings({ isHoneypotEnabled: false, honeypotAction: "kick", honeypotChannelId: HP_CHANNEL });
    const s = { ...saved, isHoneypotEnabled: true };
    const body = build(s, saved, true);
    expect(Object.keys(body)).toEqual([...ALWAYS_SENT, "isHoneypotEnabled", "honeypotAction", ...DISCORD_IDS, "honeypotChannelId"]);
    expect(body.isHoneypotEnabled).toBe(true);
    expect(body.honeypotAction).toBe("kick");
    expect(body.honeypotChannelId).toBe(HP_CHANNEL);
  });

  it("turning it on without Discord data sends the flag and action but not the channel", () => {
    const saved = makeSettings({ honeypotChannelId: HP_CHANNEL });
    const body = build({ ...saved, isHoneypotEnabled: true }, saved, false);
    expect(Object.keys(body)).toEqual([...ALWAYS_SENT, "isHoneypotEnabled", "honeypotAction"]);
  });

  it("turning it off sends only the flag; the channel only when it changed", () => {
    const saved = makeSettings({ isHoneypotEnabled: true, honeypotAction: "ban", honeypotChannelId: HP_CHANNEL });
    const off = build({ ...saved, isHoneypotEnabled: false }, saved, true);
    expect(Object.keys(off)).toEqual([...ALWAYS_SENT, "isHoneypotEnabled", ...DISCORD_IDS]);
    expect(off.isHoneypotEnabled).toBe(false);

    const offAndCleared = build({ ...saved, isHoneypotEnabled: false, honeypotChannelId: null }, saved, true);
    expect(Object.keys(offAndCleared)).toEqual([...ALWAYS_SENT, "isHoneypotEnabled", ...DISCORD_IDS, "honeypotChannelId"]);
    expect(offAndCleared.honeypotChannelId).toBeNull();
  });

  it("only the action changed while enabled: sends only honeypotAction", () => {
    const saved = makeSettings({ isHoneypotEnabled: true, honeypotAction: "kick", honeypotChannelId: HP_CHANNEL });
    const body = build({ ...saved, honeypotAction: "ban" }, saved, false);
    expect(Object.keys(body)).toEqual([...ALWAYS_SENT, "honeypotAction"]);
    expect(body.honeypotAction).toBe("ban");
  });

  it("only the channel changed: sent with Discord data, left out without", () => {
    const saved = makeSettings({ isHoneypotEnabled: true, honeypotChannelId: HP_CHANNEL });
    const s = { ...saved, honeypotChannelId: OTHER_CHANNEL };
    expect(Object.keys(build(s, saved, true))).toEqual([...ALWAYS_SENT, ...DISCORD_IDS, "honeypotChannelId"]);
    expect(Object.keys(build(s, saved, false))).toEqual(ALWAYS_SENT);
  });

  it("with Discord data adds exactly the nine role and channel IDs, nulls included", () => {
    const s = makeSettings();
    const body = build(s, makeSettings(), true);
    expect(Object.keys(body)).toEqual([...ALWAYS_SENT, ...DISCORD_IDS]);
    for (const k of DISCORD_IDS) expect(body[k]).toBe(s[k as keyof GuildSettings]);
    expect(body.introChannelId).toBeNull();
  });

  it("without Discord data sends none of the IDs", () => {
    const body = build(makeSettings({ welcomeChannelId: null }), makeSettings(), false);
    for (const k of [...DISCORD_IDS, "honeypotChannelId"]) expect(k in body).toBe(false);
  });

  it("saved = null: honeypot fields compare against undefined", () => {
    const off = build(makeSettings(), null, true);
    expect(Object.keys(off)).toEqual([...ALWAYS_SENT, "isHoneypotEnabled", "honeypotAction", ...DISCORD_IDS, "honeypotChannelId"]);
    expect(off.isHoneypotEnabled).toBe(false);
    expect(off.honeypotChannelId).toBeNull();

    const on = build(makeSettings({ isHoneypotEnabled: true, honeypotChannelId: HP_CHANNEL }), null, false);
    expect(Object.keys(on)).toEqual([...ALWAYS_SENT, "isHoneypotEnabled", "honeypotAction"]);
  });

  it("matches the legacy logic over every honeypot combination", () => {
    const enabledStates = [true, false];
    const actions = ["kick", "ban"] as const;
    const chans = [null, HP_CHANNEL, OTHER_CHANNEL];
    let cases = 0;
    for (const savedEnabled of enabledStates)
      for (const enabled of enabledStates)
        for (const savedAction of actions)
          for (const action of actions)
            for (const savedChan of chans)
              for (const chan of chans)
                for (const discord of [true, false])
                  for (const savedIsNull of [false, true]) {
                    const saved = savedIsNull
                      ? null
                      : makeSettings({ isHoneypotEnabled: savedEnabled, honeypotAction: savedAction, honeypotChannelId: savedChan });
                    const s = makeSettings({ isHoneypotEnabled: enabled, honeypotAction: action, honeypotChannelId: chan });
                    build(s, saved, discord);
                    cases++;
                  }
    expect(cases).toBe(576);
  });

  it("does not mutate its inputs and returns a fresh object", () => {
    const s = makeSettings({ isHoneypotEnabled: true });
    const saved = makeSettings();
    const sCopy = JSON.stringify(s);
    const savedCopy = JSON.stringify(saved);
    const a = buildSettingsPatch(s, saved, true);
    const b = buildSettingsPatch(s, saved, true);
    expect(a).not.toBe(b);
    expect(JSON.stringify(s)).toBe(sCopy);
    expect(JSON.stringify(saved)).toBe(savedCopy);
  });

  it("every key it can send is accepted by guildSettingsUpdateSchema and has a FIELD_SCOPE_MAP entry", () => {
    const s = makeSettings({ isHoneypotEnabled: true, honeypotChannelId: HP_CHANNEL });
    const body = build(s, null, true);
    const parsed = guildSettingsUpdateSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data!).sort()).toEqual(Object.keys(body).sort());
    for (const k of Object.keys(body)) expect(FIELD_SCOPE_MAP[k as keyof typeof FIELD_SCOPE_MAP]).toBeDefined();
  });
});
