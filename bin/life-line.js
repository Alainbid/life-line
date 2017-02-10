#!/usr/bin/env node

/**
 * Create a backup or start the server
 */

var path = require("path");
var fs = require("fs");
var nopt = require("nopt");
var startServer = require("../src/server/server");
var backup = require("../src/server/backup");
var {genBackupName} = require("../src/common/backup");
var {setDataDir} = require("../src/server/data-store");

// parse the command line arguments
var parsed = nopt({
	backup: String,
	port: Number,
	localhost: Boolean,
	dev: Boolean,
	certs: String,
	"data-dir": String
});

// configure the data stores
setDataDir(parsed["data-dir"] || path.join(process.cwd(), "life-line-data"));

// run a backup
if(parsed.backup) {
	var backupPath = path.join(parsed.backup, genBackupName());

	// build and save the backup
	backup()
		.pipe(fs.createWriteStream(backupPath));
}
// start the server
else {
	startServer({
		devMode: parsed.dev,
		localhost: parsed.localhost,
		port: parsed.port || 443,
		certs: parsed.certs
	});
}
