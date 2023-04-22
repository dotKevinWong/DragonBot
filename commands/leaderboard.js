const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const request = require("request");

const dict = {
	0: ":crown:",
	1: ":second_place:",
	2: ":third_place:",
	3: ":four:",
	4: ":five:",
	5: ":six:",
	6: ":seven:",
	7: ":eight:",
	8: ":nine:",
	9: ":keycap_ten:",
	10: ":one::one:",
	11: ":one::two:",
	12: ":one::three:",
	13: ":one::four:",
	14: ":one::five:",
	15: ":one::six:",
	16: ":one::seven:",
	17: ":one::eight:",
	18: ":one::nine:",
	19: ":two::zero:",
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("Pull up the server's MEE6 Leaderboard.")
		.setDMPermission(false),
	async execute(interaction) {
		try {
			request(
				"https://mee6.xyz/api/plugins/levels/leaderboard/" +
					interaction.guild.id,
				function (error, response, body) {
					var json = JSON.parse(body);
					const filter = [];
					let max = 10;
					let count = 0;
					try {
						while (count < max) {
							filter.push({
								name: `${dict[count]}`,
								value: `${interaction.guild.members.cache.get(
									json.players[count].id
								)} | ${json.players[count].message_count} Messages | ${
									json.players[count].xp
								} XP | Level ${json.players[count].level}`,
							});
							count++;
						}
						const rankEmbed = new EmbedBuilder()
							.setColor("0099ff")
							.setTitle("Top Members")
							.setURL("https://mee6.xyz/en/leaderboard/" + interaction.guild.id)
							.setDescription("These are the top members of the server!")
							.addFields(filter);
						interaction.reply({ embeds: [rankEmbed] });
					} catch (e) {
						console.log(interaction.guild.id + " has no MEE6 data.");
						const norankEmbed = new EmbedBuilder()
							.setColor("ED4245")
							.setTitle("⛔️ Error")
							.setDescription("You need to setup MEE6 to use this command!");
						interaction.reply({ embeds: [norankEmbed] });
					}
				}
			);
		} catch (e) {
			console.log(e);
			await interaction.reply({
				content: "There was an error while executing this command!",
				ephemeral: true,
			});
		}
	},
};
