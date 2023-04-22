const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const sendEmail = require("../utils/sendEmail");
const config = require("../config.json");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("verify")
		.setDescription("Verify your Discord account using your Drexel email")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("sync")
				.setDescription(
					"If you're already Verified, this will sync your Verification status to the current serrver"
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("email")
				.setDescription(
					"Step 1: Verify your Discord account using your Drexel email"
				)
				.addStringOption((options) =>
					options
						.setName("email")
						.setDescription(
							"Ex: xyz123@drexel.edu or xyz123@dragons.drexel.edu"
						)
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("code")
				.setDescription(
					"Step 2: Enter the verification code sent to your email"
				)
				.addStringOption((options) =>
					options
						.setName("code")
						.setDescription("Enter the code you recieved in your e-mail")
						.setRequired(true)
				)
		),
	async execute(interaction) {
		if (interaction.options.getSubcommand() === "sync") {
			// check if command is in DM using DiscordJS 14 channel.type doesn't work so stop using it
			if (interaction.guildId === null) {
				const verificationEmbed = new EmbedBuilder()
					.setTitle("🛑 Verification Not Synced")
					.setDescription(
						"You cannot sync your verification status in DMs. Please run this command in a server."
					)
					.setColor("#ff0000");
				interaction.reply({
					embeds: [verificationEmbed],
				});
			} else {
				const userRef = interaction.client.db
					.collection("users")
					.doc(interaction.user.id);
				const userDoc = await userRef.get();
				if (userDoc.exists) {
					const userData = userDoc.data();
					if (userData.is_verified === true) {
						const guild = interaction.client.db
							.collection("guilds")
							.doc(interaction.guildId);
						const guildDoc = await guild.get();
						const guildData = guildDoc.data();
						const role = interaction.guild.roles.cache.get(
							guildData.verification_role_id
						);
						interaction.member.roles.add(role);
						const verificationEmbed = new EmbedBuilder()
							.setTitle("✅ Verification Synced")
							.setDescription(
								`You verification status has been synced to this server!`
							)
							.setColor("#00ff00");
						interaction.reply({
							embeds: [verificationEmbed],
							ephemeral: true,
						});
					} else {
						const verificationEmbed = new EmbedBuilder()
							.setTitle("🛑 Verification Not Synced")
							.setDescription(
								`You are not verified in DragonBot. Please verify your account by typing /verify and following the instructions.`
							)
							.setColor("#ff0000");
						interaction.reply({
							embeds: [verificationEmbed],
							ephemeral: true,
						});
					}
				}
				return;
			}
		} else if (interaction.options.getSubcommand() === "email") {
			var userEmail = interaction.options.getString("email");

			try {
				// use regex make sure the email is valid and is a drexel email that ends with @drexel.edu or @dragons.drexel.edu
				const regex = new RegExp(
					"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
				);

				if (
					regex.test(userEmail) &&
					(userEmail.includes("@drexel.edu") ||
						userEmail.includes("@dragons.drexel.edu"))
				) {
					// generate 6 character alphanumeric code
					const code = Math.random().toString(36).substring(2, 8);

					// save code to database
					const verificationRef = interaction.client.db
						.collection("verifications")
						.doc(interaction.user.id);
					await verificationRef.set({
						email: userEmail,
						code: code,
						discord_id: interaction.user.id,
						created: new Date().getTime(),
					});
					sendEmail(userEmail, code);
					interaction.reply({
						content:
							"Your verification code was sent to " +
							userEmail +
							"!" +
							"\n\n" +
							"Please note that if you're an incoming student or transfer student, you will need to wait a few days (usually 3 days) before you can verify your account as your email cannot accept outside e-mails." +
							"\n\n" +
							"Please check your spam folder if you do not see the email in your inbox." +
							"\n\n" +
							"If you did not receive the verification code, please contact a moderator and we can manually verify you." +
							"\n\n" +
							"Please check your email and enter the code by typing `/verify code <code>`",
						ephemeral: true,
					});
					const verificationEmbed = new EmbedBuilder()
						.setTitle("Verification: Code Sent")
						.setColor("#0099ff")
						.addFields({
							name: "👤 User",
							value: `<@${interaction.user.id}>`,
						})
						.addFields({
							name: "📧 Email",
							value: userEmail,
						})
						.addFields({
							name: "🔑 Code",
							value: code,
						})
						.setTimestamp();
					interaction.client.channels.cache
						.get(config.MOD_NOTES_CHANNEL_ID)
						.send({ embeds: [verificationEmbed] })
						.catch((e) => console.log(e));
				} else {
					await interaction.reply({
						content: "Please enter a valid Drexel email address",
						ephemeral: true,
					});
					// send error message to mod-notes channel on discord server 323942271550750720 with channel id 611710233110380574
					const invalidEmailEmbed = new EmbedBuilder()
						.setTitle("Verification: Invalid Email Address")
						.setColor("#ED4245")
						.addFields({
							name: "⛔️ Warning",
							value: "User tried to verify with an invalid email address",
						})
						.addFields({
							name: "👤 User",
							value: `<@${interaction.user.id}>`,
						})
						.addFields({
							name: "📧 Email",
							value: userEmail,
						})
						.setTimestamp();

					interaction.client.channels.cache
						.get(config.MOD_NOTES_CHANNEL_ID)
						.send({ embeds: [invalidEmailEmbed] })
						.catch((e) => console.log(e));
				}
			} catch (err) {
				console.log(err);
				await interaction.reply({
					content:
						"There was an error verifying your account. Please contact a moderator for help.",
					ephemeral: true,
				});
			}
		} else if (interaction.options.getSubcommand() === "code") {
			try {
				const code = interaction.options.getString("code");

				if (code.length == 6) {
					const verificationRef = interaction.client.db
						.collection("verifications")
						.doc(interaction.user.id);

					const userRef = interaction.client.db
						.collection("users")
						.doc(interaction.user.id);
					// check if userRef exists in database - THIS IS IMPORTANT FOR OLD USERS
					const user = await userRef.get();
					if (!user.exists) {
						// create userRef
						await userRef.set({
							discord_id: interaction.user.id,
							is_profile_disabled: false,
						});
					}
					const verification = await verificationRef.get();

					if (verification.data().code === code) {
						if (interaction.guildId) {
							// find role
							const guildRef = interaction.client.db
								.collection("guilds")
								.doc(interaction.guildId);
							const guild = await guildRef.get();
							const role = interaction.guild.roles.cache.find(
								(role) => role.id === guild.data().verification_role_id
							);
							interaction.member.roles.add(role);
						}
						// set verification status
						await userRef.update({
							discord_id: interaction.user.id,
							email: verification.data().email,
							is_verified: true,
							verified_at: new Date().getTime(),
						});

						await interaction
							.reply({
								content: "✅ Your account has been **verified!**",
								ephemeral: true,
							})
							.catch((e) => console.log(e));
						const verificationEmbed = new EmbedBuilder()
							.setTitle("Verification: Account Verified")
							.setColor("#0099ff")
							.addFields({
								name: "✅ Status",
								value: "Verified",
							})
							.addFields({
								name: "👤 User",
								value: `<@${interaction.user.id}>`,
							})
							.setTimestamp();
						interaction.client.channels.cache
							.get(config.MOD_NOTES_CHANNEL_ID)
							.send({ embeds: [verificationEmbed] })
							.catch((e) => console.log(e));
					} else {
						await interaction
							.reply({
								content: "The verification code you entered is not correct",
								ephemeral: true,
							})
							.catch((e) => console.log(e));
					}
				} else {
					await interaction
						.reply({
							content: "Please enter a valid verification code",
							ephemeral: true,
						})
						.catch((e) => console.log(e));
					return;
				}
			} catch (e) {
				console.log(e);
				await interaction.reply({
					content:
						"There was an error verifying your account. Please contact a moderator for help.",
					ephemeral: true,
				});
			}
		} else {
			await interaction.reply({
				content: "Please enter a valid command.",
				ephemeral: true,
			});
		}
	},
};
