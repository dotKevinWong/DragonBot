const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../config.json");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("suggest")
		.setDescription("Suggest a feature for Drexel Discord!")
		.addStringOption((options) =>
			options
				.setName("suggestion")
				.setDescription("What would you like to suggest?")
				.setRequired(true)
		),
	async execute(interaction) {
		try {
			// Save the suggestion to the database
			const suggestion = interaction.options.getString("suggestion");
			const suggestionRef = interaction.client.db
				.collection("suggestions")
				.doc();
			await suggestionRef.set({
				suggestion: suggestion,
				discord_id: interaction.user.id,
				discord_username: interaction.user.username,
				discord_discriminator: interaction.user.discriminator,
				creted_at: Date.now(),
			});
			const SuggestionEmbed = new EmbedBuilder()
				.setTitle("Server Suggestion Request")
				.setColor("0099ff")
				.addFields({
					name: "🗣️ Suggestion",
					value: suggestion,
				})
				.setFooter({
					text: `Requested by ${interaction.user.username}`,
					icon_url: interaction.user.displayAvatarURL(),
				});

			const msg = await interaction.client.channels.cache
				.get(config.MOD_NOTES_CHANNEL_ID)
				.send({ embeds: [SuggestionEmbed] });

			msg.react("👍");
			msg.react("👎");

			// Send confirmation message

			await interaction.reply({
				content: "Thanks for your suggestion! :)",
				ephemeral: true,
			});
		} catch (e) {
			console.log(e);
			await interaction.reply({
				content: "There was an error while executing this command!",
				ephemeral: true,
			});
		}
	},
};
