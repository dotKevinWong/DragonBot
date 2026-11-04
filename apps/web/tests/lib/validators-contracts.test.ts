import { describe, expect, it } from "vitest";
import { DISCORD_SNOWFLAKE_RE, guildSettingsUpdateSchema } from "@/lib/validators";

// Characterization of the shared contracts the settings validator relies on (D4, P17).

const LOG_EVENTS = [
  "member_join", "member_leave", "message_delete", "message_edit",
  "role_change", "nickname_change", "voice_activity", "kick", "ban",
];

describe("guildSettingsUpdateSchema logEvents", () => {
  it("accepts each of the nine log events, alone and all together", () => {
    for (const e of LOG_EVENTS) {
      expect(guildSettingsUpdateSchema.safeParse({ logEvents: [e] }).success).toBe(true);
    }
    expect(guildSettingsUpdateSchema.safeParse({ logEvents: LOG_EVENTS }).data).toEqual({ logEvents: LOG_EVENTS });
  });

  it("rejects an unknown or empty event and pins the zod issue", () => {
    for (const bad of ["bogus", "", "Kick"]) {
      expect(guildSettingsUpdateSchema.safeParse({ logEvents: [bad] }).success).toBe(false);
    }
    const res = guildSettingsUpdateSchema.safeParse({ logEvents: ["bogus"] });
    expect(res.success).toBe(false);
    expect(res.error!.issues).toEqual([
      {
        received: "bogus",
        code: "invalid_enum_value",
        options: LOG_EVENTS,
        path: ["logEvents", 0],
        message: `Invalid enum value. Expected ${LOG_EVENTS.map((e) => `'${e}'`).join(" | ")}, received 'bogus'`,
      },
    ]);
  });
});

describe("guildSettingsUpdateSchema snowflake fields", () => {
  it("accepts 17 and 20 digits and rejects 16, 21 and non-digits", () => {
    const ok = (v: string) => guildSettingsUpdateSchema.safeParse({ logChannelId: v }).success;
    expect(ok("1".repeat(17))).toBe(true);
    expect(ok("1".repeat(20))).toBe(true);
    expect(ok("1".repeat(16))).toBe(false);
    expect(ok("1".repeat(21))).toBe(false);
    expect(ok("1234567890123456a")).toBe(false);
    expect(guildSettingsUpdateSchema.safeParse({ xpExcludedRoleIds: ["1".repeat(18), "x"] }).success).toBe(false);
  });

  it("pins the zod issue for a bad snowflake", () => {
    const res = guildSettingsUpdateSchema.safeParse({ welcomeChannelId: "123" });
    expect(res.error!.issues).toEqual([
      { validation: "regex", code: "invalid_string", message: "Invalid", path: ["welcomeChannelId"] },
    ]);
  });
});

describe("DISCORD_SNOWFLAKE_RE", () => {
  it("is the anchored 17-20 digit pattern with no flags", () => {
    expect(DISCORD_SNOWFLAKE_RE.source).toBe("^[0-9]{17,20}$");
    expect(DISCORD_SNOWFLAKE_RE.flags).toBe("");
  });
});

describe("guildSettingsUpdateSchema honeypotAction", () => {
  it("accepts kick and ban only", () => {
    expect(guildSettingsUpdateSchema.safeParse({ honeypotAction: "kick" }).success).toBe(true);
    expect(guildSettingsUpdateSchema.safeParse({ honeypotAction: "ban" }).success).toBe(true);
    expect(guildSettingsUpdateSchema.safeParse({ honeypotAction: "mute" }).success).toBe(false);
  });
});
