import type { Guild } from "discord.js";

/**
 * Fetches the member and adds the verification role. Throws on any failure: each caller keeps its own error handling
 * (/verify code warns and carries on, /verify sync lets the error fail the command). guildMemberAdd already holds the
 * member from the event, so it calls roles.add itself rather than fetch it again.
 */
export async function addVerificationRole(guild: Guild, userId: string, roleId: string): Promise<void> {
  const member = await guild.members.fetch(userId);
  await member.roles.add(roleId);
}
