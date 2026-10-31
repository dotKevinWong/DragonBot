import type { Guild } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"guildCreate"> = {
  name: "guildCreate",

  async execute(guild: Guild, ctx: BotContext) {
    const log = ctx.logger.child({ event: "guildCreate", guildId: guild.id });
    log.info({ guildName: guild.name }, "Joined new guild");

    await ctx.services.guild.ensureGuild(guild.id, guild.name);
    // The honeypot warning may have been deleted while DragonBot was away.
    void ctx.honeypotWarning?.sync(guild.id);
  },
};

export default event;
