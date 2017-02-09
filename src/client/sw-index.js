// create the global object
import "../common/global";
import "./global";

import {store} from "./data-store";

var syncStore = store("sync-store");

// all the files to cache
const CACHED_FILES = [
	"/",
	"/static/bundle.js",
	"/static/style.css",
	"/static/icon-144.png"
];

const STATIC_CACHE = "static";

// cache the version of the client
var clientVersion;

// download a new version
var download = function() {
	console.log("Download new version");

	// save the new version
	var version;

	// open the cache
	return caches.open(STATIC_CACHE)

	.then(cache => {
		// download all the files
		return Promise.all(
			CACHED_FILES.map(url => {
				console.log("Fetch file:", url);
				// download the file
				return fetch(url)

				.then(res => {
					// save the file
					var promises = [
						cache.put(new Request(url), res)
					];

					// save the version
					if(!version) {
						version = clientVersion = res.headers.get("server");

						promises.push(
							syncStore.set({
								id: "version",
								value: version
							})
						);
					}

					return promises.length == 1 ? promises[0] : Promise.all(promises);
				});
			})
		)

		.then(() => console.log("Update complete"));
	});
};

// check for updates
var checkForUpdates = function(newVersion) {
	console.log("Check for updates");

	// if we have a version use that
	if(newVersion) {
		newVersion = Promise.resolve(newVersion);
	}
	// fetch the version
	else {
		newVersion = fetch("/")

		.then(res => res.headers.get("server"));
	}

	var oldVersion;

	// already in memory
	if(clientVersion) {
		oldVersion = Promise.resolve(clientVersion);
	}
	else {
		oldVersion = syncStore.get("version").then((value = {}) => value.value)
	}

	return Promise.all([
		newVersion,
		oldVersion
	])

	.then(([newVersion, oldVersion]) => {
		// same version do nothing
		if(newVersion == oldVersion) {
			console.log("Up to date");

			return syncStore.set({
				id: "version",
				value: oldVersion
			});
		}

		// download the new version
		return download();
	});
};

// when we are installed check for updates
self.addEventListener("install", e => e.waitUntil(checkForUpdates()));

// handle a network Request
self.addEventListener("fetch", e => {
	// get the page url
	var url = new URL(e.request.url).pathname;

	// just go to the server for api calls
	if(url.substr(0, 5) == "/api/") {
		console.log("Api call");

		e.respondWith(
			fetch(e.request, {
				credentials: "include"
			})

			// network error
			.catch(err => {
				console.log("Network error");

				// send an error response
				return new Response(JSON.stringify({
					status: "fail",
					data: {
						reason: "networ-error"
					}
				}), {
					headers: {
						"content-type": "application/json"
					}
				});
			})

			.then(res => {
				// check for updates
				checkForUpdates(res.headers.get("server"));

				return res;
			})
		);
	}
	// respond from the cache
	else {
		console.log("Static file");
		e.respondWith(
			caches.match(e.request)

			.then(res => {
				// if there was no match send the index page
				if(!res) {
					console.log("Use index");
					return caches.match(new Request("/"));
				}

				return res;
			})
		);
	}
});
