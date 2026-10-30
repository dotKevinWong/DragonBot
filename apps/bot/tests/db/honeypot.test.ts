import { describe, it, expect } from "vitest";
import { findHoneypotChannelConflict } from "@dragonbot/db";

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
