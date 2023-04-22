const { EmbedBuilder } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const axios = require("axios");
const isCourseValid = require("../utils/validator");

// Create a dictionary of college names and their abbreviations
const collegeDict = {
	A: "Antoinette Westphal College of Media Arts & Design",
	AS: "College of Arts and Sciences",
	B: "LeBow College of Business",
	CI: "College of Computing and Informatics",
	CV: "Center for Civic Engagement",
	E: "College of Engineering",
	PH: "Dornsife School of Public Health",
	GC: "Goodwin College of Professional Studies",
	X: "Miscellaneous",
	NH: "Nursing and Health Professions",
	PE: "Pennoni Honors College",
	R: "School of Biomedical Engineering, Science and Health Systems",
	T: "School of Education",
	L: "Thomas R. Kline School of Law",
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName("tms")
		.setDescription("Search for courses details and more!")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("course")
				.setDescription("Search for a course")
				.addStringOption((option) =>
					option
						.setName("course")
						.setDescription("The course code (Ex: ENGL101")
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("courses")
				.setDescription("Search courses by instructor, type, method, or day")
				.addStringOption((option) =>
					option
						.setName("term")
						.setDescription("The term (Ex: 202235)")
						.setRequired(true)
				)
				.addStringOption((option) =>
					option.setName("instructor").setDescription("The instructor's name")
				)
				.addStringOption((option) =>
					option
						.setName("type")
						.setDescription("The course type (Ex: Lecture, Lab, Seminar)")
						.addChoices({
							name: "Lecture",
							value: "Lecture",
							name: "Lab",
							value: "Lab",
							name: "Lecture/Lab",
							value: "Lecture & Lab",
						})
				)
				.addStringOption((option) =>
					option
						.setName("method")
						.setDescription("The course method (Ex: Online, F2F, Hybrid)")
						.addChoices({
							name: "F2F",
							value: "Face to Face",
							name: "Online",
							value: "Online",
							name: "Hybrid",
							value: "Hybrid",
						})
				)
				.addStringOption((option) =>
					option
						.setName("day")
						.setDescription("The course day (Ex: M, T, W, TR, F)")
						.addChoices({
							name: "Monday",
							value: "M",
							name: "Tuesday",
							value: "T",
							name: "Wednesday",
							value: "W",
							name: "Thursday",
							value: "TR",
							name: "Friday",
							value: "F",
						})
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("prereq")
				.setDescription("Search for a course's prerequisites")
				.addStringOption((option) =>
					option
						.setName("course")
						.setDescription("The course code (Ex: ENGL101")
						.setRequired(true)
				)
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("postreq")
				.setDescription("Search for a course's postrequisites")
				.addStringOption((option) =>
					option
						.setName("course")
						.setDescription("The course code (Ex: ENGL101")
						.setRequired(true)
				)
				.addStringOption((option) =>
					option.setName("subject").setDescription("The subject (Ex: ENGL)")
				)
		),
	async execute(interaction) {
		try {
			const subcommand = interaction.options.getSubcommand();
			if (subcommand === "course") {
				// Search for a course
				const course = interaction.options.getString("course");
				courseFormatted = isCourseValid(course);

				const courseDetails = await axios.get(
					`https://dtms.shahriyarshawon.xyz/class/${courseFormatted}`
				);
				const courseDetailsJSON = courseDetails.data;

				if (courseDetailsJSON.status_code === 404) {
					await interaction.reply({
						content: "Course not found.",
						ephemeral: true,
					});
				} else {
					const courseEmbed = new EmbedBuilder()
						.setColor("#0099ff")
						.setTitle("Course Details")
						.addFields(
							{
								name: "Course",
								value: courseDetailsJSON.name
									? courseDetailsJSON.name
									: "No Course Name",
							},
							{
								name: "Course ID",
								value: courseDetailsJSON.number
									? courseDetailsJSON.number
									: "No Course ID",
							},
							{
								name: "College",
								value: courseDetailsJSON.college
									? collegeDict[courseDetailsJSON.college]
										? collegeDict[courseDetailsJSON.college]
										: courseDetailsJSON.college
									: "No College",
							},
							{
								name: "Credits",
								value: courseDetailsJSON.low_credits
									? `${courseDetailsJSON.low_credits}`
									: "No Credits",
							},
							{
								name: "Description",
								value: courseDetailsJSON.desc
									? courseDetailsJSON.desc
									: "No Description",
							},
							{
								name: "Prerequisites",
								value: courseDetailsJSON.prereqs
									? courseDetailsJSON.prereqs
									: "No Pre-Requisites",
							},
							{
								name: "Writing Intensive",
								value: courseDetailsJSON.writing_intensive ? "Yes" : "No",
							}
						)
						.setTimestamp();
					interaction.reply({ embeds: [courseEmbed] });
				}
			} else if (subcommand === "courses") {
				interaction.reply({
					content:
						"This command is currently under development. Please use /suggest to suggest how this command should work.",
					ephemeral: true,
				});
			} else if (subcommand === "prereq") {
				const course = interaction.options.getString("course");
				courseFormatted = isCourseValid(course);

				const courseDetails = await axios.get(
					`https://dtms.shahriyarshawon.xyz/prereqs/${courseFormatted}`
				);
				const courseDetailsJSON = courseDetails.data;

				const fields = [];
				for (
					let i = 0;
					i < (courseDetailsJSON.length < 25 ? courseDetailsJSON.length : 25);
					i++
				) {
					fields.push({
						name: `Path ${i + 1}`,
						value: courseDetailsJSON[i],
					});
				}

				if (courseDetailsJSON.status_code === 404) {
					await interaction.reply({
						content: "Course not found.",
						ephemeral: true,
					});
				} else {
					const courseEmbed = new EmbedBuilder()
						.setColor("#0099ff")
						.setTitle(`Prerequisite Paths for ${courseFormatted}`)
						.addFields(fields)
						.setTimestamp();
					interaction.reply({ embeds: [courseEmbed] });
				}
			} else if (subcommand === "postreq") {
				const course = interaction.options.getString("course");
				const subject = interaction.options.getString("subject");
				courseFormatted = isCourseValid(course);

				// only add subject if it exists
				const courseDetails = await axios.get(
					`https://dtms.shahriyarshawon.xyz/postreqs/${courseFormatted}${
						subject ? `?subject_filter=${subject}` : ""
					}`
				);

				const courseDetailsJSON = courseDetails.data;

				const fields = [];
				// for loop where if length is greater than 25, only show 25
				const length =
					courseDetailsJSON.length < 25 ? courseDetailsJSON.length : 25;
				for (let i = 0; i < length; i++) {
					fields.push({
						name: `${courseDetailsJSON[i].number} | ${courseDetailsJSON[i].name}`,
						value: `${courseDetailsJSON[i].low_credits} credits | WI: ${
							courseDetailsJSON[i].writing_intensive ? "Yes" : "No"
						}`,
					});
				}

				if (courseDetailsJSON.status_code === 404) {
					await interaction.reply({
						content: "Course not found.",
						ephemeral: true,
					});
				} else {
					const courseEmbed = new EmbedBuilder()
						.setColor("#0099ff")
						.setTitle(`Post-Requisites for ${courseFormatted}`)
						.addFields(fields)
						.setTimestamp();
					interaction.reply({ embeds: [courseEmbed] });
				}
			} else {
				await interaction.reply({
					content:
						"Please enter a valid subcommand. Use /help for more information.",
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

/* 
		.addSubcommand((subcommand) =>
			subcommand
				.setName("wi")
				.setDescription("Search for Writing Intensive courses")
				.addStringOption((option) =>
					option
						.setName("term")
						.setDescription("The term (Ex: 202235)")
						.setRequired(true)
				)
				.addStringOption((option) =>
					option
						.setName("subject")
						.setDescription("The subject (Ex: ENGL)")
						.setRequired(true)
				)
				.addStringOption((option) =>
					option.setName("instructor").setDescription("The instructor's name")
				)
				.addStringOption((option) =>
					option
						.setName("format")
						.setDescription("The course format (Ex: Online, F2F, Hybrid)")
						.addChoices({
							name: "Online",
							value: "Online",
							name: "F2F",
							value: "Face to Face",
							name: "Hybrid",
							value: "Hybrid",
						})
				)
		),

				// const term = interaction.options.getString("term");
				// const instructor = interaction.options.getString("instructor");
				// const type = interaction.options.getString("type");
				// const method = interaction.options.getString("method");
				// const day = interaction.options.getString("day");

				// const instructorDetails = await axios.get(
				//     `https://dtms.shahriyarshawon.xyz/classes/term/?term=${term}&instructor=${instructor}&`
				// );
				// const instructorDetailsJSON = instructorDetails.data;

				// if (instructorDetailsJSON.status_code === 404 || instructorDetailsJSON.length === 0) {
				//     interaction.reply('Instructor or term not found.', { ephemeral: true });
				// } else {
				//     const fields = [];

				//     for (let i = 0; i < instructorDetailsJSON.length < 25 ? instructorDetailsJSON.length : 25; i++) {
				//         fields.push(
				//             {
				//                 name: `${instructorDetailsJSON[i].course_number} | ${instructorDetailsJSON[i].instruction_type} | CRN: ${instructorDetailsJSON[i].crn}`,
				//                 value: `${instructorDetailsJSON[i].section} | ${instructorDetailsJSON[i].instruction_method} | ${instructorDetailsJSON[i].days_time}`
				//             }
				//         )
				//     }

				//     const instructorEmbed = new EmbedBuilder()
				//         .setColor("#0099ff")
				//         .setTitle("Courses Taught by Instructor")
				//         .setDescription(`Term: ${term} | Instructor: ${instructor}`)
				//         .addFields(fields)
				//         .setTimestamp();

				//     interaction.reply({ embeds: [instructorEmbed] });

*/
