import type { GuildTextBasedChannel, Message, PartialMessage, ReadonlyCollection, Snowflake } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"messageDeleteBulk"> = {
  name: "messageDeleteBulk",

  async execute(
    messages: ReadonlyCollection<Snowflake, Message<true> | PartialMessage<true>>,
    channel: GuildTextBasedChannel,
    ctx: BotContext,
  ) {
    const guildId = channel.guildId;

    // A purge took the honeypot warning: put it back straight away, as message-delete.ts does for a single delete.
    // Discord reports a purge as one bulk delete, with no messageDelete for each message. With Partials.Message, the
    // collection holds every deleted ID, cached or not.
    const settings = await ctx.services.guild.getSettings(guildId);
    const warningMessageId = settings?.honeypotWarningMessageId;
    if (warningMessageId && messages.has(warningMessageId)) void ctx.honeypotWarning?.sync(guildId);
  },
};

export default event;
