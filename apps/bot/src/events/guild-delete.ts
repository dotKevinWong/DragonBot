import type { Guild } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"guildDelete"> = {
  name: "guildDelete",

  async execute(guild: Guild, ctx: BotContext) {
    const log = ctx.logger.child({ event: "guildDelete", guildId: guild.id });

    // guildDelete also fires during Discord outages; only act when the bot actually left
    if (!guild.available) {
      log.warn("Guild became unavailable");
      return;
    }

    log.info({ guildName: guild.name }, "Removed from guild");
    await ctx.services.guild.disableBanSync(guild.id);
  },
};

export default event;
