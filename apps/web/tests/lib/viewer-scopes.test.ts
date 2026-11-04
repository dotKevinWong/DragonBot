import { describe, expect, it } from "vitest";
import { canWriteScope, missingScopeNote, type WriteScope } from "@/lib/viewer-scopes";

// Audit B1 follow-up: the client-side check that decides whether a feature page shows its write
// controls. It must agree with the write routes, which allow the scope or "*" (grantsScope).

const SCOPES: WriteScope[] = ["schedules", "youtube", "suggestions"];

describe("canWriteScope", () => {
  for (const scope of SCOPES) {
    describe(scope, () => {
      it("allows full access", () => {
        expect(canWriteScope(["*"], scope)).toBe(true);
        expect(canWriteScope(["welcome", "*"], scope)).toBe(true);
      });

      it("allows the scope itself, alone or among others", () => {
        expect(canWriteScope([scope], scope)).toBe(true);
        expect(canWriteScope(["welcome", scope, "xp"], scope)).toBe(true);
      });

      it("refuses other scopes and no grants", () => {
        expect(canWriteScope([], scope)).toBe(false);
        expect(canWriteScope(["welcome"], scope)).toBe(false);
        expect(canWriteScope(SCOPES.filter((s) => s !== scope), scope)).toBe(false);
        expect(canWriteScope([scope.toUpperCase()], scope)).toBe(false);
        expect(canWriteScope([`${scope} `], scope)).toBe(false);
      });

      it("treats unknown grants as allowed (not loaded, failed, or no array in the response)", () => {
        for (const unknownGrants of [undefined, null, "*", scope, {}, 1, true]) {
          expect(canWriteScope(unknownGrants, scope)).toBe(true);
        }
      });

      it("ignores non-string entries", () => {
        expect(canWriteScope([1, null, { scope }], scope)).toBe(false);
        expect(canWriteScope([1, scope], scope)).toBe(true);
      });
    });
  }
});

describe("missingScopeNote", () => {
  it("names the scope in one line", () => {
    expect(missingScopeNote("schedules")).toBe("You need the schedules permission to make changes.");
    expect(missingScopeNote("youtube")).toBe("You need the youtube permission to make changes.");
    expect(missingScopeNote("suggestions")).toBe("You need the suggestions permission to make changes.");
  });
});
