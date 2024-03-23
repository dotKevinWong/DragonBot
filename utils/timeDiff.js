function timeDiff(date) {
	const now = new Date();
	const diffInMilliseconds = now - date;
	const diffInSeconds = Math.floor(diffInMilliseconds / 1000);
	const diffInMinutes = Math.floor(diffInSeconds / 60);
	const diffInHours = Math.floor(diffInMinutes / 60);
	const diffInDays = Math.floor(diffInHours / 24);
	const diffInMonths = Math.floor(diffInDays / 30);
	const diffInYears = Math.floor(diffInMonths / 12);

	if (diffInYears > 0) {
		return `${diffInYears} years ago`;
	} else if (diffInMonths > 0) {
		return `${diffInMonths} months ago`;
	} else if (diffInDays > 0) {
		return `${diffInDays} days ago`;
	} else if (diffInHours > 0) {
		return `${diffInHours} hours ago`;
	} else if (diffInMinutes > 0) {
		return `${diffInMinutes} minutes ago`;
	} else {
		return `${diffInSeconds} seconds ago`;
	}
}

module.exports = timeDiff;
