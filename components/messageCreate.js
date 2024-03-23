/* 
FOR DREXEL DISCORD ONLY
- This feature is badly coded
- It checks if your introduction is longer than "hi or hello"
- This could use a re-work
*/
async function messageCreate(message) {
	try {
		if (message.guild.id === "323942271550750720") {
			// Check if "Guild" is Drexel Discord
			if (message.channel.id === "575488601165529088") {
				// Check if Message is in "Introductions Channel"
				if (message.content.length < 7) {
					message.delete();
					message.author
						.createDM()
						.then((dm) => {
							dm.send("Please give a more detailed introduction.");
						})
						.catch((e) => console.log(e));
				} else {
					message.member.roles.add("763893629374300190"); // Add "Introduced" role
				}
			}
		}
	} catch (error) {
		console.error(error);
	}
}

module.exports = messageCreate;