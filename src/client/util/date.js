/**
* Date related tools
*/

// check if the dates are the same day
exports.isSameDate = function(date1, date2) {
	return date1.getFullYear() == date2.getFullYear() &&
		date1.getMonth() == date2.getMonth() &&
		date1.getDate() == date2.getDate();
};

// check if a date is less than another
exports.isSoonerDate = function(date1, date2) {
    // check the year first
    if(date1.getFullYear() != date2.getFullYear()) {
        return date1.getFullYear() < date2.getFullYear();
    }

    // check the month next
    if(date1.getMonth() != date2.getMonth()) {
        return date1.getMonth() < date2.getMonth();
    }

    // check the day
    return date1.getDate() < date2.getDate();
};

// get the date days from now
exports.daysFromNow = function(days) {
	var date = new Date();

	// advance the date
	date.setDate(date.getDate() + days);

	return date;
};

const STRING_DAYS = ["Sunday", "Monday", "Tuesday", "Wedensday", "Thursday", "Friday", "Saturday"];

// convert a date to a string
exports.stringifyDate = function(date, opts = {}) {
	 var strDate, strTime = "";

    // check if the date is before today
    var beforeNow = date.getTime() < Date.now();

	// Today
	if(exports.isSameDate(date, new Date()))
		strDate = "Today";

	// Tomorrow
	else if(exports.isSameDate(date, exports.daysFromNow(1)) && !beforeNow)
		strDate = "Tomorrow";

	// day of the week (this week)
	else if(exports.isSoonerDate(date, exports.daysFromNow(7)) && !beforeNow)
		strDate = STRING_DAYS[date.getDay()];

	// print the date
	else
	 	strDate = `${STRING_DAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`;

	// add the time on
	if(opts.includeTime && !exports.isSkipTime(date, opts.skipTimes)) {
		return strDate + ", " + exports.stringifyTime(date);
	}

	return strDate;
};

// check if this is one of the given skip times
exports.isSkipTime = function(date, skips = []) {
	return skips.find(skip => {
		return skip.hour === date.getHours() && skip.minute === date.getMinutes();
	});
};

// convert a time to a string
exports.stringifyTime = function(date) {
	var hour = date.getHours();

	// get the am/pm time
	var isAm = hour < 12;

	// midnight
	if(hour === 0) hour = 12;
	// after noon
	if(hour > 12) hour = hour - 12;

	var minute = date.getMinutes();

	// add a leading 0
	if(minute < 10) minute = "0" + minute;

	return hour + ":" + minute + (isAm ? "am" : "pm");
}
