import { EmbedBuilder, type VoiceState } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"voiceStateUpdate"> = {
  name: "voiceStateUpdate",

  async execute(oldState: VoiceState, newState: VoiceState, ctx: BotContext) {
    const guildId = newState.guild.id;
    if (!await ctx.services.logging.shouldLog(guildId, "voice_activity")) return;

    const user = newState.member?.user;
    if (!user) return;

    const embed = new EmbedBuilder()
      .setColor(0xffcc00)
      .setAuthor({
        name: user.tag,
        iconURL: user.displayAvatarURL(),
      });

    if (!oldState.channel && newState.channel) {
      // Join
      embed
        .setTitle("Voice Channel Join")
        .addFields(
          { name: "User", value: `<@${user.id}>` },
          { name: "Channel", value: `<#${newState.channel.id}> (${newState.channel.name})` },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${user.id}\nChannel: ${newState.channel.id}\nGuild: ${guildId}\n\`\`\``,
          },
        );
    } else if (oldState.channel && !newState.channel) {
      // Leave
      embed
        .setTitle("Voice Channel Leave")
        .addFields(
          { name: "User", value: `<@${user.id}>` },
          { name: "Channel", value: `<#${oldState.channel.id}> (${oldState.channel.name})` },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${user.id}\nChannel: ${oldState.channel.id}\nGuild: ${guildId}\n\`\`\``,
          },
        );
    } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
      // Switch
      embed
        .setTitle("Voice Channel Switch")
        .addFields(
          { name: "User", value: `<@${user.id}>` },
          { name: "Old Channel", value: `<#${oldState.channel.id}> (${oldState.channel.name})` },
          { name: "New Channel", value: `<#${newState.channel.id}> (${newState.channel.name})` },
          {
            name: "ID",
            value: `\`\`\`js\nUser: ${user.id}\nOld Channel: ${oldState.channel.id}\nNew Channel: ${newState.channel.id}\nGuild: ${guildId}\n\`\`\``,
          },
        );
    } else {
      return; // Mute/deafen changes — skip
    }

    embed.setTimestamp();
    await ctx.services.logging.sendLogEmbed(guildId, embed, newState.client, ctx.logger);
  },
};

export default event;
