const { EmbedBuilder } = require("discord.js");

function messageUpdate(oldMessage, newMessage) {
	try {
		if (oldMessage.guild.id == "323942271550750720") {
			const logChannel = oldMessage.guild.channels.cache.get(
				"573650098018451518"
			);
			if (!logChannel) return;
			if (oldMessage.author.bot) return;
			const embed = new EmbedBuilder()
				.setColor("#ffcc00")
				.setTitle(`Message Edited`)
				.setAuthor({
					name: `${oldMessage.author.tag}`,
					iconURL: `${oldMessage.author.avatarURL({ dynamic: true })}`,
				})
				.addFields(
					{ name: "Author", value: `${oldMessage.author}`, inline: true },
					{
						name: "Channel",
						value: `<#${oldMessage.channel.id}>`,
						inline: true,
					},
					{
						name: "Old Content",
						value:
							oldMessage.content.length >= 1
								? oldMessage.content
								: "No content",
					},
					{
						name: "New Content",
						value:
							newMessage.content.length >= 1
								? newMessage.content
								: "No content",
					},
					{
						name: "ID",
						value:
							`\`\`\`\js\n` +
							`User: ${newMessage.author.id}\n` +
							`Message: ${newMessage.id}\n` +
							`Channel: ${newMessage.channel.id}\n` +
							`Guild: ${newMessage.guild.id}\n` +
							`Created Timestamp: ${newMessage.createdTimestamp}\n` +
							`Edited Timestamp: ${newMessage.editedTimestamp}\n` +
							`Nonce: ${newMessage.nonce}` +
							`\`\`\``,
					}
				)
				.setTimestamp();
			logChannel.send({ embeds: [embed] });
		}
	} catch (error) {
		console.error(error);
	}
}

module.exports = messageUpdate;
