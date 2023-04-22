const isCourseValid = (course) => {
    const match = course.match(/^[A-Z]{2,4}\d{2,3}$/);

    if (match) {
        // split the course code into subject and course number with a space in between
        const courseCode = course.split(/(\d+)/);
        const subject = courseCode[0];
        const courseNumber = courseCode[1];
        const courseFormatted = `${subject} ${courseNumber}`;
        return courseFormatted;
    } else {
        return course;
    }
}

module.exports = isCourseValid;