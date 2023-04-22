const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("roll")
		.setDescription("Roll a d20 dice!"),

	async execute(interaction) {
		try {
			// Roll a d20 dice
			const roll = Math.floor(Math.random() * 20) + 1;
			const rollEmbed = new EmbedBuilder()
				.setColor("#ED4245")
				.setDescription(`🎲 You rolled a **${roll}**!`);
			interaction.reply({ embeds: [rollEmbed] });
		} catch (e) {
			console.log(e);
			await interaction.reply({
				content: "There was an error while executing this command!",
				ephemeral: true,
			});
		}
	},
};
