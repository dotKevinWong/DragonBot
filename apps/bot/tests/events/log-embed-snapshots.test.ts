import { describe, expect, it, vi } from "vitest";
import {
  Collection,
  type EmbedBuilder,
  type GuildBan,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type VoiceState,
} from "discord.js";
import banAdd from "../../src/events/guild-ban-add.js";
import memberAdd from "../../src/events/guild-member-add.js";
import memberRemove from "../../src/events/guild-member-remove.js";
import messageUpdate from "../../src/events/message-update.js";
import voiceStateUpdate from "../../src/events/voice-state-update.js";
import { HoneypotService } from "../../src/services/honeypot.service.js";
import { buildMessageDeletedEmbed } from "../../src/utils/message-log.js";
import type { BotContext } from "../../src/types/context.js";

/**
 * Pins every log-channel embed the event handlers build, field for field, so a refactor of how they are built can't
 * change a byte of what reaches the log channel. Only the send time is dropped, after checking it was set.
 */

const user = (id = "u1") => ({
  id,
  tag: `${id}#0001`,
  displayAvatarURL: () => `https://cdn.example/${id}.png`,
  createdTimestamp: 1_600_000_000_000,
});

function fakeLogging() {
  return {
    shouldLog: vi.fn(async (_guildId: string, _type: string) => true),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
}

/** Each embed sent, as Discord would receive it, without its timestamp. */
function sent(logging: ReturnType<typeof fakeLogging>) {
  return logging.sendLogEmbed.mock.calls.map(([, embed]) => {
    const json = embed.toJSON();
    expect(json.timestamp).toEqual(expect.any(String));
    delete json.timestamp;
    return json;
  });
}

describe("log-channel embeds", () => {
  it("Member Banned", async () => {
    const logging = fakeLogging();
    const ban = {
      guild: { id: "g1", bans: { fetch: vi.fn(async () => ({ reason: "spam" })) }, fetchAuditLogs: vi.fn() },
      user: user(),
      client: {},
    } as unknown as GuildBan;
    const ctx = {
      logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
      services: {
        honeypot: new HoneypotService(),
        user: { markBanned: vi.fn(async () => undefined) },
        logging,
        moderation: { syncBan: vi.fn(async () => 0) },
      },
    } as unknown as BotContext;

    await banAdd.execute(ban, ctx);

    expect(sent(logging)).toMatchSnapshot();
  });

  it("Member Joined", async () => {
    const logging = fakeLogging();
    const member = { id: "u1", guild: { id: "g1", name: "G" }, user: user(), client: {} } as unknown as GuildMember;
    const log = { info: vi.fn(), warn: vi.fn() };
    const ctx = {
      logger: { child: () => log },
      services: { guild: { getSettings: vi.fn(async () => ({})) }, logging },
    } as unknown as BotContext;

    await memberAdd.execute(member, ctx);

    expect(sent(logging)).toMatchSnapshot();
  });

  function removeSetup(options: { entries?: unknown[]; user?: unknown } = {}) {
    const logging = fakeLogging();
    const entries = (options.entries ?? []) as { id: string }[];
    const member = {
      id: "u1",
      guild: {
        id: "g1",
        fetchAuditLogs: vi.fn(async () => ({ entries: new Collection(entries.map((e) => [e.id, e])) })),
      },
      user: "user" in options ? options.user : user(),
      client: { user: { id: "bot-self", tag: "DragonBot#0001" } },
    } as unknown as GuildMember | PartialGuildMember;
    const honeypot = new HoneypotService();
    const ctx = { logger: { child: () => ({}) }, services: { honeypot, logging } } as unknown as BotContext;
    return { member, logging, honeypot, ctx };
  }

  it("Member Left", async () => {
    const { member, logging, ctx } = removeSetup();
    await memberRemove.execute(member, ctx);
    expect(sent(logging)).toMatchSnapshot();
  });

  it("Member Left, uncached user", async () => {
    const { member, logging, ctx } = removeSetup({ user: null });
    await memberRemove.execute(member, ctx);
    expect(sent(logging)).toMatchSnapshot();
  });

  it("Member Kicked and Kick, by a moderator", async () => {
    const { member, logging, ctx } = removeSetup({
      entries: [{ id: "e1", targetId: "u1", executor: { id: "mod-1", tag: "mod#0001" }, reason: " spam ", createdTimestamp: Date.now() }],
    });
    await memberRemove.execute(member, ctx);
    expect(sent(logging)).toMatchSnapshot();
  });

  it("Member Kicked and Kick, executor and reason unknown", async () => {
    const { member, logging, ctx } = removeSetup({
      entries: [{ id: "e1", targetId: "u1", executor: null, reason: null, createdTimestamp: Date.now() }],
    });
    await memberRemove.execute(member, ctx);
    expect(sent(logging)).toMatchSnapshot();
  });

  it("Member Kicked and Kick, by the honeypot", async () => {
    const { member, logging, honeypot, ctx } = removeSetup();
    const started = honeypot.beginCase("g1", "u1", Date.now());
    if (started.kind !== "start") throw new Error("expected a new case");
    honeypot.recordAction("g1", "u1", started.caseId, { action: "kick", reason: "[Honeypot kick] x", channelId: "trap" });
    honeypot.confirmAction("g1", "u1", started.caseId);
    await memberRemove.execute(member, ctx);
    expect(sent(logging)).toMatchSnapshot();
  });

  function voiceState(channel: { id: string; name: string } | null, withUser = true) {
    return {
      guild: { id: "g1" },
      channel,
      member: withUser ? { user: user() } : null,
      client: {},
    } as unknown as VoiceState;
  }

  function voiceCtx() {
    const logging = fakeLogging();
    return { logging, ctx: { logger: {}, services: { logging } } as unknown as BotContext };
  }

  it("Voice Channel Join, Leave and Switch", async () => {
    const a = { id: "va", name: "Lounge" };
    const b = { id: "vb", name: "Study" };
    const { logging, ctx } = voiceCtx();
    await voiceStateUpdate.execute(voiceState(null), voiceState(a), ctx);
    await voiceStateUpdate.execute(voiceState(a), voiceState(null), ctx);
    await voiceStateUpdate.execute(voiceState(a), voiceState(b), ctx);
    // Mute/deafen in the same channel, and an update with no user, log nothing.
    await voiceStateUpdate.execute(voiceState(a), voiceState(a), ctx);
    await voiceStateUpdate.execute(voiceState(null), voiceState(a, false), ctx);
    expect(sent(logging)).toMatchSnapshot();
  });

  function fakeMessage(overrides: Record<string, unknown> = {}) {
    return {
      partial: false,
      id: "m1",
      guild: { id: "g1" },
      guildId: "g1",
      content: "after",
      author: { ...user(), bot: false },
      channel: { id: "c1" },
      client: {},
      createdTimestamp: 1_700_000_000_000,
      editedTimestamp: 1_700_000_100_000,
      nonce: "n1",
      attachments: new Collection(),
      reactions: { cache: new Collection() },
      stickers: new Collection(),
      ...overrides,
    } as unknown as Message;
  }

  it("Message Edited", async () => {
    const logging = fakeLogging();
    const ctx = { logger: {}, services: { logging } } as unknown as BotContext;
    await messageUpdate.execute(fakeMessage({ content: "before" }), fakeMessage(), ctx);
    // Uncached old message; new message with no nonce and long content.
    await messageUpdate.execute(
      { partial: true, content: null } as unknown as PartialMessage,
      fakeMessage({ nonce: null, content: "x".repeat(1100) }),
      ctx,
    );
    expect(sent(logging)).toMatchSnapshot();
  });

  it("Message Deleted", () => {
    const embeds = [
      buildMessageDeletedEmbed(fakeMessage()),
      buildMessageDeletedEmbed(fakeMessage({ guildId: null, author: null, editedTimestamp: null, nonce: null, content: null })),
    ].map((embed) => {
      const json = embed.toJSON();
      delete json.timestamp;
      return json;
    });
    expect(embeds).toMatchSnapshot();
  });
});
