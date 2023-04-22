const {
	PermissionFlagsBits,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	ActionRowBuilder,
	TextInputStyle,
} = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const { app } = require("firebase-admin");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("admin")
		.setDescription("Manage DragonBot")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("view-settings")
				.setDescription("View the current settings for DragonBot")
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("verification-role")
				.setDescription("The role to be given to verified users")
				.addRoleOption((options) =>
					options
						.setName("role")
						.setDescription("The role to be given to verified users")
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("verification-sync")
				.setDescription(
					"Toggle verification syncing across Drexel Discord's partner servers"
				)
				.addBooleanOption((options) =>
					options
						.setName("toggle")
						.setDescription(
							"Set to true to enable automatic syncing, false to disable automatic syncing"
						)
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("welcome-message-toggle")
				.setDescription("Toggle new member welcome messages in server")
				.addBooleanOption((options) =>
					options
						.setName("toggle")
						.setDescription(
							"Set to true to enable welcome messages, false to disable welcome messages"
						)
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("dm-message-toggle")
				.setDescription("Toggle new member direct message (DM) messages")
				.addBooleanOption((options) =>
					options
						.setName("toggle")
						.setDescription(
							"Set to true to enable DM messages, false to disable DM messages"
						)
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("ban-sync")
				.setDescription(
					"Toggle ban syncing across Drexel Discord's partner servers"
				)
				.addBooleanOption((options) =>
					options
						.setName("toggle")
						.setDescription(
							"Set to true to enable automatic syncing, false to disable automatic syncing"
						)
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("welcome-message-channel")
				.setDescription(
					"Set the channel where DragonBot will send welcome messages"
				)
				.addChannelOption((options) =>
					options
						.setName("channel")
						.setDescription("The channel to send welcome messages to")
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("welcome-message")
				.setDescription(
					"Set the welcome message that DragonBot will send when a new member joins the server"
				)
				.addStringOption((options) =>
					options
						.setName("message")
						.setDescription(
							"The welcome message to send to new members. Use {member} to mention the new member"
						)
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("dm-message")
				.setDescription(
					"Set the message that DragonBot will send to new members when they join the server"
				)
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.setDMPermission(false),
	async execute(interaction) {
		if (
			interaction.channel
				.permissionsFor(interaction.member)
				.has(PermissionFlagsBits.ManageGuild)
		) {
			if (interaction.options.getSubcommand() === "view-settings") {
				try {
					// Get the guild settings from the database
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					const guildDoc = await guildRef.get();
					const guildData = guildDoc.data();
					// Create the embed
					const SettingsEmbed = new EmbedBuilder()
						.setColor("#5865F2")
						.setTitle("Admin: View Settings")
						.setDescription(
							`Here are the current settings for DragonBot in ${interaction.guild.name}`
						)
						.addFields(
							{
								name: "Verification Role",
								value: `${
									guildData.verification_role_id
										? `<@&${guildData.verification_role_id}>`
										: "Not set"
								}`,
							},
							{
								name: "Verification Sync",
								value: `${
									guildData.is_verification_sync_enabled
										? "✅ Enabled"
										: "🛑 Disabled"
								}`,
							},
							{
								name: "Ban Sync",
								value: `${
									guildData.is_ban_sync_enabled ? "✅ Enabled" : "🛑 Disabled"
								}`,
							},
							{
								name: "Welcome Message",
								value: `${
									guildData.welcome_message
										? guildData.welcome_message.replace(
												"{member}",
												interaction.member
										  )
										: "Not set"
								}`,
							},
							{
								name: "Welcome Message Channel",
								value: `${
									guildData.welcome_channel_id
										? `<#${guildData.welcome_channel_id}>`
										: "Not set"
								}`,
							},
							{
								name: "Welcome Message Toggle",
								value: `${
									guildData.is_welcome_enabled ? "✅ Enabled" : "🛑 Disabled"
								}`,
							},
							{
								name: "DM Message",
								value: `${
									guildData.dm_welcome_message
										? guildData.dm_welcome_message.replace(/\\n/g, "\n")
										: "Not set"
								}`,
							},
							{
								name: "DM Message Toggle",
								value: `${
									guildData.is_dm_welcome_enabled ? "✅ Enabled" : "🛑 Disabled"
								}`,
							}
						)
						.setTimestamp();
					interaction.reply({ embeds: [SettingsEmbed] }).catch((e) => {
						console.error(e);
					});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: View Settings")
						.setDescription(
							"⛔️ There was an error getting the settings. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
				}
			} else if (interaction.options.getSubcommand() === "verification-role") {
				try {
					// Get the role from the interaction
					const role = interaction.options.getRole("role");
					// Save the role to verification_role_id in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						verification_role_id: role.id,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: Verification Role Settings")
						.setDescription(`✅ The verification role has been set to ${role}`)
						.setTimestamp();
					interaction
						.reply({ embeds: [SuccessEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: Verification Role Settings")
						.setDescription(
							"⛔️ There was an error setting the verification role. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
				}
			} else if (interaction.options.getSubcommand() === "verification-sync") {
				try {
					// Get the toggle from the interaction
					const toggle = interaction.options.getBoolean("toggle");
					// Save the toggle to verification_sync in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						is_verification_sync_enabled: toggle,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: Verification Sync Settings")
						.setDescription(
							`${
								toggle ? "✅" : "🛑"
							} Automatic verification syncing has been ${
								toggle ? "enabled" : "disabled"
							}.`
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [SuccessEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: Verification Sync Settings")
						.setDescription(
							"⛔️ There was an error setting the verification sync toggle. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
				}
			} else if (
				interaction.options.getSubcommand() === "welcome-message-channel"
			) {
				try {
					// Get the channel from the interaction
					const channel = interaction.options.getChannel("channel");
					// Save the channel to welcome_channel_id in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						welcome_channel_id: channel.id,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: Welcome Channel Settings")
						.setDescription(
							`✅ Welcome messages will now be sent to ${channel}`
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [SuccessEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: Welcome Channel Settings")
						.setDescription(
							"⛔️ There was an error setting the welcome channel. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed] });
				}
			} else if (
				interaction.options.getSubcommand() === "welcome-message-toggle"
			) {
				try {
					// Get the toggle from the interaction
					const toggle = interaction.options.getBoolean("toggle");
					// Save the toggle to welcome_message_enabled in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						is_welcome_enabled: toggle,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: Welcome Message Settings")
						.setDescription(
							`${toggle ? "✅" : "🛑"} Welcome messages have been ${
								toggle ? "enabled" : "disabled"
							}.`
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [SuccessEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: Welcome Message Settings")
						.setDescription(
							"⛔️ There was an error setting the welcome message toggle. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
				}
			} else if (interaction.options.getSubcommand() === "dm-message-toggle") {
				try {
					// Get the toggle from the interaction
					const toggle = interaction.options.getBoolean("toggle");
					// Save the toggle to dm_message_enabled in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						is_dm_welcome_enabled: toggle,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: DM Message Settings")
						.setDescription(
							`${toggle ? "✅" : "🛑"} DM messages have been ${
								toggle ? "enabled" : "disabled"
							}.`
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [SuccessEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: DM Message Settings")
						.setDescription(
							"⛔️ There was an error setting the DM message toggle. Please try again later."
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [ErrorEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				}
			} else if (interaction.options.getSubcommand() === "ban-sync") {
				try {
					// Get the toggle from the interaction
					const toggle = interaction.options.getBoolean("toggle");
					// Save the toggle to ban_sync_enabled in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						is_ban_sync_enabled: toggle,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: Ban Sync Settings")
						.setDescription(
							`${toggle ? "✅" : "🛑"} Ban syncing has been ${
								toggle ? "enabled" : "disabled"
							}.`
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [SuccessEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: Ban Sync Settings")
						.setDescription(
							"⛔️ There was an error setting the ban sync toggle. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
				}
			} else if (interaction.options.getSubcommand() === "welcome-message") {
				try {
					// Get the message from the interaction
					const message = interaction.options.getString("message");
					// Save the message to welcome_message in the guilds collection
					const guildRef = interaction.client.db
						.collection("guilds")
						.doc(interaction.guild.id);
					await guildRef.update({
						welcome_message: message,
					});
					// Send a success message
					const SuccessEmbed = new EmbedBuilder()
						.setColor("#43B581")
						.setTitle("Admin: Welcome Message Settings")
						.setDescription(
							`✅ Welcome message has been updated to "${message}"`
						)
						.setTimestamp();
					const testMessage = message.replace("{member}", interaction.member);

					interaction
						.reply({
							content: `**Here's a preview of your message:**\n\n${testMessage}`,
							embeds: [SuccessEmbed],
							ephemeral: true,
						})
						.catch((e) => {
							console.error(e);
						});
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: Welcome Message Settings")
						.setDescription(
							"⛔️ There was an error setting the welcome message. Please try again later."
						)
						.setTimestamp();
					interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
				}
			} else if (interaction.options.getSubcommand() === "dm-message") {
				try {
					// Get the message from the interaction
					// const message = interaction.options.getString("message");
					// Save the message to dm_message in the guilds collection
					const dmModal = new ModalBuilder()
						.setTitle("Admin: DM Message Settings")
						.setCustomId("dm-message-modal");

					const dmMessage = new TextInputBuilder()
						.setCustomId("dm-message-input")
						.setLabel("DM Message")
						.setStyle(TextInputStyle.Paragraph)
						.setPlaceholder(
							"Enter what your DM message should say. Use #channel-name to mention a channel."
						)
						.setRequired(true);
					const firstRowModal = new ActionRowBuilder().addComponents(dmMessage);
					dmModal.addComponents(firstRowModal);
					await interaction.showModal(dmModal);
				} catch (error) {
					console.error(error);
					const ErrorEmbed = new EmbedBuilder()
						.setColor("#ED4245")
						.setTitle("Admin: DM Message Settings")
						.setDescription(
							"⛔️ There was an error setting the DM message. Please try again later."
						)
						.setTimestamp();
					interaction
						.reply({ embeds: [ErrorEmbed], ephemeral: true })
						.catch((e) => {
							console.error(e);
						});
				}
			}
		} else {
			const ErrorEmbed = new EmbedBuilder()
				.setColor("#ED4245")
				.setTitle("Admin Tools")
				.setDescription(
					'⛔️ You must have the "Manage Server" permission to use this command!'
				)
				.setTimestamp();
			interaction.reply({ embeds: [ErrorEmbed], ephemeral: true });
		}
	},
};
