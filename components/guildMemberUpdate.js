const { EmbedBuilder } = require("discord.js");

async function guildMemberUpdate(oldMember, newMember) {
	/* Log Role Updates */
	try {
		if (oldMember.guild.id == "323942271550750720") {
			const logChannel = oldMember.guild.channels.cache.get(
				"573650098018451518"
			);
			if (!logChannel) return;
			// determine if roles were added or removed from the member
			const addedRoles = newMember.roles.cache.filter(
				(role) => !oldMember.roles.cache.has(role.id)
			);
			const removedRoles = oldMember.roles.cache.filter(
				(role) => !newMember.roles.cache.has(role.id)
			);
			const nickname =
				newMember.nickname !== oldMember.nickname

			// use if statements to determine what to log

			if (addedRoles.size > 0 && removedRoles.size === 0) {
				const embed = new EmbedBuilder()
					.setColor("#ff0000")
					.setTitle(`Update: Role`)
					.setAuthor({
						name: `${newMember.user.tag}`,
						iconURL: `${newMember.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${newMember.user}` },
						{
							name: "Roles Added",
							value: `${addedRoles.map((role) => `➕ ${role}`).join("\n")}`,
						},
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${newMember.id}\n` +
								`Guild: ${newMember.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				logChannel.send({ embeds: [embed] });
			} else if (removedRoles.size > 0 && addedRoles.size === 0) {
				const embed = new EmbedBuilder()
					.setColor("#ff0000")
					.setTitle(`Update: Role`)
					.setAuthor({
						name: `${newMember.user.tag}`,
						iconURL: `${newMember.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${newMember.user}` },
						{
							name: "Roles Removed",
							value: `${removedRoles.map((role) => `❌ ${role}`).join("\n")}`,
						},
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${newMember.id}\n` +
								`Guild: ${newMember.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				logChannel.send({ embeds: [embed] });
			} else if (nickname) {
				const embed = new EmbedBuilder()
					.setColor("#ff0000")
					.setTitle(`Update: Nickname`)
					.setAuthor({
						name: `${newMember.user.tag}`,
						iconURL: `${newMember.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${newMember.user}` },
						{ name: "Previous Nickname", value: `${oldMember.nickname}` },
						{ name: "New Nickname", value: `${newMember.nickname}` },
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${newMember.id}\n` +
								`Guild: ${newMember.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				logChannel.send({ embeds: [embed] });
			} else {
				return;
			}
		}
	} catch (err) {
		console.error(err);
	}
}

module.exports = guildMemberUpdate;
