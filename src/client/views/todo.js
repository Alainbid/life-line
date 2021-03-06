/**
 * A list of things todo
 */

var {daysFromNow, isSameDate, stringifyTime} = require("../util/date");
var {assignments} = require("../data-stores");

lifeLine.nav.register({
	matcher: "/",

	make({setTitle, content, disposable}) {
		setTitle("Todo");

		// load the items
		disposable.add(
			assignments.query({
				done: false,
				// make sure the assignment is in the future
				date: date => !date || new Date(date).getTime() > Date.now()
			}, function(data) {
				// clear the old content
				content.innerHTML = "";

				var groups = {
					Tasks: [],
					Today: [],
					Tomorrow: [],
					Upcomming: []
				};

				// today and tomorrows dates
				var today = new Date();
				var tomorrow = daysFromNow(1);

				// sort by date
				data.sort((a, b) => {
					if(a.type == "assignment" && b.type == "assignment") {
						return a.date.getTime() - b.date.getTime();
					}
				});

				// select the items to display
				data.forEach(item => {
					// assignments for today
					if(item.type == "assignment") {
						// today
						if(isSameDate(today, item.date)) {
							groups.Today.push(createUi(item));
						}
						// tomorrow
						else if(isSameDate(tomorrow, item.date)) {
							groups.Tomorrow.push(createUi(item));
						}
						// add upcomming items
						else if(groups.Upcomming.length < 5) {
							groups.Upcomming.push(createUi(item));
						}
					}

					// show any tasks
					if(item.type == "task") {
						groups.Tasks.push(createUi(item));
					}
				});

				// remove any empty fields
				Object.getOwnPropertyNames(groups)

				.forEach(name => {
					// remove empty groups
					if(groups[name].length === 0) {
						delete groups[name];
					}
				});

				// render the list
				lifeLine.makeDom({
					parent: content,
					widget: "list",
					items: groups
				});
			})
		);
	}
});

// create a list item
var createUi = function(item) {
	// render a task
	if(item.type == "task") {
		return {
			href: `/item/${item.id}`,
			items: [
				{
					text: item.name,
					grow: true
				}
			]
		};
	}
	// render an item
	else {
		return {
			href: `/item/${item.id}`,
			items: [
				{
					text: item.name,
					grow: true
				},
				stringifyTime(item.date),
				item.class
			]
		};
	}
};
