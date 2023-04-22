const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("latex")
		.setDescription("Converts LaTeX to an image.")
		.addStringOption((option) =>
			option
				.setName("string")
				.setDescription("The LaTeX to convert to an image.")
				.setRequired(true)
		)
		.setDMPermission(false),
	async execute(interaction) {
		try {
			try {
				// convert latex input to readable string
				const latex = encodeURIComponent(
					interaction.options.getString("string")
				);
				// https://latex.codecogs.com/png.latex?%5Cdpi%7B300%7D%20%5Cbg_white%20${latex}
				// create embed
				const LatexEmbed = new EmbedBuilder()
					.setTitle("LaTeX")
					.setColor("0099ff")
					.setDescription(
						`Here is your LaTeX: \`${interaction.options.getString("string")}\``
					)
					.setImage(
						`https://latex.codecogs.com/png.latex?%5Cdpi%7B300%7D%20%5Cbg_white%20${latex}`
					);
				interaction.reply({ embeds: [LatexEmbed] }).catch((e) => {
					console.error(e);
				});
			} catch (e) {
				console.log(e);
				await interaction.reply({
					content: "There was an error with processing your LaTeX request",
					ephemeral: true,
				});
			}
		} catch (e) {
			console.log(e);
			await interaction.reply({
				content: "There was an error while executing this command!",
				ephemeral: true,
			});
		}
	},
};
