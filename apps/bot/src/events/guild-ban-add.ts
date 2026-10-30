import { EmbedBuilder, type GuildBan } from "discord.js";
import { isHoneypotReason } from "../services/honeypot.service.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";
import { resolveBanReason } from "../utils/audit-log.js";

const event: BotEvent<"guildBanAdd"> = {
  name: "guildBanAdd",

  async execute(ban: GuildBan, ctx: BotContext) {
    // The honeypot's record of its own ban. Read before any await, so it can't expire while this handler waits.
    const hp = ctx.services.honeypot.takeBanEvent(ban.guild.id, ban.user.id);
    // A honeypot kick bans only to clean up the account's messages, then unbans. To admins it isn't a ban.
    if (hp?.action === "kick") return;

    const log = ctx.logger.child({ event: "guildBanAdd", guildId: ban.guild.id, userId: ban.user.id });

    // Mark user as banned
    await ctx.services.user.markBanned(ban.user.id, ban.guild.id);

    // A honeypot ban's reason comes from its record, since Discord may not return it with the ban.
    const reason = hp ? hp.reason : await resolveBanReason(ban);

    // Log ban
    if (await ctx.services.logging.shouldLog(ban.guild.id, "ban")) {
      const guildId = ban.guild.id;
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setAuthor({
          name: ban.user.tag,
          iconURL: ban.user.displayAvatarURL(),
        })
        .setTitle("Member Banned")
        .addFields(
          { name: "User", value: `<@${ban.user.id}>` },
          { name: "Reason", value: reason ?? "No reason provided" },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${ban.user.id}\nGuild: ${guildId}\n\`\`\``,
          },
        )
        .setThumbnail(ban.user.displayAvatarURL())
        .setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, ban.client, ctx.logger);
    }

    // Honeypot bans are never copied to other servers. The reason's marker catches one whose record is gone.
    if (hp || isHoneypotReason(reason)) return;

    // Ban sync
    try {
      const count = await ctx.services.moderation.syncBan(
        ban.user.id,
        ban.guild.id,
        ban.client,
        ctx.logger,
      );
      if (count > 0) {
        log.info({ syncedTo: count }, "Ban synced across guilds");
      }
    } catch (err) {
      log.error({ err }, "Error during ban sync");
    }
  },
};

export default event;
