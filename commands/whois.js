const { Interaction, EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../config.json");

/* 
TODO: User Profiles
- Move this to the web portal
*/

function createProfileEmbed(userData) {
	const embed = new EmbedBuilder()
		.setTitle("User Profile")
		.setColor("#0099ff")
		.addFields(
			{
				name: "🧑 Name",
				value: userData.name ? userData.name : "",
			},
			{
				name: "🫶 Pronouns",
				value: userData.pronouns ? userData.pronouns : "",
			},
			{
				name: "📕 Major",
				value: userData.major ? userData.major : "",
			},
			{
				name: "🏫 College",
				value: userData.college ? userData.college : "",
			},
			{
				name: "📅 Year",
				value: userData.year ? userData.year : "",
			},
			{
				name: "📝 Plan",
				value: userData.plan ? userData.plan : "",
			},
			{
				name: "😎 Description",
				value: userData.description ? userData.description : "",
			}
		);
	if (userData.plan === "5 Year/3 Co-Op") {
		embed.addFields(
			{
				name: "1️⃣ Co-Op 1",
				value: userData.coop1 ? userData.coop1 : "",
			},
			{
				name: "2️⃣ Co-Op 2",
				value: userData.coop2 ? userData.coop2 : "",
			},
			{
				name: "3️⃣ Co-Op 3",
				value: userData.coop3 ? userData.coop3 : "",
			}
		);
	} else if (userData.plan === "4 Year/1 Co-Op") {
		embed.addFields({
			name: "🏢 Co-Op",
			value: userData.coop1 ? userData.coop1 : "",
		});
	}
	if (userData.clubs.length > 0) {
		const club_list = userData.clubs;
		let clubs = "";
		for (i = 0; i < club_list.length; i++) {
			clubs = clubs + club_list[i];
			if (i != club_list.length - 1) {
				clubs = clubs + ", ";
			}
		}
		embed.addFields({
			name: "💫 Clubs",
			value: userData.clubs.join(", "),
		});
	}
	return embed;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("whois")
		.setDescription(
			"See more about another member. If no user is specified, your own profile will be shown."
		)
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription(
					"The user to get information about. The user will be notified that their profile was requested."
				)
		)
		.setDMPermission(false),
	async execute(interaction) {
		try {
			// Check if user is verified in the server by checking if they have the verified role based on Guild ID
			const guildRef = interaction.client.db
				.collection("guilds")
				.doc(interaction.guildId);
			const guildDoc = await guildRef.get();
			const guildData = await guildDoc.data();
			const role = interaction.guild.roles.cache.find(
				(role) => role.id === guildData.verification_role_id
			);
			if (interaction.member.roles.cache.has(role.id)) {
				if (interaction.options.get("user")) {
					const member = interaction.options.getUser("user");
					const userRef = interaction.client.db
						.collection("users")
						.doc(member.id);
					const userDoc = await userRef.get();
					const userData = await userDoc.data();
					if (!userDoc.exists || !userData.name) {
						await interaction.reply({
							content: "This user has not set up their profile yet!",
							ephemeral: true,
						});
					} else {
						const profile = createProfileEmbed(userData);
						// send a direct message to the user that their profile was requested by another user
						member
							.send(
								`Your profile was requested by ${interaction.user.tag} (<@${interaction.user.id}>) in ${interaction.guild.name} (https://discord.com/channels/${interaction.guild.id}/${interaction.guild.id})`
							)
							.catch((e) => console.log(e));
						await interaction.reply({ embeds: [profile], ephemeral: true });
					}
				} else {
					// get own profile
					const userRef = interaction.client.db
						.collection("users")
						.doc(interaction.user.id);
					const userDoc = await userRef.get();
					const userData = await userDoc.data();
					if (!userData.name || !userDoc.exists) {
						await interaction.reply({
							content: "You have not set up your profile yet!",
							ephemeral: true,
						});
					} else {
						const profile = createProfileEmbed(userData);
						await interaction.reply({ embeds: [profile], ephemeral: true });
					}
				}
			} else {
				await interaction.reply({
					content: "You must be verified to use this command!",
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
