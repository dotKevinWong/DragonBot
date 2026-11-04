import { describe, it, expect, vi } from "vitest";
import type { GuildMember } from "discord.js";
import event from "../../src/events/guild-member-add.js";
import type { BotContext } from "../../src/types/context.js";

/** u1 joins server g1, which welcomes in channel c1. Discord resolves c1 to a text channel in `channelGuildId`. */
function setup(channelGuildId: string) {
  const send = vi.fn(async (_content: unknown) => ({}));
  const fetch = vi.fn(async (_channelId: string) => ({
    id: "c1",
    guildId: channelGuildId,
    isDMBased: () => false,
    isTextBased: () => true,
    send,
  }));
  const member = {
    id: "u1",
    guild: { id: "g1", name: "Drexel CCI" },
    client: { channels: { fetch } },
    send: vi.fn(async () => undefined),
  } as unknown as GuildMember;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    logger: { ...log, child: vi.fn(() => log) },
    services: {
      guild: {
        getSettings: vi.fn(async (_guildId: string) => ({
          isVerificationSyncEnabled: false,
          isWelcomeEnabled: true,
          welcomeChannelId: "c1",
          welcomeMessage: "Welcome {member} to {server}!",
          isDmWelcomeEnabled: false,
        })),
      },
      logging: { shouldLog: vi.fn(async () => false) },
    },
  } as unknown as BotContext;
  return { member, ctx, send, log };
}

describe("guildMemberAdd event", () => {
  it("never sends the welcome message to a channel in another server", async () => {
    const { member, ctx, send, log } = setup("g2");

    await event.execute(member, ctx);

    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", channelId: "c1", channelGuildId: "g2" }),
      expect.any(String),
    );
  });

  it("sends the welcome message to a channel in the same server", async () => {
    const { member, ctx, send, log } = setup("g1");

    await event.execute(member, ctx);

    expect(send).toHaveBeenCalledWith("Welcome <@u1> to Drexel CCI!");
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("guildMemberAdd verification sync", () => {
  function syncSetup(options: { verified: boolean; addError?: Error; syncEnabled?: boolean }) {
    const add = vi.fn(async (_roleId: string) => {
      if (options.addError) throw options.addError;
    });
    const member = {
      id: "u1",
      guild: { id: "g1", name: "Drexel CCI", members: { fetch: vi.fn() } },
      roles: { add },
      client: {},
    } as unknown as GuildMember;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const isVerified = vi.fn(async (_id: string) => options.verified);
    const ctx = {
      logger: { child: vi.fn(() => log) },
      services: {
        guild: {
          getSettings: vi.fn(async () => ({
            isVerificationSyncEnabled: options.syncEnabled ?? true,
            verificationRoleId: "verified-role",
          })),
        },
        user: { isVerified },
        logging: { shouldLog: vi.fn(async () => false) },
      },
    } as unknown as BotContext;
    return { member, ctx, add, log, isVerified };
  }

  it("adds the role to a verified member from the event, without fetching", async () => {
    const { member, ctx, add, log } = syncSetup({ verified: true });

    await event.execute(member, ctx);

    expect(add).toHaveBeenCalledWith("verified-role");
    expect(member.guild.members.fetch).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith("Auto-synced verification role");
  });

  it("warns when the role can't be added", async () => {
    const err = new Error("Missing Permissions");
    const { member, ctx, log } = syncSetup({ verified: true, addError: err });

    await event.execute(member, ctx);

    expect(log.warn).toHaveBeenCalledWith({ err }, "Failed to sync verification role");
    expect(log.info).not.toHaveBeenCalled();
  });

  it("adds nothing for an unverified member, or with sync off", async () => {
    const unverified = syncSetup({ verified: false });
    await event.execute(unverified.member, unverified.ctx);
    expect(unverified.add).not.toHaveBeenCalled();

    const off = syncSetup({ verified: true, syncEnabled: false });
    await event.execute(off.member, off.ctx);
    expect(off.isVerified).not.toHaveBeenCalled();
    expect(off.add).not.toHaveBeenCalled();
  });
});
