const { EmbedBuilder } = require("discord.js");
const timeFormatter = require("../utils/timeFormatter");
const timeDiff = require("../utils/timeDiff");

async function guildMemberAdd(member) {
	try {
		// Get user data
		const userDoc = member.client.db.collection("users").doc(member.id);
		const userRef = await userDoc.get();
		const userData = await userRef.data();
		// Get guild data
		const guildDoc = member.client.db.collection("guilds").doc(member.guild.id);
		const guildRef = await guildDoc.get();
		const guildData = await guildRef.data();

		// Create user document if it doesn't exist
		if (!userRef.exists) {
			await userDoc.set({
				discord_id: member.id,
				is_profile_disabled: false,
			});
		}
		// Send welcome message if enabled
		if (guildData.is_welcome_enabled === true) {
			try {
				const channel = member.guild.channels.cache.get(
					guildData.welcome_channel_id
				);
				if (!channel) return;
				channel
					.send(guildData.welcome_message.replace("{member}", member))
					.catch((e) => console.log(e));
			} catch (e) {
				console.log(e);
			}
		}
		// Send DM welcome message if enabled
		if (guildData.is_dm_welcome_enabled === true) {
			try {
				const welcomeMessage = guildData.dm_welcome_message.replace(
					/\\n/g,
					"\n"
				);
				member.send(welcomeMessage).catch((e) => console.log(e));
			} catch (e) {
				console.log(e);
			}
		}
		if (userRef.exists) {
			// Verify user if they are verified and sync is enabled
			if (
				userData.is_verified === true &&
				guildData.is_verification_sync_enabled === true
			) {
				try {
					const role = member.guild.roles.cache.get(
						guildData.verification_role_id
					);
					if (!role) return;
					member.roles.add(role).catch((e) => console.log(e));
					const verificationEmbed = new EmbedBuilder()
						.setTitle("✅ Verification Status")
						.setDescription(
							`You have been automatically verified in ${member.guild.name}! Thanks to DragonBot, verification status is synced across all Drexel University discord servers.`
						)
						.setColor("#00ff00");
					member
						.send({ embeds: [verificationEmbed] })
						.catch((e) => console.log(e));
				} catch (e) {
					console.log(e);
				}
			}
		}
		// Log user join
		if (member.guild.id == "323942271550750720") {
			const logChannel = member.guild.channels.cache.get("573650098018451518");
			if (!logChannel) return;
			const embed = new EmbedBuilder()
				.setColor("#00ff00")
				.setTitle("Member Joined")
				.setAuthor({
					name: `${member.user.tag}`,
					iconURL: `${member.user.avatarURL({ dynamic: true })}`,
				})
				.addFields(
					{ name: "User", value: `${member.user}`, inline: true },
					{
						name: "Account Created At",
						value: `${timeFormatter(member.user.createdAt)} (${timeDiff(
							member.user.createdAt
						)})`,
					},
					{
						name: "Joined Server At",
						value: `${timeFormatter(member.joinedAt)}`,
					},
					{
						name: "ID",
						value:
							`\`\`\`js\n` +
							`User: ${member.id}\n` +
							`Guild: ${member.guild.id}\n` +
							`\n\`\`\``,
					}
				)
				.setTimestamp();
			logChannel.send({ embeds: [embed] });
		}
	} catch (error) {
		console.error(error);
	}
}

module.exports = guildMemberAdd;
