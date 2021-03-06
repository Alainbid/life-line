/**
 * A page with links to all users
 */

lifeLine.nav.register({
	matcher: "/users",

	make({setTitle, content}) {
		setTitle("All users");

		// load the list of users
		fetch("/api/auth/info/users", {
			credentials: "include"
		})

		.then(res => res.json())

		.then(({status, data: users}) => {
			// not authenticated
			if(status == "fail") {
				lifeLine.makeDom({
					parent: content,
					classes: "content-padded",
					text: "You do not have access to the user list"
				});

				return;
			}

			// sort by admin status
			users.sort((a, b) => {
				// sort admins
				if(a.admin && !b.admin) return -1;
				if(!a.admin && b.admin) return 1;

				// sort by username
				if(a.username < b.username) return -1;
				if(a.username > b.username) return 1;

				return 0;
			});

			var displayUsers = {
				Admins: [],
				Users: []
			};

			// generate the user list
			users.forEach(user => {
				// sort the users into admins and users
				displayUsers[user.admin ? "Admins" : "Users"]

				.push({
					href: `/user/${user.username}`,
					items: [{
						text: user.username,
						grow: true
					}]
				});
			});

			// display the user list
			lifeLine.makeDom({
				parent: content,
				widget: "list",
				items: displayUsers
			});
		})

		// something went wrong show an error message
		.catch(err => {
			lifeLine.makeDom({
				classes: "content-padded",
				text: err.message
			});
		});
	}
});
