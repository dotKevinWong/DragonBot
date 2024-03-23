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
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildVoiceStates,
	],
});
const admin = require("firebase-admin");

// Discord API Initialization
const fs = require("fs");
const commandFiles = fs
	.readdirSync("./commands")
	.filter((file) => file.endsWith(".js"));
const serviceAccount = require("./serviceKey.json");
const messageDelete = require("./components/messageDelete");
const messageUpdate = require("./components/messageUpdate");
const guildBanAdd = require("./components/guildBanAdd");
const guildMemberRemove = require("./components/guildMemberRemove");
const guildMemberAdd = require("./components/guildMemberAdd");
const guildMemberUpdate = require("./components/guildMemberUpdate");
const voiceStateUpdate = require("./components/voiceStateUpdate");
const messageCreate = require("./components/messageCreate");

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

/*
Logging
ONLY ENABLED FOR DREXEL DISCORD	SERVER
*/

client.on("guildMemberAdd", async (member) => {
	guildMemberAdd(member);
});

/* Log Kicked Members */
client.on("guildMemberRemove", async (member) => {
	guildMemberRemove(member);
});

/* Log Deleted Messages */
client.on("messageDelete", async (message) => {
	messageDelete(message);
});

/* Log Bulk Deleted Messages */
client.on("messageDeleteBulk", async (messages) => {
	messages.forEach((message) => {
		messageDelete(message);
	});
});

/* Log Edited Messages */
client.on("messageUpdate", async (oldMessage, newMessage) => {
	messageUpdate(oldMessage, newMessage);
});

/* Log Role Updates */
client.on("guildMemberUpdate", async (oldMember, newMember) => {
	guildMemberUpdate(oldMember, newMember);
});

/* Log Member Join and Leave on Voice Channels */
client.on("voiceStateUpdate", async (oldState, newState) => {
	voiceStateUpdate(oldState, newState);
});

/* Ban Syncing */
client.on("guildBanAdd", async (guild) => {
	guildBanAdd(guild);
});

/* Introduction Checking */
client.on("messageCreate", (message) => {
	messageCreate(message);
});

/* Command Handling 
- This is the main command handler
- It listens for command interactions and executes them from the commands folder
*/

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

/* Modal Handling
- This is the main modal handler
- It listens for modal interactions and executes them based on the modal customId
TODO: Create Guild Collection and Handle Modals via Folder
*/
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

/* Guild Join
- This is the guild join handler
- It creates a new document in the guilds collection when the bot joins a new server
*/
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

/* Guild Leave
- This is the guild leave handler
- At the moment, it only logs when the bot leaves a server
*/
client.on("guildDelete", (guild) => {
	console.log("Guild Left: " + guild.name);
});

client.login(process.env.DISCORD_API_TOKEN);
