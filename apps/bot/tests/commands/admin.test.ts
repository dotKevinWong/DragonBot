import { describe, it, expect, vi } from "vitest";
import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { PERMISSION_SCOPES } from "@dragonbot/db";
import command from "../../src/commands/admin.js";
import type { BotContext } from "../../src/types/context.js";
import { AppError, ErrorCode } from "../../src/types/errors.js";

// Pins /admin managers-add and managers-update: parsing, scope validation, the grant guard and the AppError catch.

const VALID = `Valid: \`${PERMISSION_SCOPES.join(", ")}\``;

interface Opts {
  sub: "managers-add" | "managers-update";
  perms: string;
  manageGuild?: boolean;
  hasManagersScope?: boolean;
  callerPerms?: string[];
  writeError?: Error;
}

function setup(o: Opts) {
  const target = { id: "t1", toString: () => "<@t1>" };
  const editReply = vi.fn(async (_arg: unknown) => undefined);
  const interaction = {
    guildId: "g1",
    guild: { name: "Guild" },
    user: { id: "u1" },
    memberPermissions: {
      has: vi.fn((flag: bigint) => (flag === PermissionFlagsBits.ManageGuild ? (o.manageGuild ?? false) : false)),
    },
    options: {
      getSubcommand: () => o.sub,
      getUser: vi.fn(() => target),
      getString: vi.fn(() => o.perms),
    },
    editReply,
  } as unknown as ChatInputCommandInteraction;
  const write = vi.fn(async () => {
    if (o.writeError) throw o.writeError;
    return {};
  });
  const guildAdmin = {
    hasPermission: vi.fn(async () => o.hasManagersScope ?? true),
    hasAnyPermission: vi.fn(async () => true),
    getPermissions: vi.fn(async () => o.callerPerms ?? ["managers"]),
    addAdmin: o.sub === "managers-add" ? write : vi.fn(),
    updatePermissions: o.sub === "managers-update" ? write : vi.fn(),
  };
  const ctx = {
    logger: { error: vi.fn() },
    services: {
      guild: { ensureGuild: vi.fn(async () => undefined) },
      guildAdmin,
    },
  } as unknown as BotContext;
  const reply = () => {
    expect(editReply).toHaveBeenCalledTimes(1);
    const embed = (editReply.mock.calls[0]![0] as { embeds: { data: { description: string; color: number } }[] }).embeds[0]!;
    return embed.data;
  };
  return { interaction, ctx, guildAdmin, write, editReply, reply };
}

const SUBS = [
  { sub: "managers-add" as const, success: (p: string) => `Added <@t1> as a manager with permissions: \`${p}\`` },
  { sub: "managers-update" as const, success: (p: string) => `Updated <@t1> permissions to: \`${p}\`` },
];

describe.each(SUBS)("/admin $sub", ({ sub, success }) => {
  it("reports invalid scopes before any grant check", async () => {
    const s = setup({ sub, perms: "xp,bogus", callerPerms: ["managers"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe(`Invalid permissions: \`bogus\`\n${VALID}`);
    expect(s.reply().color).toBe(0xff0000);
    expect(s.guildAdmin.getPermissions).not.toHaveBeenCalled();
    expect(s.write).not.toHaveBeenCalled();
  });

  it("reports invalid scopes even when the caller also lacks other scopes", async () => {
    const s = setup({ sub, perms: "logging,nope,*,Zzz", callerPerms: ["managers"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe(`Invalid permissions: \`nope, zzz\`\n${VALID}`);
    expect(s.guildAdmin.getPermissions).not.toHaveBeenCalled();
  });

  it("treats an empty permissions string as one invalid empty scope", async () => {
    const s = setup({ sub, perms: "" });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe(`Invalid permissions: \`\`\n${VALID}`);
  });

  it("does not drop empty items between commas", async () => {
    const s = setup({ sub, perms: "xp,,managers", callerPerms: ["managers", "xp"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe(`Invalid permissions: \`\`\n${VALID}`);
  });

  it("refuses * from a caller without * or Manage Server", async () => {
    const s = setup({ sub, perms: "*", callerPerms: ["managers", "xp"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe("You can only grant permissions you have. Missing: *");
    expect(s.guildAdmin.getPermissions).toHaveBeenCalledWith("g1", "u1");
    expect(s.write).not.toHaveBeenCalled();
  });

  it("reports only * when * and an unheld scope are both requested", async () => {
    const s = setup({ sub, perms: "*,logging", callerPerms: ["managers"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe("You can only grant permissions you have. Missing: *");
  });

  it("lists unheld scopes in request order", async () => {
    const s = setup({ sub, perms: "xp,logging", callerPerms: ["managers", "xp"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe("You can only grant permissions you have. Missing: logging");
    expect(s.write).not.toHaveBeenCalled();
  });

  it("lists several unheld scopes joined by comma, duplicates kept", async () => {
    const s = setup({ sub, perms: "welcome,xp,logging,welcome", callerPerms: ["managers", "xp"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe("You can only grant permissions you have. Missing: welcome, logging, welcome");
  });

  it("lets a * holder grant * and anything else", async () => {
    const s = setup({ sub, perms: "*,logging", callerPerms: ["*"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.write).toHaveBeenCalledWith("g1", "t1", ["*", "logging"], "u1");
    expect(s.reply().description).toBe(success("*, logging"));
    expect(s.reply().color).toBe(0x43b581);
  });

  it("lets a Manage Server caller grant * without reading their grants", async () => {
    const s = setup({ sub, perms: "*", manageGuild: true });
    await command.execute(s.interaction, s.ctx);
    expect(s.guildAdmin.getPermissions).not.toHaveBeenCalled();
    expect(s.guildAdmin.hasPermission).not.toHaveBeenCalled();
    expect(s.write).toHaveBeenCalledWith("g1", "t1", ["*"], "u1");
    expect(s.reply().description).toBe(success("*"));
  });

  it("lets a caller grant scopes they hold, trimmed and lowercased, duplicates kept", async () => {
    const s = setup({ sub, perms: " XP , Managers ,xp", callerPerms: ["managers", "xp"] });
    await command.execute(s.interaction, s.ctx);
    expect(s.write).toHaveBeenCalledWith("g1", "t1", ["xp", "managers", "xp"], "u1");
    expect(s.reply().description).toBe(success("xp, managers, xp"));
  });

  it("shows an AppError from the service", async () => {
    const s = setup({
      sub,
      perms: "xp",
      callerPerms: ["managers", "xp"],
      writeError: new AppError(ErrorCode.ADMIN_NOT_FOUND, "That user is not a guild manager."),
    });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe("That user is not a guild manager.");
    expect(s.ctx.logger.error).not.toHaveBeenCalled();
  });

  it("rethrows any other error to the loader", async () => {
    const boom = new Error("db down");
    const s = setup({ sub, perms: "xp", callerPerms: ["managers", "xp"], writeError: boom });
    await expect(command.execute(s.interaction, s.ctx)).rejects.toBe(boom);
    expect(s.editReply).not.toHaveBeenCalled();
  });

  it("refuses a caller without Manage Server or the managers scope before parsing", async () => {
    const s = setup({ sub, perms: "bogus", hasManagersScope: false });
    await command.execute(s.interaction, s.ctx);
    expect(s.reply().description).toBe("You don't have permission to manage guild managers.");
    expect(s.guildAdmin.hasPermission).toHaveBeenCalledWith("g1", "u1", "managers");
    expect(s.guildAdmin.getPermissions).not.toHaveBeenCalled();
    expect(s.write).not.toHaveBeenCalled();
  });
});
