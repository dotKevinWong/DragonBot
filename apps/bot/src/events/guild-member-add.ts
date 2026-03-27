import { type GuildMember, type TextChannel, EmbedBuilder } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"guildMemberAdd"> = {
  name: "guildMemberAdd",

  async execute(member: GuildMember, ctx: BotContext) {
    const log = ctx.logger.child({ event: "guildMemberAdd", guildId: member.guild.id, userId: member.id });

    // Upsert user
    await ctx.services.user.getOrCreate(member.id);

    const guild = await ctx.services.guild.getSettings(member.guild.id);
    if (!guild) return;

    // Verification sync — auto-assign verification role if user is already verified
    if (guild.isVerificationSyncEnabled && guild.verificationRoleId) {
      const isVerified = await ctx.services.user.isVerified(member.id);
      if (isVerified) {
        try {
          await member.roles.add(guild.verificationRoleId);
          log.info("Auto-synced verification role");
        } catch (err) {
          log.warn({ err }, "Failed to sync verification role");
        }
      }
    }

    // Welcome message
    if (guild.isWelcomeEnabled && guild.welcomeChannelId && guild.welcomeMessage) {
      try {
        const channel = await member.client.channels.fetch(guild.welcomeChannelId);
        if (channel?.isTextBased()) {
          const message = guild.welcomeMessage
            .replace(/\\n/g, "\n")
            .replace(/{member}/g, `<@${member.id}>`)
            .replace(/{server}/g, member.guild.name);
          await (channel as TextChannel).send(message);
        }
      } catch (err) {
        log.warn({ err }, "Failed to send welcome message");
      }
    }

    // DM welcome
    if (guild.isDmWelcomeEnabled && guild.dmWelcomeMessage) {
      try {
        const message = guild.dmWelcomeMessage
          .replace(/\\n/g, "\n")
          .replace(/{member}/g, member.user.tag)
          .replace(/{server}/g, member.guild.name);
        await member.send(message);
      } catch {
        // DMs may be disabled
      }
    }

    // Logging
    if (await ctx.services.logging.shouldLog(member.guild.id, "member_join")) {
      const guildId = member.guild.id;
      const embed = new EmbedBuilder()
        .setColor(0x43b581)
        .setAuthor({
          name: member.user.tag,
          iconURL: member.user.displayAvatarURL(),
        })
        .setTitle("Member Joined")
        .addFields(
          { name: "User", value: `<@${member.id}>` },
          { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${member.id}\nGuild: ${guildId}\n\`\`\``,
          },
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, member.client, ctx.logger);
    }
  },
};

export default event;
