require("dotenv").config();
const { REST } = require("@discordjs/rest");
const {
	Client,
	GatewayIntentBits,
	Collection,
	EmbedBuilder,
	ActivityType,
	Events,
} = require("discord.js");
const { Routes } = require("discord-api-types/v10");
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildModeration,
	],
});
const admin = require("firebase-admin");

const fs = require("fs");
const commandFiles = fs
	.readdirSync("./commands")
	.filter((file) => file.endsWith(".js"));
const serviceAccount = require("./serviceKey.json");

const secrets =
	process.env.DISCORD_API_TOKEN == undefined ? require("./.env") : process.env;

// load commands
const commands = [];
client.commands = new Collection();

for (const file of commandFiles) {
	const command = require(`./commands/${file}`);
	commands.push(command.data.toJSON());
	client.commands.set(command.data.name, command);
}

const rest = new REST({ version: "10" }).setToken(secrets.DISCORD_API_TOKEN);

(async () => {
	try {
		console.log("Started refreshing application (/) commands.");

		await rest.put(Routes.applicationCommands(process.env.BOT_CLIENT_ID), {
			body: commands,
		});

		console.log("Successfully reloaded application (/) commands.");
	} catch (error) {
		console.error(error);
	}
})();

client.on("ready", () => {
	admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

	try {
		client.db = admin.firestore();
		console.log("Database ready!");
	} catch {
		console.error(error);
	}

	client.user.setActivity("with John Fry", { type: ActivityType.Playing });
	client.user.setPresence({
		status: "online",
	});

	console.log(`Logged in as ${client.user.tag}!`);
});

client.on("guildMemberAdd", async (member) => {
	try {
		// Get user data
		const userDoc = client.db.collection("users").doc(member.id);
		const userRef = await userDoc.get();
		const userData = await userRef.data();
		// Get guild data
		const guildDoc = client.db.collection("guilds").doc(member.guild.id);
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
	} catch (error) {
		console.error(error);
	}
});

/* 
BAN SYNCING
- This feature will sync bans from one server to all other servers that have ban syncing enabled
*/

client.on("guildBanAdd", async (guild) => {
	const userDoc = client.db.collection("users").doc(guild.user.id);
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
	const guilds = await client.db.collection("guilds").get();
	guilds.forEach(async (obj) => {
		const guildData = await obj.data();
		if (guildData.is_ban_sync_enabled === true) {
			console.log(`Banning ${guild.user.id} from ${obj.id}...`);
			const guild_id = await client.guilds.cache.get(guild.guild.id);
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
});

/* 
FOR DREXEL DISCORD ONLY
- This feature is badly coded
- It checks if your introduction is longer than "hi or hello"
- This could use a re-work
*/
client.on("messageCreate", (message) => {
	try {
		if (message.guild.id === "323942271550750720") {
			// Check if "Guild" is Drexel Discord
			if (message.channel.id === "575488601165529088") {
				// Check if Message is in "Introductions Channel"
				if (message.content.length < 7) {
					message.delete();
					message.author.createDM().then((dm) => {
						dm.send("Please give a more detailed introduction.");
					}).catch((e) => console.log(e));
				} else {
					message.member.roles.add("763893629374300190"); // Add "Introduced" role
				}
			}
		}
	} catch (error) {
		console.error(error);
	}
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isCommand()) return;
	const command = client.commands.get(interaction.commandName);
	if (!command) return;
	try {
		await command.execute(interaction);
	} catch (error) {
		if (error) console.error(error);
		await interaction.reply({
			content: "There was an error while executing this command!",
			ephemeral: true,
		});
	}
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isModalSubmit()) return;
	if (interaction.customId === "dm-message-modal") {
		const dmModalInputValue =
			interaction.fields.getTextInputValue("dm-message-input");
		const breakspacedDM = dmModalInputValue.replace(/\n/g, "\\n");
		const formattedDM = breakspacedDM.replace(
			/#([a-zA-Z0-9-_]+)(?=\s|$)/g,
			(match, p1) => {
				const channel = interaction.guild.channels.cache.find(
					(channel) => channel.name === p1
				);
				return `<#${channel.id}>`;
			}
		);
		const guildRef = interaction.client.db
			.collection("guilds")
			.doc(interaction.guildId);
		await guildRef.update({
			dm_welcome_message: formattedDM,
		});
		const SuccessEmbed = new EmbedBuilder()
			.setColor("#43B581")
			.setTitle("Admin: DM Message Settings")
			.setDescription(
				`✅ DM message has been updated to "${dmModalInputValue}"`
			)
			.setTimestamp();
		const testMessage = formattedDM.replace(/\\n/g, "\n");
		await interaction.reply({
			content: `**Here's a preview of your message:**\n\n${testMessage}`,
			embeds: [SuccessEmbed],
			ephemeral: true,
		});
	}
});

client.on("guildCreate", (guild) => {
	console.log("Guild Joined: " + guild.name);
	client.db.collection("guilds").doc(guild.id).set({
		guildName: guild.name,
		verification_role_id: "",
		welcome_channel_id: "",
		welcome_message: "",
		is_verification_sync_enabled: true,
		is_ban_sync_enabled: false,
		is_welcome_enabled: false,
		is_dm_welcome_enabled: false,
		dm_welcome_message: "",
	});
});
client.on("guildDelete", (guild) => {
	console.log("Guild Left: " + guild.name);
});

client.login(process.env.DISCORD_API_TOKEN);