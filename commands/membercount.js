const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("membercount")
		.setDescription(
			"Get the number of users, bots and verified students/alumni in the server."
		)
		.setDMPermission(false),
	async execute(interaction) {
		try {
			// fetch all members
			interaction.guild.members.fetch();
			// get the member count
			const memberCount = interaction.guild.memberCount;
			// get the bot count
			const botCount = interaction.guild.members.cache.filter(
				(member) => member.user.bot
			).size;
			// get the verified count
			// get verified role id from database in guilds collection

			const guildRef = interaction.client.db
				.collection("guilds")
				.doc(interaction.guild.id);
			const guildDoc = await guildRef.get();
			const config = guildDoc.data();

			const verifiedCount = interaction.guild.members.cache.filter((member) =>
				member.roles.cache.has(config.verification_role)
			).size;

			// get the unverified count
			const unverifiedCount = memberCount - botCount;
			// create the embed
			const MemberCountEmbed = new EmbedBuilder()
				.setTitle("Member Count")
				.setColor("0099ff")
				.addFields(
					{ name: "👤 Members", value: `${memberCount}` },
					{ name: "🤓 Humans", value: `${unverifiedCount}` },
					{ name: "😎 Verified", value: `${verifiedCount}` },
					{ name: "🤖 Bots", value: `${botCount}` }
				);
			interaction.reply({ embeds: [MemberCountEmbed] });
		} catch (e) {
			console.log(e);
			await interaction.reply({
				content: "There was an error while executing this command!",
				ephemeral: true,
			});
		}
	},
};
