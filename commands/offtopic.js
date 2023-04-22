const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../config.json");

/* TODO:
 - Move off-topic image descriptions to database. Descriptions should be managed by the server admins.
*/

module.exports = {
	data: new SlashCommandBuilder()
		.setName("offtopic")
		.setDescription("The conversation is off-topic!")
		.setDMPermission(false),
	async execute(interaction) {
		try {
			const OfftopicEmbed = new EmbedBuilder()
				.setTitle("The Conversation is Off-Topic")
				.setColor("0099ff")
				.setDescription(config.OFFTOPIC_DESCRIPTION)
				.setImage(
					config.OFFTOPIC_IMAGE_ARRAY[
						Math.floor(Math.random() * config.OFFTOPIC_IMAGE_ARRAY.length)
					]
				);
			interaction.reply({ embeds: [OfftopicEmbed] });
		} catch (e) {
			console.log(e);
			await interaction.reply({
				content: "There was an error while executing this command!",
				ephemeral: true,
			});
		}
	},
};
