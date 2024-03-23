// Format the time in example: Tuesday, March 19, 2024 at 12:21 PM
function timeFormatter(date) {
    const newDate = new Date(date);
	const options = {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		hour12: true,
	};
	return newDate.toLocaleDateString("en-US", options);
}
module.exports = timeFormatter;
