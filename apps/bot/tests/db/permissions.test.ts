import { describe, expect, it } from "vitest";
import { FIELD_SCOPE_MAP, PERMISSION_SCOPES, grantsScope, missingScopes, requiredScopesForFields } from "@dragonbot/db";
import * as permissionsSubpath from "@dragonbot/db/permissions";

// Characterization of the permission constants (X8 removes an unused sibling;
// D3 adds helpers next to them; these must not move).

describe("PERMISSION_SCOPES", () => {
  it("holds the 14 scopes in order", () => {
    expect([...PERMISSION_SCOPES]).toEqual([
      "verification", "welcome", "logging", "intro_gate", "moderation", "suggestions", "ai",
      "offtopic", "xp", "schedules", "birthday", "youtube", "managers", "*",
    ]);
  });
});

describe("FIELD_SCOPE_MAP", () => {
  it("maps every field to a known scope", () => {
    for (const scope of Object.values(FIELD_SCOPE_MAP)) {
      expect(PERMISSION_SCOPES as readonly string[]).toContain(scope);
    }
  });

  it("is unchanged, entry for entry and in order", () => {
    expect(Object.entries(FIELD_SCOPE_MAP)).toEqual([
      ["verificationRoleId", "verification"], ["isVerificationSyncEnabled", "verification"],
      ["isBanSyncEnabled", "moderation"], ["modNotesChannelId", "moderation"],
      ["isHoneypotEnabled", "*"], ["honeypotChannelId", "*"], ["honeypotAction", "*"],
      ["welcomeChannelId", "welcome"], ["welcomeMessage", "welcome"], ["isWelcomeEnabled", "welcome"],
      ["dmWelcomeMessage", "welcome"], ["isDmWelcomeEnabled", "welcome"],
      ["logChannelId", "logging"], ["isLoggingEnabled", "logging"], ["logEvents", "logging"],
      ["introChannelId", "intro_gate"], ["introRoleId", "intro_gate"], ["isIntroGateEnabled", "intro_gate"],
      ["introMinChars", "intro_gate"], ["introMinWords", "intro_gate"], ["introMinSubstantiveWords", "intro_gate"],
      ["introUniqueWordRatio", "intro_gate"], ["introMaxRepeatedCharPct", "intro_gate"],
      ["isSuggestionsEnabled", "suggestions"],
      ["isAskEnabled", "ai"], ["askSystemPrompt", "ai"],
      ["offtopicImages", "offtopic"], ["offtopicMessage", "offtopic"],
      ["isXpEnabled", "xp"], ["xpMin", "xp"], ["xpMax", "xp"], ["xpCooldownSeconds", "xp"],
      ["xpLevelupChannelId", "xp"], ["xpExcludedChannelIds", "xp"], ["xpExcludedRoleIds", "xp"],
      ["isBirthdayEnabled", "birthday"], ["birthdayChannelId", "birthday"], ["birthdayRoleId", "birthday"],
      ["birthdayMessage", "birthday"], ["birthdayTimezone", "birthday"],
      ["isYoutubeEnabled", "youtube"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// D3 helpers. Each is checked against a verbatim copy of the inline rule it
// replaces, over every combination of the grant lists and scopes below.

/** apps/web/src/lib/discord.ts checkGuildPermission, after the Discord check, as of HEAD 646aa3a. */
function webRule(permissions: string[], scope?: string): boolean {
  if (permissions.length === 0) return false;
  if (permissions.includes("*")) return true;
  if (!scope) return true;
  return permissions.includes(scope);
}

/** apps/bot GuildAdminService.hasPermission / hasAnyPermission, as of HEAD 646aa3a. */
function botHasPermission(admin: { permissions: string[] } | null, scope: string): boolean {
  if (!admin) return false;
  return admin.permissions.includes("*") || admin.permissions.includes(scope);
}
function botHasAny(admin: { permissions: string[] } | null): boolean {
  return admin !== null && admin.permissions.length > 0;
}

/** apps/web/src/app/api/server/[guildId]/route.ts PATCH missing-scope block, as of HEAD 646aa3a. */
function webPatchMissing(fields: string[], userPermissions: string[]): string[] | "skipped" {
  if (!userPermissions.includes("*")) {
    const requiredScopes = new Set<string>();
    for (const field of fields) {
      const scope = FIELD_SCOPE_MAP[field];
      if (scope) requiredScopes.add(scope);
    }
    return [...requiredScopes].filter((scope) => !userPermissions.includes(scope));
  }
  return "skipped";
}

const GRANTS: string[][] = [[], ["*"], ["logging"], ["moderation"], ["logging", "xp"], ["*", "xp"], ["Logging"], [""]];
const SCOPES: (string | undefined)[] = [undefined, "", "logging", "xp", "moderation", "*", "managers"];

describe("grantsScope", () => {
  it("matches the web rule for every grant list and scope", () => {
    for (const g of GRANTS) for (const s of SCOPES) expect(grantsScope(g, s)).toBe(webRule(g, s));
  });

  it("matches the bot's hasPermission for every non-empty scope, including a missing row", () => {
    for (const row of [null, ...GRANTS.map((permissions) => ({ permissions }))]) {
      for (const s of SCOPES) {
        if (!s) continue; // the bot is only ever called with a PermissionScope literal
        expect(grantsScope(row?.permissions ?? [], s)).toBe(botHasPermission(row, s));
      }
    }
  });

  it("matches the bot's hasAnyPermission, including a missing row", () => {
    for (const row of [null, ...GRANTS.map((permissions) => ({ permissions }))]) {
      expect(grantsScope(row?.permissions ?? [])).toBe(botHasAny(row));
    }
  });

  it("pins the documented cases", () => {
    expect(grantsScope([], undefined)).toBe(false);
    expect(grantsScope([], "*")).toBe(false);
    expect(grantsScope(["*"], "logging")).toBe(true);
    expect(grantsScope(["xp"])).toBe(true);
    expect(grantsScope(["xp"], "logging")).toBe(false);
    expect(grantsScope(["moderation"], "*")).toBe(false);
  });
});

describe("requiredScopesForFields + missingScopes", () => {
  const FIELD_SETS: string[][] = [
    [],
    ["logChannelId"],
    ["logChannelId", "isLoggingEnabled", "logEvents"],
    ["xpMin", "logChannelId", "xpMax", "welcomeMessage"],
    ["isHoneypotEnabled", "logChannelId"],
    ["notAField", "birthdayRoleId", "unknown"],
    ["honeypotAction", "honeypotChannelId", "isYoutubeEnabled"],
  ];
  const CALLERS: string[][] = [["logging"], ["xp", "welcome"], ["moderation"], ["*"], ["birthday", "youtube"], ["logging", "*"]];

  it("together give exactly what the PATCH block gave (callers with '*' skip the block)", () => {
    for (const f of FIELD_SETS) {
      for (const c of CALLERS) {
        const old = webPatchMissing(f, c);
        const now = missingScopes(requiredScopesForFields(f), c);
        if (old === "skipped") expect(now).toEqual([]);
        else expect(now).toEqual(old);
      }
    }
  });

  it("keeps first-seen order and drops unmapped fields", () => {
    expect(requiredScopesForFields(["xpMin", "logChannelId", "xpMax", "nope", "isHoneypotEnabled"])).toEqual(["xp", "logging", "*"]);
  });

  it("reports a required '*' as '*' for a caller without it", () => {
    expect(missingScopes(["*", "logging"], ["logging"])).toEqual(["*"]);
  });
});

describe("@dragonbot/db/permissions subpath", () => {
  it("is the same module as the root's permissions exports", () => {
    expect(permissionsSubpath.FIELD_SCOPE_MAP).toBe(FIELD_SCOPE_MAP);
    expect(permissionsSubpath.PERMISSION_SCOPES).toBe(PERMISSION_SCOPES);
    expect(permissionsSubpath.grantsScope).toBe(grantsScope);
  });
});
