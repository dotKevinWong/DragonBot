import { AuditLogEvent, EmbedBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"guildMemberRemove"> = {
  name: "guildMemberRemove",

  async execute(member: GuildMember | PartialGuildMember, ctx: BotContext) {
    const guildId = member.guild.id;
    const log = ctx.logger.child({ event: "guildMemberRemove", guildId, userId: member.id });

    // Determine if kick, ban, or voluntary leave
    let action = "left";
    let executor: string | null = null;
    let executorId: string | null = null;

    try {
      const auditLogs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
      const kickLog = auditLogs.entries.first();
      if (kickLog && kickLog.target?.id === member.id && Date.now() - kickLog.createdTimestamp < 5000) {
        action = "kicked";
        executor = kickLog.executor?.tag ?? "Unknown";
        executorId = kickLog.executor?.id ?? null;
      }
    } catch {
      // May not have audit log permissions
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
        embed.addFields({ name: "Kicked by", value: `<@${executorId}> (${executor})` });
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
