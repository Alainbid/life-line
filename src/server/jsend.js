/**
 * JSend for the server side
 */

// shortcuts for the jsend methods
exports.success = data => exports.jsend("success", data);
exports.fail = msg => exports.jsend("fail", msg);
exports.error = err => exports.jsend("error", err instanceof Error ? err.message : err);

// create a jsend response
exports.jsend = function(status, data) {
	// build the jsend message
	var msg = {
		status: status,
		data: data
	};

	// stringify the json
	if(lifeLine.devMode) {
		// format it in dev mode
		msg = JSON.stringify(msg, null, 4);
	}
	else {
		msg = JSON.stringify(msg);
	}

	// make the response
	return new lifeLine.Response({
		extension: ".json",
		body: msg
	});
};
