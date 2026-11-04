import { describe, it, expect } from "vitest";
import { FIELD_SCOPE_MAP, findHoneypotChannelConflict, isRepeatSpamArmed } from "@dragonbot/db";

describe("honeypot field scopes", () => {
  it("needs full access for the honeypot fields and keeps the other moderation fields on moderation", () => {
    expect(FIELD_SCOPE_MAP.isHoneypotEnabled).toBe("*");
    expect(FIELD_SCOPE_MAP.honeypotChannelId).toBe("*");
    expect(FIELD_SCOPE_MAP.honeypotAction).toBe("*");
    expect(FIELD_SCOPE_MAP.isBanSyncEnabled).toBe("moderation");
    expect(FIELD_SCOPE_MAP.modNotesChannelId).toBe("moderation");
  });
});

describe("findHoneypotChannelConflict", () => {
  it("finds no conflict when the honeypot channel is unset or unique", () => {
    expect(findHoneypotChannelConflict({ honeypotChannelId: null, logChannelId: "1" })).toBeNull();
    expect(findHoneypotChannelConflict({ honeypotChannelId: null, welcomeChannelId: null, introChannelId: null })).toBeNull();
    expect(findHoneypotChannelConflict({ honeypotChannelId: "9", logChannelId: "1", introChannelId: null })).toBeNull();
  });

  it("names the channel the honeypot collides with", () => {
    expect(findHoneypotChannelConflict({ honeypotChannelId: "5", introChannelId: "5" })).toBe("intro");
    expect(findHoneypotChannelConflict({ honeypotChannelId: "5", xpLevelupChannelId: "5" })).toBe("level-up");
  });

  it("checks every other channel configured for the server", () => {
    const labels = {
      welcomeChannelId: "welcome",
      logChannelId: "log",
      introChannelId: "intro",
      modNotesChannelId: "mod notes",
      xpLevelupChannelId: "level-up",
      birthdayChannelId: "birthday",
    };
    for (const [field, label] of Object.entries(labels)) {
      expect(findHoneypotChannelConflict({ honeypotChannelId: "5", [field]: "5" })).toBe(label);
    }
  });
});

describe("repeated-message check settings", () => {
  const armed = { isRepeatSpamEnabled: true, repeatSpamChannelCount: 3, repeatSpamMatchMode: "ignore_case" };

  it("arms the repeated-message check only when it's on with a known level and a count from 2 to 10", () => {
    expect(isRepeatSpamArmed(armed)).toBe(true);
    expect(isRepeatSpamArmed({ ...armed, repeatSpamChannelCount: 2 })).toBe(true);
    expect(isRepeatSpamArmed({ ...armed, repeatSpamChannelCount: 10 })).toBe(true);
    expect(isRepeatSpamArmed({ ...armed, isRepeatSpamEnabled: false })).toBe(false);
    for (const count of [1, 11, 2.5]) expect(isRepeatSpamArmed({ ...armed, repeatSpamChannelCount: count })).toBe(false);
    expect(isRepeatSpamArmed({ ...armed, repeatSpamMatchMode: "fuzzy" })).toBe(false);
  });

  it("needs full access for the repeated-message fields", () => {
    for (const field of ["isRepeatSpamEnabled", "repeatSpamChannelCount", "repeatSpamMatchMode"]) {
      expect(FIELD_SCOPE_MAP[field]).toBe("*");
    }
  });
});
