import { describe, expect, it, vi } from "vitest";
import { AuditLogEvent, Collection, type EmbedBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import event from "../../src/events/guild-member-update.js";
import type { BotContext } from "../../src/types/context.js";

interface FakeChange {
  key: string;
  old?: unknown;
  new?: unknown;
}

interface FakeAuditEntry {
  id: string;
  targetId: string;
  createdTimestamp: number;
  changes: FakeChange[];
}

const ID_FIELD = { name: "ID", value: "```js\nUser: u1\nGuild: g1\n```" };

function roles(...ids: string[]) {
  return { cache: new Collection(ids.map((id): [string, { id: string }] => [id, { id }])) };
}

/**
 * u1 in g1 has just been updated: they now hold `newRoles` and nickname `newNick`. The old member
 * is either a full cached member (`old`) or a partial one. g1's audit log holds `roleEntries` and
 * `memberEntries`. `enabled` lists the log types g1 has turned on.
 */
function setup(
  options: {
    newRoles?: string[];
    newNick?: string | null;
    old?: { roles: string[]; nickname: string | null };
    roleEntries?: FakeAuditEntry[];
    memberEntries?: FakeAuditEntry[];
    enabled?: string[];
  } = {},
) {
  const fetchAuditLogs = vi.fn(async (opts: { type: AuditLogEvent; limit: number }) => {
    const entries = opts.type === AuditLogEvent.MemberRoleUpdate ? options.roleEntries : options.memberEntries;
    return { entries: new Collection((entries ?? []).map((entry): [string, FakeAuditEntry] => [entry.id, entry])) };
  });
  const newMember = {
    id: "u1",
    guild: { id: "g1", fetchAuditLogs },
    user: { tag: "u1#0001", displayAvatarURL: () => "https://cdn.example/u1.png" },
    client: { name: "fake client" },
    roles: roles(...(options.newRoles ?? [])),
    nickname: options.newNick ?? null,
  } as unknown as GuildMember;
  const fetchOld = vi.fn(async () => newMember);
  const oldMember = (
    options.old
      ? { partial: false, id: "u1", roles: roles(...options.old.roles), nickname: options.old.nickname }
      : { partial: true, id: "u1", roles: roles(), nickname: null, fetch: fetchOld }
  ) as unknown as GuildMember | PartialGuildMember;
  const enabled = options.enabled ?? ["role_change", "nickname_change"];
  const logging = {
    shouldLog: vi.fn(async (_guildId: string, type: string) => enabled.includes(type)),
    sendLogEmbed: vi.fn(async (_guildId: string, _embed: EmbedBuilder, _client: unknown, _logger: unknown): Promise<void> => {}),
  };
  const ctx = { logger: { name: "logger" }, services: { logging } } as unknown as BotContext;
  return { oldMember, newMember, fetchOld, fetchAuditLogs, logging, ctx };
}

function sentEmbeds(logging: ReturnType<typeof setup>["logging"]) {
  return logging.sendLogEmbed.mock.calls.map((call) => {
    const json = call[1].toJSON();
    delete json.timestamp;
    return json;
  });
}

const roleEmbed = (fields: { name: string; value: string }[], color: number) => ({
  color,
  author: { name: "u1#0001", icon_url: "https://cdn.example/u1.png" },
  title: "Update: Role",
  fields: [{ name: "User", value: "<@u1>" }, ...fields, ID_FIELD],
});

const nicknameEmbed = (before: string, after: string) => ({
  color: 0xffcc00,
  author: { name: "u1#0001", icon_url: "https://cdn.example/u1.png" },
  title: "Update: Nickname",
  fields: [
    { name: "User", value: "<@u1>" },
    { name: "Before", value: before, inline: true },
    { name: "After", value: after, inline: true },
    ID_FIELD,
  ],
});

describe("guildMemberUpdate event", () => {
  it("makes no Discord calls for a partial old member when role and nickname logging are off", async () => {
    const { oldMember, newMember, fetchOld, fetchAuditLogs, logging, ctx } = setup({
      newRoles: ["r1"],
      enabled: ["message_edit"],
    });

    await event.execute(oldMember, newMember, ctx);

    expect(fetchOld).not.toHaveBeenCalled();
    expect(fetchAuditLogs).not.toHaveBeenCalled();
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("logs role and nickname diffs of a cached old member as before", async () => {
    const { oldMember, newMember, fetchAuditLogs, logging, ctx } = setup({
      old: { roles: ["r1", "r2"], nickname: "Old" },
      newRoles: ["r1", "r3", "r4"],
      newNick: "New",
    });

    await event.execute(oldMember, newMember, ctx);

    expect(fetchAuditLogs).not.toHaveBeenCalled();
    expect(sentEmbeds(logging)).toEqual([
      roleEmbed(
        [
          { name: "Roles Added", value: "➕ <@&r3>\n➕ <@&r4>" },
          { name: "Roles Removed", value: "❌ <@&r2>" },
        ],
        0xff0000,
      ),
      nicknameEmbed("Old", "New"),
    ]);
    expect(logging.sendLogEmbed).toHaveBeenCalledWith("g1", expect.anything(), newMember.client, ctx.logger);
  });

  it("logs an added role of a cached old member in orange and a cleared nickname as None", async () => {
    const { oldMember, newMember, logging, ctx } = setup({
      old: { roles: ["r1"], nickname: "Old" },
      newRoles: ["r1", "r2"],
      newNick: null,
    });

    await event.execute(oldMember, newMember, ctx);

    expect(sentEmbeds(logging)).toEqual([
      roleEmbed([{ name: "Roles Added", value: "➕ <@&r2>" }], 0xff9900),
      nicknameEmbed("Old", "*None*"),
    ]);
  });

  it("logs nothing for a cached old member when nothing changed", async () => {
    const { oldMember, newMember, logging, ctx } = setup({
      old: { roles: ["r1"], nickname: "Same" },
      newRoles: ["r1"],
      newNick: "Same",
    });

    await event.execute(oldMember, newMember, ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("logs a partial old member's changes from matching recent audit log entries", async () => {
    const now = Date.now();
    const { oldMember, newMember, fetchOld, fetchAuditLogs, logging, ctx } = setup({
      newRoles: ["r1", "r3"],
      newNick: "New",
      roleEntries: [
        // Newest first, as Discord returns them. Another member's entry comes first.
        { id: "a0", targetId: "u2", createdTimestamp: now - 500, changes: [{ key: "$add", new: [{ id: "r9", name: "X" }] }] },
        {
          id: "a1",
          targetId: "u1",
          createdTimestamp: now - 1000,
          changes: [
            { key: "$add", new: [{ id: "r3", name: "Three" }] },
            { key: "$remove", new: [{ id: "r2", name: "Two" }] },
          ],
        },
      ],
      memberEntries: [
        { id: "m1", targetId: "u1", createdTimestamp: now - 1000, changes: [{ key: "nick", old: "Old", new: "New" }] },
      ],
    });

    await event.execute(oldMember, newMember, ctx);

    expect(fetchOld).not.toHaveBeenCalled();
    expect(fetchAuditLogs).toHaveBeenCalledWith({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
    expect(fetchAuditLogs).toHaveBeenCalledWith({ type: AuditLogEvent.MemberUpdate, limit: 5 });
    expect(sentEmbeds(logging)).toEqual([
      roleEmbed(
        [
          { name: "Roles Added", value: "➕ <@&r3>" },
          { name: "Roles Removed", value: "❌ <@&r2>" },
        ],
        0xff0000,
      ),
      nicknameEmbed("Old", "New"),
    ]);
  });

  it("logs a partial old member's first nickname as changed from None", async () => {
    const { oldMember, newMember, logging, ctx } = setup({
      newNick: "New",
      enabled: ["nickname_change"],
      memberEntries: [
        { id: "m1", targetId: "u1", createdTimestamp: Date.now() - 1000, changes: [{ key: "nick", new: "New" }] },
      ],
    });

    await event.execute(oldMember, newMember, ctx);

    expect(sentEmbeds(logging)).toEqual([nicknameEmbed("*None*", "New")]);
  });

  it("only reads the audit log for the log types that are on", async () => {
    const { oldMember, newMember, fetchAuditLogs, ctx } = setup({ newRoles: ["r1"], enabled: ["role_change"] });

    await event.execute(oldMember, newMember, ctx);

    expect(fetchAuditLogs).toHaveBeenCalledTimes(1);
    expect(fetchAuditLogs).toHaveBeenCalledWith({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
  });

  it("logs nothing for a partial old member without a matching recent audit log entry", async () => {
    const now = Date.now();
    const { oldMember, newMember, fetchOld, fetchAuditLogs, logging, ctx } = setup({
      newRoles: ["r1"],
      newNick: "New",
      roleEntries: [
        // Too old to belong to this update.
        { id: "a1", targetId: "u1", createdTimestamp: now - 11_000, changes: [{ key: "$add", new: [{ id: "r1", name: "One" }] }] },
        // Another member.
        { id: "a2", targetId: "u2", createdTimestamp: now - 1000, changes: [{ key: "$add", new: [{ id: "r1", name: "One" }] }] },
      ],
      memberEntries: [
        // A recent member update that isn't a nickname change, such as a timeout.
        {
          id: "m1",
          targetId: "u1",
          createdTimestamp: now - 1000,
          changes: [{ key: "communication_disabled_until", new: "2030-01-01T00:00:00.000Z" }],
        },
      ],
    });

    await event.execute(oldMember, newMember, ctx);

    expect(fetchOld).not.toHaveBeenCalled();
    expect(fetchAuditLogs).toHaveBeenCalledTimes(2);
    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });

  it("logs nothing for a partial old member when the audit log can't be read", async () => {
    const { oldMember, newMember, fetchAuditLogs, logging, ctx } = setup({ newRoles: ["r1"] });
    fetchAuditLogs.mockRejectedValue(new Error("Missing Permissions"));

    await event.execute(oldMember, newMember, ctx);

    expect(logging.sendLogEmbed).not.toHaveBeenCalled();
  });
});
