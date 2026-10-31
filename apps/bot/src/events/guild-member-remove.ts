import { AuditLogEvent, EmbedBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";
import { findRecentAuditLogEntry, normalizeReason } from "../utils/audit-log.js";

const event: BotEvent<"guildMemberRemove"> = {
  name: "guildMemberRemove",

  async execute(member: GuildMember | PartialGuildMember, ctx: BotContext) {
    // The honeypot's record of its own removal. Read before any await, so it can't expire while this handler waits.
    const hp = ctx.services.honeypot.takeRemoveEvent(member.guild.id, member.id);
    // A honeypot ban: the honeypot's entry and "Member Banned" already tell the story, so no "Member Left".
    if (hp?.action === "ban") return;

    const guildId = member.guild.id;
    const log = ctx.logger.child({ event: "guildMemberRemove", guildId, userId: member.id });

    // Determine if kick, ban, or voluntary leave
    let action = "left";
    let executor: string | null = null;
    let executorId: string | null = null;
    let reason: string | null = null;

    if (hp?.action === "kick") {
      // DragonBot kicked them with a ban and an unban, so the audit log holds no kick to find.
      action = "kicked";
      executor = member.client.user.tag;
      executorId = member.client.user.id;
      reason = hp.reason;
    } else {
      const kickLog = await findRecentAuditLogEntry(member.guild, AuditLogEvent.MemberKick, member.id);
      if (kickLog) {
        action = "kicked";
        executor = kickLog.executor?.tag ?? "Unknown";
        executorId = kickLog.executor?.id ?? null;
        reason = normalizeReason(kickLog.reason);
      }
    }

    // Log member_leave
    if (await ctx.services.logging.shouldLog(guildId, "member_leave")) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: member.user?.tag ?? "Unknown",
          iconURL: member.user?.displayAvatarURL() ?? undefined,
        })
        .setTitle(action === "kicked" ? "Member Kicked" : "Member Left")
        .addFields({ name: "User", value: `<@${member.id}>` });

      if (executor) {
        embed.addFields(
          { name: "Kicked by", value: `<@${executorId}> (${executor})` },
          { name: "Reason", value: reason ?? "No reason provided" },
        );
      }

      embed.addFields({
        name: "ID",
        value: `\`\`\`js\nUser: ${member.id}\nGuild: ${guildId}\n\`\`\``,
      });
      embed.setThumbnail(member.user?.displayAvatarURL() ?? null);
      embed.setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, member.client, ctx.logger);
    }

    // Log kick specifically
    if (action === "kicked" && await ctx.services.logging.shouldLog(guildId, "kick")) {
      const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setAuthor({
          name: member.user?.tag ?? "Unknown",
          iconURL: member.user?.displayAvatarURL() ?? undefined,
        })
        .setTitle("Kick")
        .addFields(
          { name: "User", value: `<@${member.id}>` },
          { name: "Kicked by", value: `<@${executorId}> (${executor})` },
          { name: "Reason", value: reason ?? "No reason provided" },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${member.id}\nModerator: ${executorId ?? "Unknown"}\nGuild: ${guildId}\n\`\`\``,
          },
        )
        .setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, member.client, ctx.logger);
    }
  },
};

export default event;
