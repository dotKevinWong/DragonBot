const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

/* Mod Commands 
- Talk - Send an announcment to the channel
- React - React to a message
*/

module.exports = {
	data: new SlashCommandBuilder()
		.setName("mod")
		.setDescription("Mod Commands")
		.addSubcommand((options) =>
			options
				.setName("talk")
				.setDescription("Send an announcment to the channel")
				.addStringOption((option) =>
					option
						.setName("message")
						.setDescription("What would you like to say?")
						.setRequired(true)
				)
		)
		.addSubcommand((options) =>
			options
				.setName("react")
				.setDescription("React to a message")
				.addStringOption((option) =>
					option
						.setName("message")
						.setDescription("What message would you like to react to?")
						.setRequired(true)
				)
				.addStringOption((option) =>
					option
						.setName("emote")
						.setDescription("What emote would you like to react with?")
						.setRequired(true)
				)
		)
		// We will need to find a way to make this work without setting Discord permissions
		.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
		.setDMPermission(false),
	async execute(interaction) {
		if (
			interaction.channel
				.permissionsFor(interaction.member)
				.has(PermissionFlagsBits.KickMembers)
		) {
			if (interaction.options.getSubcommand() === "talk") {
				try {
					const message = interaction.options.getString("message");
					const TalkEmbed = new EmbedBuilder()
						.setTitle("📣 Announcement")
						.setColor("0099ff")
						.setDescription(message)
						.setFooter({
							text: `Posted by ${interaction.user.username}`,
							iconURL: interaction.user.avatarURL(),
						});
					interaction.reply({ embeds: [TalkEmbed] });
				} catch (e) {
					console.log(e);
					interaction.reply("There was an error while executing this command!");
				}
			} else if (interaction.options.getSubcommand() === "react") {
				try {
					const message = interaction.options.getString("message");
					const emote = interaction.options.getString("emote");
					// react to a message ID with an emote
					const msg = await interaction.channel.messages.fetch(message);
					if (!msg)
						return interaction.reply({
							content: "Message not found!",
							ephemeral: true,
						});
					await msg.react(emote);
					interaction.reply({ content: "Reaction sent!", ephemeral: true });
				} catch (e) {
					console.log(e);
					interaction.reply({
						message: "There was an error while executing this command!",
						ephemeral: true,
					});
				}
			} else {
				await interaction.reply({
					content: "Please enter a valid command!",
					ephemeral: true,
				});
			}
		} else {
			const ErrorEmbed = new EmbedBuilder()
				.setColor("ED4245")
				.setTitle("Moderator Tools")
				.setDescription(
					'⛔️ You must have the "Kick Members" permission to use this command!'
				)
				.setTimestamp();
			interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
		}
	},
};
