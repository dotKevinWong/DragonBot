import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { authTokens, guildAdmins, scheduledMessages, suggestions } from "@dragonbot/db";

// P14 adds indexes only. This pins every index and unique constraint on the
// touched tables, old and new, so none is removed by accident.

function shape(table: PgTable) {
  const cfg = getTableConfig(table);
  return {
    indexes: cfg.indexes
      .map((i) => `${i.config.name}(${i.config.columns.map((c) => ("name" in c ? c.name : "?")).join(",")})${i.config.unique ? " unique" : ""}`)
      .sort(),
    uniques: cfg.uniqueConstraints.map((u) => `${u.name}(${u.columns.map((c) => c.name).join(",")})`).sort(),
    uniqueColumns: cfg.columns.filter((c) => c.isUnique).map((c) => c.name).sort(),
  };
}

describe("schema indexes", () => {
  it("guild_admins", () => {
    expect(shape(guildAdmins)).toEqual({
      indexes: ["guild_admins_discord_idx(discord_id)"],
      uniques: ["guild_admins_guild_id_discord_id_unique(guild_id,discord_id)"],
      uniqueColumns: [],
    });
  });

  it("scheduled_messages", () => {
    expect(shape(scheduledMessages)).toEqual({
      indexes: ["scheduled_messages_guild_idx(guild_id)"],
      uniques: [],
      uniqueColumns: [],
    });
  });

  it("auth_tokens keeps the token unique and its old index", () => {
    expect(shape(authTokens)).toEqual({
      indexes: ["auth_tokens_expires_idx(expires_at)", "auth_tokens_token_idx(token)"],
      uniques: [],
      uniqueColumns: ["token"],
    });
  });

  it("suggestions keeps its old index", () => {
    expect(shape(suggestions)).toEqual({
      indexes: ["suggestions_guild_created_idx(guild_id,created_at)", "suggestions_guild_idx(guild_id)"],
      uniques: [],
      uniqueColumns: [],
    });
  });
});
