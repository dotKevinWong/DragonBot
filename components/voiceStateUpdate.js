const { EmbedBuilder } = require("discord.js");

async function voiceStateUpdate(oldState, newState) {
	// Log Voice Channel Join and Leave

	try {
		if (oldState.guild.id == "323942271550750720") {
			const logChannel = oldState.member.guild.channels.cache.get(
				"573650098018451518"
			);
			if (!logChannel) return;
			if (oldState.channel === null && newState.channel !== null) {
				const embed = new EmbedBuilder()
					.setColor("#ffcc00")
					.setTitle(`Voice Channel Join`)
					.setAuthor({
						name: `${newState.member.user.tag}`,
						iconURL: `${newState.member.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${newState.member.user}` },
						{ name: "Channel", value: `<#${newState.channel.id}> (${newState.channel.name})` },
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${newState.member.id}\n` +
								`Channel: ${newState.channel.id}\n` +
								`Guild: ${newState.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				// Send embed
				logChannel.send({ embeds: [embed] });
			}

			// If the user is leaving a voice channel
			if (oldState.channel !== null && newState.channel === null) {
				const embed = new EmbedBuilder()
					.setColor("#ffcc00")
					.setTitle(`Voice Channel Leave`)
					.setAuthor({
						name: `${oldState.member.user.tag}`,
						iconURL: `${oldState.member.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${oldState.member.user}` },
						{ name: "Channel", value: `<#${oldState.channel.id}> (${oldState.channel.name})` },
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${oldState.member.id}\n` +
								`Channel: ${oldState.channel.id}\n` +
								`Guild: ${oldState.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				// Send embed
				logChannel.send({ embeds: [embed] });
			}

			// If the user is switching voice channels
			if (oldState.channel !== null && newState.channel !== null) {
                if (oldState.channel.id === newState.channel.id) return;
				const embed = new EmbedBuilder()
					.setColor("#ffcc00")
					.setTitle(`Voice Channel Switch`)
					.setAuthor({
						name: `${oldState.member.user.tag}`,
						iconURL: `${oldState.member.user.avatarURL({ dynamic: true })}`,
					})
					.addFields(
						{ name: "User", value: `${oldState.member.user}` },
						{ name: "Old Channel", value: `<#${oldState.channel.id}> (${oldState.channel.name})` },
						{ name: "New Channel", value: `<#${newState.channel.id}> (${newState.channel.name})` },
						{
							name: "ID",
							value:
								`\`\`\`js\n` +
								`User: ${oldState.member.id}\n` +
								`Old Channel: ${oldState.channel.id}\n` +
								`New Channel: ${newState.channel.id}\n` +
								`Guild: ${oldState.guild.id}\n` +
								`\n\`\`\``,
						}
					)
					.setTimestamp();
				// Send embed
				logChannel.send({ embeds: [embed] });
			}
		}
	} catch (error) {
		console.error(error);
	}
}

module.exports = voiceStateUpdate;
