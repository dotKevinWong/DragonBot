const { EmbedBuilder } = require("discord.js");

function messageDelete(message) {
    try {
		if (message.guild.id == "323942271550750720") {
			const logChannel = message.guild.channels.cache.get(
				"573650098018451518"
			);
			if (!logChannel) return;
			const embed = new EmbedBuilder()
				.setColor("#ff0000")
				.setTitle(`Message Deleted`)
				.setAuthor({
					name: `${message.author.tag}`,
					iconURL: `${message.author.avatarURL({ dynamic: true })}`,
				})
				.addFields(
					{ name: "Author", value: `${message.author}`, inline: true },
					{ name: "Channel", value: `<#${message.channel.id}>`, inline: true },
					{
						name: "Content",
						value: message.content.length >= 1 ? message.content : "No content",
					},
					{
						name: "Reactions",
						value:
							message.reactions.cache.size >= 1
								? message.reactions.cache
										.map(
											(reaction) =>
												`${reaction.emoji} - ${reaction.count}x`
										)
										.join("\n")
								: "No reactions",
					},
					{
						name: "Attachments",
						value:
							message.attachments.size >= 1
								? message.attachments
										.map((attachment) => attachment.url)
										.join("\n")
								: "No attachments",
					},
					{
						name: "Stickers",
						value:
							message.stickers.size >= 1
								? message.stickers
										.map((sticker) => `${sticker.name} - ${sticker.url}`)
										.join("\n")
								: "No stickers",
					},
					{
						name: "ID",
						value:
							`\`\`\`\js\n` +
							`User: ${message.author.id}\n` +
							`Message: ${message.id}\n` +
							`Channel: ${message.channel.id}\n` +
							`Guild: ${message.guild.id}\n` +
							`Created Timestamp: ${message.createdTimestamp}\n` +
							`Edited Timestamp: ${message.editedTimestamp}\n` +
							`Nonce: ${message.nonce}` +
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

module.exports = messageDelete;