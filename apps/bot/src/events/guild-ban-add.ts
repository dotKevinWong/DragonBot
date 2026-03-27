import { EmbedBuilder, type GuildBan } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"guildBanAdd"> = {
  name: "guildBanAdd",

  async execute(ban: GuildBan, ctx: BotContext) {
    const log = ctx.logger.child({ event: "guildBanAdd", guildId: ban.guild.id, userId: ban.user.id });

    // Mark user as banned
    await ctx.services.user.markBanned(ban.user.id, ban.guild.id);

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
          { name: "Reason", value: ban.reason ?? "No reason provided" },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${ban.user.id}\nGuild: ${guildId}\n\`\`\``,
          },
        )
        .setThumbnail(ban.user.displayAvatarURL())
        .setTimestamp();

      await ctx.services.logging.sendLogEmbed(guildId, embed, ban.client, ctx.logger);
    }

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
