/**
 * A basic stream implementaion designed to allow easy transformation of
 * streams of values
 */

var createStream = exports.create = function() {
	// create a stream and Source
	var stream = new Stream();
	var source = new Source();

	// link the now
	stream._source = source;
	source._stream = stream;

	return {stream, source};
};

// the source half is used by the producer to send values
class Source extends lifeLine.EventEmitter {
	push(value) {
		if(this._ready && value instanceof Promise) {
			// make sure any previously written promises are send before this one
			var _promise = this._ready = this._ready.then(() => value)
				.then(value => {
					// send the value to the consumer
					this._stream.emit("data", value);

					// if this._ready is resolved remove it
					if(this._ready == _promise) {
						this._ready = undefined;
					}
				});
		}
		else if(value instanceof Promise) {
			this._ready = value
				// send the value to the consumer
				.then(value => this._stream.emit("data", value));
		}
		else {
			// send the value to the consumer
			this._stream.emit("data", value);
		}
	}

	end(value) {
		// if a final value was given send it to the consumer
		if(value) this.push(value);

		var end = () => {
			// tell the consumer the stream is done
			this._stream.emit("end");

			// remove the streams refrence to us
			this._stream.source = undefined;
			// remove all event listeners from the stream
			this._stream._listeners = {};
			// remove our refrence to the stream
			this._stream = undefined;
			// remove all event listeners
			this._listeners = {};
		};

		// wait for any clean up work
		if(this._ready) {
			this._ready.then(end);
		}
		else {
			end();
		}
	}
}

// the stream half is used by consumers to observe and mutate the values
class Stream extends lifeLine.EventEmitter {
	constructor() {
		super();

		// track the number of consumers listening
		this._refrences = 0;
	}

	// buffer values send to this stream
	enableBuffering() {
		// already buffering
		if(this._buffer) return;

		this._buffer = [];

		// add values to the buffer if there are no listeners
		this._bufferSub = super.on("data", data => {
			if(this._refrences === 0) {
				this._buffer.push(data);
			}
		});
	}

	// stop buffering values send to this stream
	disableBuffering() {
		this._buffer = undefined;

		// stop trying to add values to the buffer
		if(this._bufferSub) {
			this._bufferSub.unsubscribe();

			this._bufferSub = undefined;
		}
	}

	on(name, fn) {
		// add the event listener
		var subscription = super.on(name, fn);

		// if the event isn't data don't do anything special
		if(name != "data") return subscription;

		// up the refrence count now that we have a listener
		++this._refrences;

		// since we now have listeners tell the source to start sending data
		if(this._refrences == 1) {
			this._source.emit("resume");

			// send any buffered values
			if(this._buffer) {
				while(this._buffer.length > 0) {
					// send the values but skip the buffer's lisenter
					this.partialEmit("data", [this._bufferSub], this._buffer.shift());
				}
			}
		}

		var unsubscribed = false;

		return {
			unsubscribe: () => {
				// don't unsubscribe twice
				if(unsubscribed) return;

				unsubscribed = true;

				// lower the refrence count now that we don't have a listener
				--this._refrences;

				// tell the source to stop sending data now that we have no listeners
				if(this._refrences === 0) {
					this._source.emit("pause");
				}

				// remove the underlying listener
				subscription.unsubscribe();
			}
		};
	}

	/**
	 * Pass a call back which is given the source to the new stream and a value
	 * from this stream
	 */
	pipe(transformer) {
		var {source, stream} = createStream();
		var subscription;

		// when the transformed stream has listeners listen to the source stream
		source.on("resume", () => {
			subscription = this.on("data", value => transformer(value, source));
		});

		// when the transformed stream has no listeners stop listening to the source stream
		source.on("pause", () => {
			subscription.unsubscribe();
		});

		return stream;
	}

	/**
	 * Transform individual values in a stream
	 */
	map(transformer) {
		return this.pipe((value, source) => {
			// run all the values through the transformer
			source.push(transformer(value));
		});
	}

	/**
	 * Filter out individual values in a stream
	 */
	filter(filter) {
		return this.pipe((value, source) => {
			// check all values with the filter
			if(filter(value)) {
				source.push(value);
			}
		});
	}
}

// create a stream from an array
exports.from = function(array) {
	var {stream, source} = createStream();

	source.on("resume", () => {
		// send the array through the stream
		var send = array => {
			// push the values through the stream
			array.forEach(value => source.push(value));

			// end the stream
			source.end();
		};

		// resolve the promise first
		if(array instanceof Promise) {
			array.then(arr => send(arr));
		}
		// use the plain array
		else {
			send(array);
		}
	});

	return stream;
};

// combine the values of two or more streams the values
exports.concat = function(streams) {
	var {stream, source} = createStream();
	var index = -1;

	// save subscriptions for the pause/resume events
	var pauseSub, resumeSub;

	// start sending a stream
	var sendStream = () => {
		// remove any existing subscriptions
		if(pauseSub) pauseSub.unsubscribe();
		if(resumeSub) resumeSub.unsubscribe();

		// the last stream has been passed on
		if(++index >= streams.length) {
			// end the combined stream
			source.end();

			return;
		}

		var dataSub;
		var stream = streams[index];

		// pass the values on to the combined stream
		var resume = () => dataSub = stream.on("data", data => source.push(data));

		// when this stream is done move on to the next one
		stream.on("end", () => sendStream());

		// pause and resume with the combined stream
		pauseSub = source.on("pause", () => dataSub.unsubscribe());
		resumeSub = source.on("resume", resume);

		// start the stream
		resume();
	};

	// start the stream when our source starts
	resumeSub = source.on("resume", () => sendStream());

	return stream;
};

/**
 * Combine several stream THE ORDER OF THE VALUES IS NOT PRESERVED
 */
exports.merge = function(streams) {
	var {stream, source} = createStream();
	// save the subscriptions from the data method to pause the streams
	var streamSubs = [];

	// start all the streams
	source.on("resume", () => {
		streamSubs = streams.map(stream => {
			// pass data on from the streams
			return stream.on("data", data => source.push(data))
		});
	});

	// stop all streams
	source.on("pause", () => {
		while(streamSubs.length > 0) {
			streamSubs.shift().unsubscribe();
		}
	});

	// when a stream ends remove it from the list
	for(let stream of streams) {
		stream.on("end", () => {
			// find the stream
			var index = streams.indexOf(stream);

			// remove the stream and its subscription
			streams.splice(index, 1);
			streamSubs.splice(index, 1);

			// when the last stream closes close the aggregate
			if(streams.length === 0) {
				source.end();
			}
		});
	}

	return stream;
};
