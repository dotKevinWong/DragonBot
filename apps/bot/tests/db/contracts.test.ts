import { describe, expect, it } from "vitest";
import * as root from "@dragonbot/db";
import * as contracts from "@dragonbot/db/contracts";
import * as schema from "@dragonbot/db/schema";
import * as permissions from "@dragonbot/db/permissions";
import * as honeypot from "@dragonbot/db/honeypot";
import * as serverless from "@dragonbot/db/serverless";

// D4: the shared contracts must equal the copies they replaced, byte for byte.

describe("shared contracts", () => {
  it("LOG_EVENTS is the nine events in the old order", () => {
    expect([...contracts.LOG_EVENTS]).toEqual([
      "member_join", "member_leave", "message_delete", "message_edit",
      "role_change", "nickname_change", "voice_activity", "kick", "ban",
    ]);
  });

  it("SUGGESTION_STATUSES is the API's five statuses in order", () => {
    expect([...contracts.SUGGESTION_STATUSES]).toEqual(["pending", "approved", "rejected", "completed", "archived"]);
  });

  it("each regex equals the literal it replaced, flags included", () => {
    const same = (a: RegExp, b: RegExp) => {
      expect(a.source).toBe(b.source);
      expect(a.flags).toBe(b.flags);
    };
    same(contracts.DISCORD_SNOWFLAKE_RE, /^[0-9]{17,20}$/);
    same(contracts.UUID_RE, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    same(contracts.YOUTUBE_CHANNEL_ID_RE, /^UC[\w-]{22}$/);
  });

  it("the regexes keep no state between .test() calls", () => {
    for (let i = 0; i < 3; i++) {
      expect(contracts.UUID_RE.test("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
      expect(contracts.DISCORD_SNOWFLAKE_RE.test("123456789012345678")).toBe(true);
      expect(contracts.YOUTUBE_CHANNEL_ID_RE.test(`UC${"a".repeat(22)}`)).toBe(true);
    }
  });
});

describe("package entry points (P17)", () => {
  it("the root exports exactly the subpath modules plus the two client factories", () => {
    const union = new Set([
      ...Object.keys(schema), ...Object.keys(permissions), ...Object.keys(honeypot),
      ...Object.keys(contracts), ...Object.keys(serverless), "createBotClient",
    ]);
    expect(new Set(Object.keys(root))).toEqual(union);
  });

  it("subpaths hand out the same objects as the root", () => {
    expect(schema.guilds).toBe(root.guilds);
    expect(honeypot.HONEYPOT_ACTIONS).toBe(root.HONEYPOT_ACTIONS);
    expect(contracts.LOG_EVENTS).toBe(root.LOG_EVENTS);
  });

  it("the unused SUBCOMMAND_SCOPE_MAP is gone (X8)", () => {
    expect("SUBCOMMAND_SCOPE_MAP" in root).toBe(false);
  });
});
