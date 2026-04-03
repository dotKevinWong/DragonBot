import { EmbedBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import type { BotEvent } from "../types/commands.js";
import type { BotContext } from "../types/context.js";

const event: BotEvent<"guildMemberUpdate"> = {
  name: "guildMemberUpdate",

  async execute(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember, ctx: BotContext) {
    const guildId = newMember.guild.id;

    // Fetch full member data if old member is uncached to avoid phantom diffs
    if (oldMember.partial) {
      try {
        oldMember = await oldMember.fetch();
      } catch {
        return;
      }
    }

    // Role changes
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
      if (await ctx.services.logging.shouldLog(guildId, "role_change")) {
        const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
        const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

        if (addedRoles.size > 0 || removedRoles.size > 0) {
          const embed = new EmbedBuilder()
            .setColor(removedRoles.size > 0 ? 0xff0000 : 0xff9900)
            .setAuthor({
              name: newMember.user.tag,
              iconURL: newMember.user.displayAvatarURL(),
            })
            .setTitle("Update: Role")
            .addFields({ name: "User", value: `<@${newMember.id}>` });

          if (addedRoles.size > 0) {
            const added = addedRoles.map((r) => `➕ <@&${r.id}>`).join("\n");
            embed.addFields({ name: "Roles Added", value: added });
          }

          if (removedRoles.size > 0) {
            const removed = removedRoles.map((r) => `❌ <@&${r.id}>`).join("\n");
            embed.addFields({ name: "Roles Removed", value: removed });
          }

          embed.addFields({
            name: "ID",
            value: `\`\`\`js\nUser: ${newMember.id}\nGuild: ${guildId}\n\`\`\``,
          });
          embed.setTimestamp();

          await ctx.services.logging.sendLogEmbed(guildId, embed, newMember.client, ctx.logger);
        }
      }
    }

    // Nickname changes
    if (oldMember.nickname !== newMember.nickname) {
      if (await ctx.services.logging.shouldLog(guildId, "nickname_change")) {
        const embed = new EmbedBuilder()
          .setColor(0xffcc00)
          .setAuthor({
            name: newMember.user.tag,
            iconURL: newMember.user.displayAvatarURL(),
          })
          .setTitle("Update: Nickname")
          .addFields(
            { name: "User", value: `<@${newMember.id}>` },
            { name: "Before", value: oldMember.nickname ?? "*None*", inline: true },
            { name: "After", value: newMember.nickname ?? "*None*", inline: true },
            {
              name: "ID",
              value: `\`\`\`js\nUser: ${newMember.id}\nGuild: ${guildId}\n\`\`\``,
            },
          )
          .setTimestamp();

        await ctx.services.logging.sendLogEmbed(guildId, embed, newMember.client, ctx.logger);
      }
    }
  },
};

export default event;
