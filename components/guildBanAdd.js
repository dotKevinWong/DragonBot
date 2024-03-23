const { EmbedBuilder } = require("discord.js");

/* 
BAN SYNCING
- This feature will sync bans from one server to all other servers that have ban syncing enabled
*/
async function guildBanAdd(guild) {
	try {
		const userDoc = guild.client.db.collection("users").doc(guild.user.id);
		const userRef = await userDoc.get();
		if (!userRef.exists) {
			await userDoc.set({
				discord_id: guild.user.id,
				is_profile_disabled: false,
			});
		}
		await userDoc.update({
			is_profile_disabled: true,
			is_banned: true,
			ban_guild_id: guild.guild.id,
			ban_date: new Date(),
		});
		const guilds = await guild.client.db.collection("guilds").get();
		guilds.forEach(async (obj) => {
			const guildData = await obj.data();
			if (guildData.is_ban_sync_enabled === true) {
				console.log(`Banning ${guild.user.id} from ${obj.id}...`);
				const guild_id = await guild.client.guilds.cache.get(guild.guild.id);
				if (!guild_id) return;
				guild_id.members
					.ban(guild.user.id, {
						reason: `Banned synced from ${guild.guild.name} (${guild.guild.id})`,
					})
					.then((user) => {
						console.log(`${user} - Banned ${guild.user.id} from ${obj.id}!`);
					})
					.catch((e) => {
						console.log(e);
					});
			} else {
				console.log(`Ban syncing disabled for ${obj.id}`);
			}
		});
	} catch (error) {
		console.error(error);
	}
}

module.exports = guildBanAdd;
