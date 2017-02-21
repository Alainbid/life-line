var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var pkg = require("../../package.json");
var handler = require("./handler");

// start the server
module.exports = function() {
	// store the version
	lifeLine.version = pkg.version;

	var server;

	return lifeLine.config.get("certs")

	.then(certs => {
		// secure mode
		if(certs) {
			// load the keys
			var keys = {
				key: fs.readFileSync(path.join(certs, "key.pem")),
				cert: fs.readFileSync(path.join(certs, "cert.pem"))
			};

			server = https.createServer(keys, handler);
		}
		// plain old http
		else {
			server = http.createServer(handler);
		}

		return Promise.all([
			lifeLine.config.get("port", 443),
			lifeLine.config.get("localhost", false),
		]);
	})

	.then(([port, localhost]) => {
		// build the params for server.listen()
		var startParams = [port];

		if(localhost) {
			startParams.push("localhost");
		}

		startParams.push(() => console.log("Server started"));

		// start the server
		server.listen.apply(server, startParams);
	});
};
