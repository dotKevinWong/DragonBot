const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const timeFormatter = require("../utils/timeFormatter");
const timeDiff = require("../utils/timeDiff");

async function guildMemberRemove(member) {
	try {
		if (member.guild.id == "323942271550750720") {
			const logChannel = member.guild.channels.cache.get("573650098018451518");
			if (!logChannel) return;
			const auditLogs = await member.guild.fetchAuditLogs();
			const firstEntry = auditLogs.entries.first();
			// if the first entry is a kick or ban and it was created within the last 10 seconds
			if (firstEntry.createdAt > Date.now() - 10000) {
				if (firstEntry.action === 20 || firstEntry.action === 22) {
					const embed = new EmbedBuilder()
						.setColor("#ff0000")
						.setTitle(
							`${firstEntry.action === 20 ? "Member Kicked" : "Member Banned"}`
						)
						.setAuthor({
							name: `${member.user.tag}`,
							iconURL: `${member.user.avatarURL({ dynamic: true })}`,
						})
						.addFields(
							{ name: "User", value: `${member.user}` },
							{
								name: "Executor",
								value: `${auditLogs.entries.first().executor}`,
							},
							{
								name: "Roles",
								value: `${
									member.roles.cache.size >= 1
										? member.roles.cache.map((role) => role.name).join(", ")
										: "No roles"
								}`,
							},
							{
								name: "Account Created At",
								value: `${timeFormatter(member.user.createdAt)} (${timeDiff(
									member.user.createdAt
								)})`,
							},
							{
								name: "Joined Server At",
								value: `${timeFormatter(member.joinedAt)} (${timeDiff(
									member.joinedAt
								)})`,
							},
							{ name: "Left Server At", value: `${timeFormatter(new Date())}` },
							{
								name: "Reason",
								value: `${firstEntry.reason ? firstEntry.reason : "No reason"}`,
							},
							{
								name: "ID",
								value:
									`\`\`\`js\n` +
									`User: ${member.id}\n` +
									`Guild: ${member.guild.id}\n` +
									`Executor: ${auditLogs.entries.first().executor.id}\n` +
									`\n\`\`\``,
							}
						)
						.setTimestamp();
					logChannel.send({ embeds: [embed] });
				} else {
					return;
				}
			} else {
				const embed = new EmbedBuilder()
					.setColor("#ff0000")
					.setTitle(`Member Left`)
					.setAuthor({
						name: `${member.user.tag}`,
						iconURL: `${member.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${member.user}` },
						{
							name: "Roles",
							value: `${
								member.roles.cache.size >= 1
									? member.roles.cache.map((role) => role.name).join(", ")
									: "No roles"
							}`,
						},
						{
							name: "Account Created At",
							value: `${timeFormatter(member.user.createdAt)} (${timeDiff(
								member.user.createdAt
							)})`,
						},
						{
							name: "Joined Server At",
							value: `${timeFormatter(member.joinedAt)} (${timeDiff(
								member.joinedAt
							)})`,
						},
						{ name: "Left Server At", value: `${timeFormatter(new Date())}` },
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${member.id}\n` +
								`Guild: ${member.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				logChannel.send({ embeds: [embed] });
			}
		}
	} catch (error) {
		console.error(error);
	}
}

module.exports = guildMemberRemove;
