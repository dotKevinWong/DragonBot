import { describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import command from "../../src/commands/verify.js";
import { AppError, ErrorCode } from "../../src/types/errors.js";
import type { BotContext } from "../../src/types/context.js";

/**
 * u1 runs /verify `sub` in g1, whose verification role is `roleId`. Discord and the services are fakes.
 */
function setup(
  sub: "code" | "sync",
  options: {
    roleId?: string | null;
    noGuild?: boolean;
    memberFetchError?: Error;
    roleAddError?: Error;
    verified?: boolean;
  } = {},
) {
  const roleAdd = vi.fn(async (_roleId: string) => {
    if (options.roleAddError) throw options.roleAddError;
  });
  const membersFetch = vi.fn(async (_userId: string) => {
    if (options.memberFetchError) throw options.memberFetchError;
    return { roles: { add: roleAdd } };
  });
  const editReply = vi.fn(async (_payload: { embeds: EmbedBuilder[] }) => undefined);
  const interaction = {
    guildId: "g1",
    guild: options.noGuild ? null : { members: { fetch: membersFetch } },
    user: { id: "u1" },
    options: { getSubcommand: () => sub, getString: () => "ABC123" },
    editReply,
  } as unknown as ChatInputCommandInteraction;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const getSettings = vi.fn(async (_guildId: string) => ({
    verificationRoleId: options.roleId === undefined ? "verified-role" : options.roleId,
  }));
  const ctx = {
    logger: { child: vi.fn(() => log) },
    services: {
      guild: { getSettings },
      verification: { confirmVerification: vi.fn(async () => ({ email: "u1@drexel.edu" })) },
      user: { isVerified: vi.fn(async () => options.verified ?? true) },
    },
  } as unknown as BotContext;
  return { interaction, ctx, log, membersFetch, roleAdd, editReply, getSettings };
}

function replies(editReply: ReturnType<typeof setup>["editReply"]) {
  return editReply.mock.calls.map(([payload]) => payload.embeds.map((embed) => embed.toJSON()));
}

describe("/verify code", () => {
  it("adds the verification role, then logs and replies", async () => {
    const { interaction, ctx, log, membersFetch, roleAdd, editReply, getSettings } = setup("code");

    await command.execute(interaction, ctx);

    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(membersFetch).toHaveBeenCalledWith("u1");
    expect(roleAdd).toHaveBeenCalledWith("verified-role");
    expect(roleAdd.mock.invocationCallOrder[0]).toBeLessThan(log.info.mock.invocationCallOrder[0]);
    expect(log.info).toHaveBeenCalledWith({ email: "u1@drexel.edu" }, "Verification confirmed");
    expect(replies(editReply)).toEqual([[{ color: 0x43b581, description: "You have been verified!" }]]);
  });

  it("warns and still succeeds when the role can't be added", async () => {
    const err = new Error("Missing Permissions");
    const { interaction, ctx, log, editReply } = setup("code", { roleAddError: err });

    await command.execute(interaction, ctx);

    expect(log.warn).toHaveBeenCalledWith({ err }, "Failed to assign verification role");
    expect(log.error).not.toHaveBeenCalled();
    expect(replies(editReply)).toEqual([[{ color: 0x43b581, description: "You have been verified!" }]]);
  });

  it("warns and still succeeds when the member can't be fetched", async () => {
    const err = new Error("Unknown Member");
    const { interaction, ctx, log, roleAdd, editReply } = setup("code", { memberFetchError: err });

    await command.execute(interaction, ctx);

    expect(roleAdd).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith({ err }, "Failed to assign verification role");
    expect(replies(editReply)).toEqual([[{ color: 0x43b581, description: "You have been verified!" }]]);
  });

  it("adds no role without a configured role or a cached guild", async () => {
    for (const options of [{ roleId: null }, { noGuild: true }]) {
      const { interaction, ctx, membersFetch, editReply } = setup("code", options);
      await command.execute(interaction, ctx);
      expect(membersFetch).not.toHaveBeenCalled();
      expect(replies(editReply)).toEqual([[{ color: 0x43b581, description: "You have been verified!" }]]);
    }
  });
});

describe("/verify sync", () => {
  it("adds the verification role and replies", async () => {
    const { interaction, ctx, membersFetch, roleAdd, editReply } = setup("sync");

    await command.execute(interaction, ctx);

    expect(membersFetch).toHaveBeenCalledWith("u1");
    expect(roleAdd).toHaveBeenCalledWith("verified-role");
    expect(replies(editReply)).toEqual([
      [{ color: 0x43b581, description: "Your verification has been synced to this server!" }],
    ]);
  });

  it("refuses an unverified user without touching roles", async () => {
    const { interaction, ctx, getSettings, membersFetch, editReply } = setup("sync", { verified: false });

    await command.execute(interaction, ctx);

    expect(getSettings).not.toHaveBeenCalled();
    expect(membersFetch).not.toHaveBeenCalled();
    expect(replies(editReply)).toEqual([[{ color: 0xff0000, description: "You are not verified. Use `/verify email` first." }]]);
  });

  it("reports a failed role add as an error, not a success", async () => {
    const err = new Error("Missing Permissions");
    const { interaction, ctx, log, editReply } = setup("sync", { roleAddError: err });

    await command.execute(interaction, ctx);

    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ err }, "Unhandled error in /verify");
    expect(replies(editReply)).toEqual([[{ color: 0xff0000, description: "Something went wrong." }]]);
  });

  it("reports a failed member fetch as an error, and an AppError by its message", async () => {
    const plain = setup("sync", { memberFetchError: new Error("Unknown Member") });
    await command.execute(plain.interaction, plain.ctx);
    expect(replies(plain.editReply)).toEqual([[{ color: 0xff0000, description: "Something went wrong." }]]);

    const app = setup("sync", { roleAddError: new AppError(ErrorCode.VALIDATION_ERROR, "Role is above mine.") });
    await command.execute(app.interaction, app.ctx);
    expect(app.log.error).not.toHaveBeenCalled();
    expect(replies(app.editReply)).toEqual([[{ color: 0xff0000, description: "Role is above mine." }]]);
  });
});
