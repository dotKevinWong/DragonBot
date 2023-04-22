const nanoid = require('nanoid');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("login")
        .setDescription("Login to the bot"),
    async execute(interaction) {
        // Check if user is verified in database
        const userRef = interaction.client.db.collection("users").doc(interaction.user.id);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        if (userDoc.exists && userData.is_verified === true) {
            // User is verified, create token and send link to user to login
            const token = nanoid(64);
            const state = interaction.commandId;
            // const loginRef = interaction.client.db.collection("logins").doc(interaction.user.id);
            // await loginRef.set({
            //     token: token,
            //     user_id: interaction.user.id,
            //     created_at: new Date(),
            // });
            const cancelLogin = new ButtonBuilder()
                .setCustomId('cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);
            const loginUser = new ButtonBuilder()
                .setLabel('Login')
                .setURL(`https://app.drexeldiscord.com/oauth?token=${token}&state=${state}`)
                .setStyle(ButtonStyle.Link);
            const loginRow = new ActionRowBuilder()
                .addComponents([cancelLogin,loginUser]);
            const loginEmbed = new EmbedBuilder()
                .setTitle("🔒 Login")
                .setColor("ED4245")
                .setDescription(`Click the button below to login to the web app!`)
                .setTimestamp()

            interaction.reply({ embeds: [loginEmbed], components: [loginRow], ephemeral: true });

        } else {
            // User is not verified
            const loginEmbed = new EmbedBuilder()
                .setTitle("🔒 Login")
                .setColor("ED4245")
                .setDescription("You are not verified! Please verify yourself by using the `/verify` command.")
                .setTimestamp()
            interaction.reply({ embeds: [loginEmbed], ephemeral: true });
        }
    },
};
