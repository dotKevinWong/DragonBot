const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("help")
		.setDescription("Find out what DragonBot can do!")
		.addSubcommand((options) =>
			options.setName("levels").setDescription("Level Commands")
		)
		.addSubcommand((options) =>
			options.setName("dragonbot").setDescription("DragonBot Commands")
		)
		.setDMPermission(false),
	async execute(interaction) {
		try {
			if (interaction.options.getSubcommand() === "levels") {
				const LevelsEmbed = new EmbedBuilder()
					.setTitle("Level Commands")
					.setColor("0099ff")
					.addFields(
						{ name: "`/levels`", value: "Get a link to the leaderboard" },
						{
							name: "`/rank (memeber?)`",
							value: "Get the rank of yourself or anyone in the server",
						}
					);
				await interaction.reply({ embeds: [LevelsEmbed] }, { ephemeral: true });
			} else if (interaction.options.getSubcommand() === "dragonbot") {
				const DragonBotEmbed = new EmbedBuilder()
					.setTitle("DragonBot Commands")
					.setColor("0099ff")
					.addFields(
						{
							name: "`/leaderboard`",
							value: "Pull up the server's MEE6 Leaderboard.",
						},
						{
							name: "`/membercount`",
							value:
								"Pull up the number of Users, Bots and verified Students/Alumni in the Server.",
						},
						{
							name: "`/suggest`",
							value:
								"Suggest a feature for the server! DragonBot will DM you for more information about your suggestion.",
						},
						{
							name: "`/verify`",
							value:
								"Start the verification process. Expect a DM from our very own DragonBot!",
						}
					);
				await interaction
					.reply({ embeds: [DragonBotEmbed] }, { ephemeral: true })
					.catch((e) => {
						console.error(e);
					});
			} else {
				await interaction.reply({
					content: "Please enter a valid command!",
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
