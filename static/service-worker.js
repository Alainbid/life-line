(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

(function() {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };

      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function(resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function(value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function(prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function() {
          return this[targetProp][prop];
        },
        set: function(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', [
    'name',
    'keyPath',
    'multiEntry',
    'unique'
  ]);

  proxyRequestMethods(Index, '_index', IDBIndex, [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, [
    'openCursor',
    'openKeyCursor'
  ]);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', [
    'direction',
    'key',
    'primaryKey',
    'value'
  ]);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
    'update',
    'delete'
  ]);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function() {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function() {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function(value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function() {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function() {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', [
    'name',
    'keyPath',
    'indexNames',
    'autoIncrement'
  ]);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'put',
    'add',
    'delete',
    'clear',
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'openCursor',
    'openKeyCursor'
  ]);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, [
    'deleteIndex'
  ]);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function(resolve, reject) {
      idbTransaction.oncomplete = function() {
        resolve();
      };
      idbTransaction.onerror = function() {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function() {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function() {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', [
    'objectStoreNames',
    'mode'
  ]);

  proxyMethods(Transaction, '_tx', IDBTransaction, [
    'abort'
  ]);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function() {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, [
    'deleteObjectStore',
    'close'
  ]);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function() {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(DB, '_db', IDBDatabase, [
    'close'
  ]);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
    [ObjectStore, Index].forEach(function(Constructor) {
      Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function() {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function(Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function(query, count) {
      var instance = this;
      var items = [];

      return new Promise(function(resolve) {
        instance.iterateCursor(query, function(cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      request.onupgradeneeded = function(event) {
        if (upgradeCallback) {
          upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
        }
      };

      return p.then(function(db) {
        return new DB(db);
      });
    },
    delete: function(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
  }
  else {
    self.idb = exp;
  }
}());

},{}],2:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],3:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * An indexed db adaptor
 */

var idb = require("idb");

var VALID_STORES = ["assignments", "sync-store"];

// open/setup the database
var dbPromise = idb.open("data-stores", 3, function (db) {
	// upgrade or create the db
	if (db.oldVersion < 1) db.createObjectStore("assignments", { keyPath: "id" });
	if (db.oldVersion < 2) db.createObjectStore("sync-store", { keyPath: "id" });

	// the version 2 sync-store had a different structure that the version 3
	if (db.oldVersion == 2) {
		db.deleteObjectStore("sync-store");
		db.createObjectStore("sync-store", { keyPath: "id" });
	}
});

var IdbAdaptor = function () {
	function IdbAdaptor(name) {
		_classCallCheck(this, IdbAdaptor);

		this.name = name;

		// check the store is valid
		if (VALID_STORES.indexOf(name) === -1) {
			throw new Error("The data store " + name + " is not in idb update the db");
		}
	}

	// create a transaction


	_createClass(IdbAdaptor, [{
		key: "_transaction",
		value: function _transaction(readWrite) {
			var _this = this;

			return dbPromise.then(function (db) {
				return db.transaction(_this.name, readWrite && "readwrite").objectStore(_this.name);
			});
		}

		/**
   * Get all the values in the object store
   */

	}, {
		key: "getAll",
		value: function getAll() {
			return this._transaction().then(function (trans) {
				return trans.getAll();
			});
		}

		/**
   * Get a specific value
   */

	}, {
		key: "get",
		value: function get(key) {
			return this._transaction().then(function (trans) {
				return trans.get(key);
			});
		}

		/**
   * Store a value in idb
   */

	}, {
		key: "set",
		value: function set(value) {
			return this._transaction(true).then(function (trans) {
				return trans.put(value);
			});
		}

		/**
   * Remove a value from idb
   */

	}, {
		key: "remove",
		value: function remove(key) {
			return this._transaction(true).then(function (trans) {
				return trans.delete(key);
			});
		}
	}]);

	return IdbAdaptor;
}();

module.exports = IdbAdaptor;

},{"idb":1}],4:[function(require,module,exports){
"use strict";

/**
 * Browser specific globals
 */

lifeLine.makeDom = require("./util/dom-maker");

// add a function for adding actions
lifeLine.addAction = function (name, fn) {
	// attach the callback
	var listener = lifeLine.on("action-exec-" + name, fn);

	// inform any action providers
	lifeLine.emit("action-create", name);

	// all actions removed
	var removeAll = lifeLine.on("action-remove-all", function () {
		// remove the action listener
		listener.unsubscribe();
		removeAll.unsubscribe();
	});

	return {
		unsubscribe: function () {
			// remove the action listener
			listener.unsubscribe();
			removeAll.unsubscribe();

			// inform any action providers
			lifeLine.emit("action-remove", name);
		}
	};
};

},{"./util/dom-maker":6}],5:[function(require,module,exports){
"use strict";

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

// create the global object
require("../common/global");
require("./global");

var KeyValueStore = require("../common/data-stores/key-value-store");
var IdbAdaptor = require("./data-stores/idb-adaptor");

var syncStore = new KeyValueStore(new IdbAdaptor("sync-store"));

// all the files to cache
var CACHED_FILES = ["/", "/static/bundle.js", "/static/style.css", "/static/icon-144.png", "/static/manifest.json"];

var STATIC_CACHE = "static";

// cache the version of the client
var clientVersion;

// download a new version
var download = function () {
	// save the new version
	var version;

	// open the cache
	return caches.open(STATIC_CACHE).then(function (cache) {
		// download all the files
		return Promise.all(CACHED_FILES.map(function (url) {
			// download the file
			return fetch(url).then(function (res) {
				// save the file
				var promises = [cache.put(new Request(url), res)];

				// save the version
				if (!version) {
					version = clientVersion = res.headers.get("server");

					promises.push(syncStore.set("version", version));
				}

				return promises.length == 1 ? promises[0] : Promise.all(promises);
			});
		}))

		// notify the client(s) of the update
		.then(function () {
			return notifyClients(version);
		});
	});
};

// notify the client(s) of an update
var notifyClients = function (version) {
	// get all the clients
	return clients.matchAll({}).then(function (clients) {
		var _iteratorNormalCompletion = true;
		var _didIteratorError = false;
		var _iteratorError = undefined;

		try {
			for (var _iterator = clients[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
				var client = _step.value;

				// send the version
				client.postMessage({
					type: "version-change",
					version: version
				});
			}
		} catch (err) {
			_didIteratorError = true;
			_iteratorError = err;
		} finally {
			try {
				if (!_iteratorNormalCompletion && _iterator.return) {
					_iterator.return();
				}
			} finally {
				if (_didIteratorError) {
					throw _iteratorError;
				}
			}
		}
	});
};

// check for updates
var checkForUpdates = function (newVersion) {
	// if we have a version use that
	if (newVersion) {
		newVersion = Promise.resolve(newVersion);
	}
	// fetch the version
	else {
			newVersion = fetch("/").then(function (res) {
				return res.headers.get("server");
			});
		}

	var oldVersion;

	// already in memory
	if (clientVersion) {
		oldVersion = Promise.resolve(clientVersion);
	} else {
		oldVersion = syncStore.get("version");
	}

	return Promise.all([newVersion, oldVersion]).then(function (_ref) {
		var _ref2 = _slicedToArray(_ref, 2),
		    newVersion = _ref2[0],
		    oldVersion = _ref2[1];

		// same version do nothing
		if (newVersion == oldVersion) {
			return syncStore.set("version", oldVersion);
		}

		// download the new version
		return download();
	});
};

// when we are installed check for updates
self.addEventListener("install", function (e) {
	return e.waitUntil(checkForUpdates());
});

// handle a network Request
self.addEventListener("fetch", function (e) {
	// get the page url
	var url = new URL(e.request.url).pathname;

	// just go to the server for api calls
	if (url.substr(0, 5) == "/api/") {
		e.respondWith(fetch(e.request, {
			credentials: "include"
		})

		// network error
		.catch(function (err) {
			// send an error response
			return new Response(JSON.stringify({
				status: "fail",
				data: {
					reason: "network-error"
				}
			}), {
				headers: {
					"content-type": "application/json"
				}
			});
		}).then(function (res) {
			// check for updates
			checkForUpdates(res.headers.get("server"));

			return res;
		}));
	}
	// respond from the cache
	else {
			e.respondWith(caches.match(e.request).then(function (res) {
				// if there was no match send the index page
				if (!res) {
					return caches.match(new Request("/"));
				}

				return res;
			}));
		}
});

},{"../common/data-stores/key-value-store":7,"../common/global":9,"./data-stores/idb-adaptor":3,"./global":4}],6:[function(require,module,exports){
"use strict";

/**
 * A helper for building dom nodes
 */

var SVG_ELEMENTS = ["svg", "line"];
var SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// build a single dom node
var makeDom = function () {
	var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

	// get or create the name mapping
	var mapped = opts.mapped || {};

	var $el;

	// the element is part of the svg namespace
	if (SVG_ELEMENTS.indexOf(opts.tag) !== -1) {
		$el = document.createElementNS(SVG_NAMESPACE, opts.tag);
	}
	// a plain element
	else {
			$el = document.createElement(opts.tag || "div");
		}

	// set the classes
	if (opts.classes) {
		$el.setAttribute("class", typeof opts.classes == "string" ? opts.classes : opts.classes.join(" "));
	}

	// attach the attributes
	if (opts.attrs) {
		Object.getOwnPropertyNames(opts.attrs).forEach(function (attr) {
			return $el.setAttribute(attr, opts.attrs[attr]);
		});
	}

	// set the text content
	if (opts.text) {
		$el.innerText = opts.text;
	}

	// attach the node to its parent
	if (opts.parent) {
		opts.parent.insertBefore($el, opts.before);
	}

	// add event listeners
	if (opts.on) {
		var _loop = function (name) {
			$el.addEventListener(name, opts.on[name]);

			// attach the dom to a disposable
			if (opts.disp) {
				opts.disp.add({
					unsubscribe: function () {
						return $el.removeEventListener(name, opts.on[name]);
					}
				});
			}
		};

		var _iteratorNormalCompletion = true;
		var _didIteratorError = false;
		var _iteratorError = undefined;

		try {
			for (var _iterator = Object.getOwnPropertyNames(opts.on)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
				var name = _step.value;

				_loop(name);
			}
		} catch (err) {
			_didIteratorError = true;
			_iteratorError = err;
		} finally {
			try {
				if (!_iteratorNormalCompletion && _iterator.return) {
					_iterator.return();
				}
			} finally {
				if (_didIteratorError) {
					throw _iteratorError;
				}
			}
		}
	}

	// set the value of an input element
	if (opts.value) {
		$el.value = opts.value;
	}

	// add the name mapping
	if (opts.name) {
		mapped[opts.name] = $el;
	}

	// create the child dom nodes
	if (opts.children) {
		var _iteratorNormalCompletion2 = true;
		var _didIteratorError2 = false;
		var _iteratorError2 = undefined;

		try {
			for (var _iterator2 = opts.children[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
				var child = _step2.value;

				// make an array into a group Object
				if (Array.isArray(child)) {
					child = {
						group: child
					};
				}

				// attach information for the group
				child.parent = $el;
				child.disp = opts.disp;
				child.mapped = mapped;

				// build the node or group
				make(child);
			}
		} catch (err) {
			_didIteratorError2 = true;
			_iteratorError2 = err;
		} finally {
			try {
				if (!_iteratorNormalCompletion2 && _iterator2.return) {
					_iterator2.return();
				}
			} finally {
				if (_didIteratorError2) {
					throw _iteratorError2;
				}
			}
		}
	}

	return mapped;
};

// build a group of dom nodes
var makeGroup = function (group) {
	// shorthand for a groups
	if (Array.isArray(group)) {
		group = {
			children: group
		};
	}

	// get or create the name mapping
	var mapped = {};

	var _iteratorNormalCompletion3 = true;
	var _didIteratorError3 = false;
	var _iteratorError3 = undefined;

	try {
		for (var _iterator3 = group.group[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
			var node = _step3.value;

			// copy over properties from the group
			node.parent || (node.parent = group.parent);
			node.disp || (node.disp = group.disp);
			node.mapped = mapped;

			// make the dom
			make(node);
		}

		// call the callback with the mapped names
	} catch (err) {
		_didIteratorError3 = true;
		_iteratorError3 = err;
	} finally {
		try {
			if (!_iteratorNormalCompletion3 && _iterator3.return) {
				_iterator3.return();
			}
		} finally {
			if (_didIteratorError3) {
				throw _iteratorError3;
			}
		}
	}

	if (group.bind) {
		var subscription = group.bind(mapped);

		// if the return a subscription attach it to the disposable
		if (subscription && group.disp) {
			group.disp.add(subscription);
		}
	}

	return mapped;
};

// a collection of widgets
var widgets = {};

var make = module.exports = function (opts) {
	// handle a group
	if (Array.isArray(opts) || opts.group) {
		return makeGroup(opts);
	}
	// make a widget
	else if (opts.widget) {
			var widget = widgets[opts.widget];

			// not defined
			if (!widget) {
				throw new Error("Widget '" + opts.widget + "' is not defined make sure its been imported");
			}

			// generate the widget content
			var built = widget.make(opts);

			return makeGroup({
				parent: opts.parent,
				disp: opts.disp,
				group: Array.isArray(built) ? built : [built],
				bind: widget.bind && widget.bind.bind(widget, opts)
			});
		}
		// make a single node
		else {
				return makeDom(opts);
			}
};

// register a widget
make.register = function (name, widget) {
	widgets[name] = widget;
};

},{}],7:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/**
 * A basic key value data store
 */

var KeyValueStore = function (_lifeLine$EventEmitte) {
	_inherits(KeyValueStore, _lifeLine$EventEmitte);

	function KeyValueStore(adapter) {
		_classCallCheck(this, KeyValueStore);

		var _this = _possibleConstructorReturn(this, (KeyValueStore.__proto__ || Object.getPrototypeOf(KeyValueStore)).call(this));

		_this._adapter = adapter;

		// make sure we have an adapter
		if (!adapter) {
			throw new Error("KeyValueStore must be initialized with an adapter");
		}
		return _this;
	}

	/**
  * Get the corrisponding value out of the data store otherwise return default
  */


	_createClass(KeyValueStore, [{
		key: "get",
		value: function get(key, _default) {
			// check if this value has been overriden
			if (this._overrides && this._overrides.hasOwnProperty(key)) {
				return Promise.resolve(this._overrides[key]);
			}

			return this._adapter.get(key).then(function (result) {
				// the item is not defined
				if (!result) {
					return _default;
				}

				return result.value;
			});
		}

		/**
   * Set a single value or several values
   *
   * key -> value
   * or
   * { key: value }
   */

	}, {
		key: "set",
		value: function set(key, value) {
			// set a single value
			if (typeof key == "string") {
				var promise = this._adapter.set({
					id: key,
					value: value,
					modified: Date.now()
				});

				// trigger the change
				this.emit(key, value);

				return promise;
			}
			// set several values
			else {
					// tell the caller when we are done
					var promises = [];

					var _iteratorNormalCompletion = true;
					var _didIteratorError = false;
					var _iteratorError = undefined;

					try {
						for (var _iterator = Object.getOwnPropertyNames(key)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
							var _key = _step.value;

							promises.push(this._adapter.set({
								id: _key,
								value: key[_key],
								modified: Date.now()
							}));

							// trigger the change
							this.emit(_key, key[_key]);
						}
					} catch (err) {
						_didIteratorError = true;
						_iteratorError = err;
					} finally {
						try {
							if (!_iteratorNormalCompletion && _iterator.return) {
								_iterator.return();
							}
						} finally {
							if (_didIteratorError) {
								throw _iteratorError;
							}
						}
					}

					return Promise.all(promises);
				}
		}

		/**
   * Watch the value for changes
   *
   * opts.current - send the current value of key (default: false)
   * opts.default - the default value to send for opts.current
   */

	}, {
		key: "watch",
		value: function watch(key, opts, fn) {
			var _this2 = this;

			// make opts optional
			if (typeof opts == "function") {
				fn = opts;
				opts = {};
			}

			// send the current value
			if (opts.current) {
				this.get(key, opts.default).then(function (value) {
					return fn(value);
				});
			}

			// listen for any changes
			return this.on(key, function (value) {
				// only emit the change if there is not an override in place
				if (!_this2._overrides || !_this2._overrides.hasOwnProperty(key)) {
					fn(value);
				}
			});
		}

		/**
   * Override the values from the adaptor without writing to them
   *
   * Useful for combining json settings with command line flags
   */

	}, {
		key: "setOverrides",
		value: function setOverrides(overrides) {
			var _this3 = this;

			this._overrides = overrides;

			// emit changes for each of the overrides
			Object.getOwnPropertyNames(overrides).forEach(function (key) {
				return _this3.emit(key, overrides[key]);
			});
		}
	}]);

	return KeyValueStore;
}(lifeLine.EventEmitter);

module.exports = KeyValueStore;

},{}],8:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * An in memory adapter for data stores
 */

var MemAdaptor = function () {
	function MemAdaptor() {
		_classCallCheck(this, MemAdaptor);

		this._data = {};
	}

	/**
  * Get an array of values
  */


	_createClass(MemAdaptor, [{
		key: "getAll",
		value: function getAll() {
			var _this = this;

			return Promise.resolve(Object.getOwnPropertyNames(this._data).map(function (name) {
				return _this._data[name];
			}));
		}

		/**
   * Lookup a value
   *
   * returns {id, value}
   */

	}, {
		key: "get",
		value: function get(id) {
			// check if we have the value
			if (this._data.hasOwnProperty(id)) {
				return Promise.resolve(this._data[id]);
			}

			return Promise.resolve();
		}

		/**
   * Store a value
   *
   * The value is stored by its id property
   */

	}, {
		key: "set",
		value: function set(value) {
			// store the value
			this._data[value.id] = value;

			return Promise.resolve();
		}

		/**
   * Remove a value from the adaptor
   */

	}, {
		key: "remove",
		value: function remove(key) {
			delete this._data[key];

			return Promise.resolve();
		}
	}]);

	return MemAdaptor;
}();

module.exports = MemAdaptor;

},{}],9:[function(require,module,exports){
(function (process,global){
"use strict";

/**
 * Create a global object with commonly used modules to avoid 50 million requires
 */

var EventEmitter = require("./util/event-emitter");

var lifeLine = new EventEmitter();

// platform detection
lifeLine.node = typeof process == "object";
lifeLine.browser = typeof window == "object";

// attach utils
lifeLine.Disposable = require("./util/disposable");
lifeLine.EventEmitter = EventEmitter;

// attach lifeline to the global object
(lifeLine.node ? global : browser).lifeLine = lifeLine;

// attach config
var MemAdaptor = require("./data-stores/mem-adaptor");
var KeyValueStore = require("./data-stores/key-value-store");

lifeLine.config = new KeyValueStore(new MemAdaptor());

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./data-stores/key-value-store":7,"./data-stores/mem-adaptor":8,"./util/disposable":10,"./util/event-emitter":11,"_process":2}],10:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Keep a list of subscriptions to unsubscribe from together
 */

var Disposable = function () {
	function Disposable() {
		_classCallCheck(this, Disposable);

		this._subscriptions = [];
	}

	// Unsubscribe from all subscriptions


	_createClass(Disposable, [{
		key: "dispose",
		value: function dispose() {
			// remove the first subscription until there are none left
			while (this._subscriptions.length > 0) {
				this._subscriptions.shift().unsubscribe();
			}
		}

		// Add a subscription to the disposable

	}, {
		key: "add",
		value: function add(subscription) {
			this._subscriptions.push(subscription);
		}

		// dispose when an event is fired

	}, {
		key: "disposeOn",
		value: function disposeOn(emitter, event) {
			var _this = this;

			this.add(emitter.on(event, function () {
				return _this.dispose();
			}));
		}
	}]);

	return Disposable;
}();

;

module.exports = Disposable;

},{}],11:[function(require,module,exports){
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * A basic event emitter
 */

var EventEmitter = function () {
	function EventEmitter() {
		_classCallCheck(this, EventEmitter);

		this._listeners = {};
	}

	/**
  * Add an event listener
  */


	_createClass(EventEmitter, [{
		key: "on",
		value: function on(name, listener) {
			var _this = this;

			// if we don't have an existing listeners array create one
			if (!this._listeners[name]) {
				this._listeners[name] = [];
			}

			// add the listener
			this._listeners[name].push(listener);

			// give them a subscription
			return {
				_listener: listener,

				unsubscribe: function () {
					// find the listener
					var index = _this._listeners[name].indexOf(listener);

					if (index !== -1) {
						_this._listeners[name].splice(index, 1);
					}
				}
			};
		}

		/**
   * Emit an event
   */

	}, {
		key: "emit",
		value: function emit(name) {
			// check for listeners
			if (this._listeners[name]) {
				for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
					args[_key - 1] = arguments[_key];
				}

				var _iteratorNormalCompletion = true;
				var _didIteratorError = false;
				var _iteratorError = undefined;

				try {
					for (var _iterator = this._listeners[name][Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
						var listener = _step.value;

						// call the listeners
						listener.apply(undefined, args);
					}
				} catch (err) {
					_didIteratorError = true;
					_iteratorError = err;
				} finally {
					try {
						if (!_iteratorNormalCompletion && _iterator.return) {
							_iterator.return();
						}
					} finally {
						if (_didIteratorError) {
							throw _iteratorError;
						}
					}
				}
			}
		}

		/**
   * Emit an event and skip some listeners
   */

	}, {
		key: "partialEmit",
		value: function partialEmit(name) {
			var skips = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

			// allow a single item
			if (!Array.isArray(skips)) {
				skips = [skips];
			}

			// check for listeners
			if (this._listeners[name]) {
				for (var _len2 = arguments.length, args = Array(_len2 > 2 ? _len2 - 2 : 0), _key2 = 2; _key2 < _len2; _key2++) {
					args[_key2 - 2] = arguments[_key2];
				}

				var _loop = function (listener) {
					// this event listener is being skiped
					if (skips.find(function (skip) {
						return skip._listener == listener;
					})) {
						return "continue";
					}

					// call the listeners
					listener.apply(undefined, args);
				};

				var _iteratorNormalCompletion2 = true;
				var _didIteratorError2 = false;
				var _iteratorError2 = undefined;

				try {
					for (var _iterator2 = this._listeners[name][Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
						var listener = _step2.value;

						var _ret = _loop(listener);

						if (_ret === "continue") continue;
					}
				} catch (err) {
					_didIteratorError2 = true;
					_iteratorError2 = err;
				} finally {
					try {
						if (!_iteratorNormalCompletion2 && _iterator2.return) {
							_iterator2.return();
						}
					} finally {
						if (_didIteratorError2) {
							throw _iteratorError2;
						}
					}
				}
			}
		}
	}]);

	return EventEmitter;
}();

module.exports = EventEmitter;

},{}]},{},[5])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwic3JjXFxjbGllbnRcXGRhdGEtc3RvcmVzXFxpZGItYWRhcHRvci5qcyIsInNyY1xcY2xpZW50XFxnbG9iYWwuanMiLCJzcmNcXGNsaWVudFxcc3ctaW5kZXguanMiLCJzcmNcXGNsaWVudFxcdXRpbFxcZG9tLW1ha2VyLmpzIiwic3JjXFxjb21tb25cXGRhdGEtc3RvcmVzXFxrZXktdmFsdWUtc3RvcmUuanMiLCJzcmNcXGNvbW1vblxcZGF0YS1zdG9yZXNcXG1lbS1hZGFwdG9yLmpzIiwic3JjXFxjb21tb25cXHNyY1xcY29tbW9uXFxnbG9iYWwuanMiLCJzcmNcXGNvbW1vblxcdXRpbFxcZGlzcG9zYWJsZS5qcyIsInNyY1xcY29tbW9uXFx1dGlsXFxldmVudC1lbWl0dGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0VEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtB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O0FBQUEsdUJBQW5DLFFBQW1DOztBQUFBLCtCQUd6QztBQUtEO0FBVHdCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFVekI7QUFDRDs7Ozs7O0FBR0YsT0FBTyxPQUFQLEdBQWlCLFlBQWpCIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIid1c2Ugc3RyaWN0JztcblxuKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiB0b0FycmF5KGFycikge1xuICAgIHJldHVybiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcnIpO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICB9O1xuXG4gICAgICByZXF1ZXN0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KHJlcXVlc3QuZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHJlcXVlc3Q7XG4gICAgdmFyIHAgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3QgPSBvYmpbbWV0aG9kXS5hcHBseShvYmosIGFyZ3MpO1xuICAgICAgcHJvbWlzaWZ5UmVxdWVzdChyZXF1ZXN0KS50aGVuKHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG5cbiAgICBwLnJlcXVlc3QgPSByZXF1ZXN0O1xuICAgIHJldHVybiBwO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwob2JqLCBtZXRob2QsIGFyZ3MpIHtcbiAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKTtcbiAgICByZXR1cm4gcC50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICByZXR1cm4gbmV3IEN1cnNvcih2YWx1ZSwgcC5yZXF1ZXN0KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UHJvcGVydGllcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBwcm9wZXJ0aWVzKSB7XG4gICAgcHJvcGVydGllcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3ApIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShQcm94eUNsYXNzLnByb3RvdHlwZSwgcHJvcCwge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbCkge1xuICAgICAgICAgIHRoaXNbdGFyZ2V0UHJvcF1bcHJvcF0gPSB2YWw7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzW3RhcmdldFByb3BdW3Byb3BdLmFwcGx5KHRoaXNbdGFyZ2V0UHJvcF0sIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhQcm94eUNsYXNzLCB0YXJnZXRQcm9wLCBDb25zdHJ1Y3RvciwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBpZiAoIShwcm9wIGluIENvbnN0cnVjdG9yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICAgIFByb3h5Q2xhc3MucHJvdG90eXBlW3Byb3BdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNpZnlDdXJzb3JSZXF1ZXN0Q2FsbCh0aGlzW3RhcmdldFByb3BdLCBwcm9wLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIEluZGV4KGluZGV4KSB7XG4gICAgdGhpcy5faW5kZXggPSBpbmRleDtcbiAgfVxuXG4gIHByb3h5UHJvcGVydGllcyhJbmRleCwgJ19pbmRleCcsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdtdWx0aUVudHJ5JyxcbiAgICAndW5pcXVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnZ2V0JyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKEluZGV4LCAnX2luZGV4JywgSURCSW5kZXgsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIEN1cnNvcihjdXJzb3IsIHJlcXVlc3QpIHtcbiAgICB0aGlzLl9jdXJzb3IgPSBjdXJzb3I7XG4gICAgdGhpcy5fcmVxdWVzdCA9IHJlcXVlc3Q7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoQ3Vyc29yLCAnX2N1cnNvcicsIFtcbiAgICAnZGlyZWN0aW9uJyxcbiAgICAna2V5JyxcbiAgICAncHJpbWFyeUtleScsXG4gICAgJ3ZhbHVlJ1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKEN1cnNvciwgJ19jdXJzb3InLCBJREJDdXJzb3IsIFtcbiAgICAndXBkYXRlJyxcbiAgICAnZGVsZXRlJ1xuICBdKTtcblxuICAvLyBwcm94eSAnbmV4dCcgbWV0aG9kc1xuICBbJ2FkdmFuY2UnLCAnY29udGludWUnLCAnY29udGludWVQcmltYXJ5S2V5J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2ROYW1lKSB7XG4gICAgaWYgKCEobWV0aG9kTmFtZSBpbiBJREJDdXJzb3IucHJvdG90eXBlKSkgcmV0dXJuO1xuICAgIEN1cnNvci5wcm90b3R5cGVbbWV0aG9kTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBjdXJzb3IgPSB0aGlzO1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgY3Vyc29yLl9jdXJzb3JbbWV0aG9kTmFtZV0uYXBwbHkoY3Vyc29yLl9jdXJzb3IsIGFyZ3MpO1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdChjdXJzb3IuX3JlcXVlc3QpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoIXZhbHVlKSByZXR1cm47XG4gICAgICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIGN1cnNvci5fcmVxdWVzdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gT2JqZWN0U3RvcmUoc3RvcmUpIHtcbiAgICB0aGlzLl9zdG9yZSA9IHN0b3JlO1xuICB9XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmNyZWF0ZUluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5jcmVhdGVJbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgT2JqZWN0U3RvcmUucHJvdG90eXBlLmluZGV4ID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBJbmRleCh0aGlzLl9zdG9yZS5pbmRleC5hcHBseSh0aGlzLl9zdG9yZSwgYXJndW1lbnRzKSk7XG4gIH07XG5cbiAgcHJveHlQcm9wZXJ0aWVzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgW1xuICAgICduYW1lJyxcbiAgICAna2V5UGF0aCcsXG4gICAgJ2luZGV4TmFtZXMnLFxuICAgICdhdXRvSW5jcmVtZW50J1xuICBdKTtcblxuICBwcm94eVJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAncHV0JyxcbiAgICAnYWRkJyxcbiAgICAnZGVsZXRlJyxcbiAgICAnY2xlYXInLFxuICAgICdnZXQnLFxuICAgICdnZXRBbGwnLFxuICAgICdnZXRLZXknLFxuICAgICdnZXRBbGxLZXlzJyxcbiAgICAnY291bnQnXG4gIF0pO1xuXG4gIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoT2JqZWN0U3RvcmUsICdfc3RvcmUnLCBJREJPYmplY3RTdG9yZSwgW1xuICAgICdvcGVuQ3Vyc29yJyxcbiAgICAnb3BlbktleUN1cnNvcidcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnZGVsZXRlSW5kZXgnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIFRyYW5zYWN0aW9uKGlkYlRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fdHggPSBpZGJUcmFuc2FjdGlvbjtcbiAgICB0aGlzLmNvbXBsZXRlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmNvbXBsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH07XG4gICAgICBpZGJUcmFuc2FjdGlvbi5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChpZGJUcmFuc2FjdGlvbi5lcnJvcik7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25hYm9ydCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIFRyYW5zYWN0aW9uLnByb3RvdHlwZS5vYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fdHgub2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fdHgsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhUcmFuc2FjdGlvbiwgJ190eCcsIFtcbiAgICAnb2JqZWN0U3RvcmVOYW1lcycsXG4gICAgJ21vZGUnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhUcmFuc2FjdGlvbiwgJ190eCcsIElEQlRyYW5zYWN0aW9uLCBbXG4gICAgJ2Fib3J0J1xuICBdKTtcblxuICBmdW5jdGlvbiBVcGdyYWRlREIoZGIsIG9sZFZlcnNpb24sIHRyYW5zYWN0aW9uKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgICB0aGlzLm9sZFZlcnNpb24gPSBvbGRWZXJzaW9uO1xuICAgIHRoaXMudHJhbnNhY3Rpb24gPSBuZXcgVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pO1xuICB9XG5cbiAgVXBncmFkZURCLnByb3RvdHlwZS5jcmVhdGVPYmplY3RTdG9yZSA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgT2JqZWN0U3RvcmUodGhpcy5fZGIuY3JlYXRlT2JqZWN0U3RvcmUuYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhVcGdyYWRlREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKFVwZ3JhZGVEQiwgJ19kYicsIElEQkRhdGFiYXNlLCBbXG4gICAgJ2RlbGV0ZU9iamVjdFN0b3JlJyxcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIGZ1bmN0aW9uIERCKGRiKSB7XG4gICAgdGhpcy5fZGIgPSBkYjtcbiAgfVxuXG4gIERCLnByb3RvdHlwZS50cmFuc2FjdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgVHJhbnNhY3Rpb24odGhpcy5fZGIudHJhbnNhY3Rpb24uYXBwbHkodGhpcy5fZGIsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhEQiwgJ19kYicsIFtcbiAgICAnbmFtZScsXG4gICAgJ3ZlcnNpb24nLFxuICAgICdvYmplY3RTdG9yZU5hbWVzJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdjbG9zZSdcbiAgXSk7XG5cbiAgLy8gQWRkIGN1cnNvciBpdGVyYXRvcnNcbiAgLy8gVE9ETzogcmVtb3ZlIHRoaXMgb25jZSBicm93c2VycyBkbyB0aGUgcmlnaHQgdGhpbmcgd2l0aCBwcm9taXNlc1xuICBbJ29wZW5DdXJzb3InLCAnb3BlbktleUN1cnNvciddLmZvckVhY2goZnVuY3Rpb24oZnVuY05hbWUpIHtcbiAgICBbT2JqZWN0U3RvcmUsIEluZGV4XS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGVbZnVuY05hbWUucmVwbGFjZSgnb3BlbicsICdpdGVyYXRlJyldID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBhcmdzID0gdG9BcnJheShhcmd1bWVudHMpO1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgICAgIHZhciBuYXRpdmVPYmplY3QgPSB0aGlzLl9zdG9yZSB8fCB0aGlzLl9pbmRleDtcbiAgICAgICAgdmFyIHJlcXVlc3QgPSBuYXRpdmVPYmplY3RbZnVuY05hbWVdLmFwcGx5KG5hdGl2ZU9iamVjdCwgYXJncy5zbGljZSgwLCAtMSkpO1xuICAgICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNhbGxiYWNrKHJlcXVlc3QucmVzdWx0KTtcbiAgICAgICAgfTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIHBvbHlmaWxsIGdldEFsbFxuICBbSW5kZXgsIE9iamVjdFN0b3JlXS5mb3JFYWNoKGZ1bmN0aW9uKENvbnN0cnVjdG9yKSB7XG4gICAgaWYgKENvbnN0cnVjdG9yLnByb3RvdHlwZS5nZXRBbGwpIHJldHVybjtcbiAgICBDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsID0gZnVuY3Rpb24ocXVlcnksIGNvdW50KSB7XG4gICAgICB2YXIgaW5zdGFuY2UgPSB0aGlzO1xuICAgICAgdmFyIGl0ZW1zID0gW107XG5cbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgIGluc3RhbmNlLml0ZXJhdGVDdXJzb3IocXVlcnksIGZ1bmN0aW9uKGN1cnNvcikge1xuICAgICAgICAgIGlmICghY3Vyc29yKSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaXRlbXMucHVzaChjdXJzb3IudmFsdWUpO1xuXG4gICAgICAgICAgaWYgKGNvdW50ICE9PSB1bmRlZmluZWQgJiYgaXRlbXMubGVuZ3RoID09IGNvdW50KSB7XG4gICAgICAgICAgICByZXNvbHZlKGl0ZW1zKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgY3Vyc29yLmNvbnRpbnVlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgdmFyIGV4cCA9IHtcbiAgICBvcGVuOiBmdW5jdGlvbihuYW1lLCB2ZXJzaW9uLCB1cGdyYWRlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwID0gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnb3BlbicsIFtuYW1lLCB2ZXJzaW9uXSk7XG4gICAgICB2YXIgcmVxdWVzdCA9IHAucmVxdWVzdDtcblxuICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAodXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICAgICAgdXBncmFkZUNhbGxiYWNrKG5ldyBVcGdyYWRlREIocmVxdWVzdC5yZXN1bHQsIGV2ZW50Lm9sZFZlcnNpb24sIHJlcXVlc3QudHJhbnNhY3Rpb24pKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbihkYikge1xuICAgICAgICByZXR1cm4gbmV3IERCKGRiKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgZGVsZXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwoaW5kZXhlZERCLCAnZGVsZXRlRGF0YWJhc2UnLCBbbmFtZV0pO1xuICAgIH1cbiAgfTtcblxuICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGV4cDtcbiAgfVxuICBlbHNlIHtcbiAgICBzZWxmLmlkYiA9IGV4cDtcbiAgfVxufSgpKTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xuXG4vLyBjYWNoZWQgZnJvbSB3aGF0ZXZlciBnbG9iYWwgaXMgcHJlc2VudCBzbyB0aGF0IHRlc3QgcnVubmVycyB0aGF0IHN0dWIgaXRcbi8vIGRvbid0IGJyZWFrIHRoaW5ncy4gIEJ1dCB3ZSBuZWVkIHRvIHdyYXAgaXQgaW4gYSB0cnkgY2F0Y2ggaW4gY2FzZSBpdCBpc1xuLy8gd3JhcHBlZCBpbiBzdHJpY3QgbW9kZSBjb2RlIHdoaWNoIGRvZXNuJ3QgZGVmaW5lIGFueSBnbG9iYWxzLiAgSXQncyBpbnNpZGUgYVxuLy8gZnVuY3Rpb24gYmVjYXVzZSB0cnkvY2F0Y2hlcyBkZW9wdGltaXplIGluIGNlcnRhaW4gZW5naW5lcy5cblxudmFyIGNhY2hlZFNldFRpbWVvdXQ7XG52YXIgY2FjaGVkQ2xlYXJUaW1lb3V0O1xuXG5mdW5jdGlvbiBkZWZhdWx0U2V0VGltb3V0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc2V0VGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxuZnVuY3Rpb24gZGVmYXVsdENsZWFyVGltZW91dCAoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjbGVhclRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbihmdW5jdGlvbiAoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBzZXRUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjbGVhclRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG4gICAgfVxufSAoKSlcbmZ1bmN0aW9uIHJ1blRpbWVvdXQoZnVuKSB7XG4gICAgaWYgKGNhY2hlZFNldFRpbWVvdXQgPT09IHNldFRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIC8vIGlmIHNldFRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRTZXRUaW1lb3V0ID09PSBkZWZhdWx0U2V0VGltb3V0IHx8ICFjYWNoZWRTZXRUaW1lb3V0KSAmJiBzZXRUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfSBjYXRjaChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbChudWxsLCBmdW4sIDApO1xuICAgICAgICB9IGNhdGNoKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3JcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwodGhpcywgZnVuLCAwKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG59XG5mdW5jdGlvbiBydW5DbGVhclRpbWVvdXQobWFya2VyKSB7XG4gICAgaWYgKGNhY2hlZENsZWFyVGltZW91dCA9PT0gY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIC8vIGlmIGNsZWFyVGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZENsZWFyVGltZW91dCA9PT0gZGVmYXVsdENsZWFyVGltZW91dCB8fCAhY2FjaGVkQ2xlYXJUaW1lb3V0KSAmJiBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0ICB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKG51bGwsIG1hcmtlcik7XG4gICAgICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3IuXG4gICAgICAgICAgICAvLyBTb21lIHZlcnNpb25zIG9mIEkuRS4gaGF2ZSBkaWZmZXJlbnQgcnVsZXMgZm9yIGNsZWFyVGltZW91dCB2cyBzZXRUaW1lb3V0XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwodGhpcywgbWFya2VyKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG5cbn1cbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGlmICghZHJhaW5pbmcgfHwgIWN1cnJlbnRRdWV1ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHJ1blRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIHJ1bkNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHJ1blRpbWVvdXQoZHJhaW5RdWV1ZSk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCIvKipcclxuICogQW4gaW5kZXhlZCBkYiBhZGFwdG9yXHJcbiAqL1xyXG5cclxudmFyIGlkYiA9IHJlcXVpcmUoXCJpZGJcIik7XHJcblxyXG5jb25zdCBWQUxJRF9TVE9SRVMgPSBbXCJhc3NpZ25tZW50c1wiLCBcInN5bmMtc3RvcmVcIl07XHJcblxyXG4vLyBvcGVuL3NldHVwIHRoZSBkYXRhYmFzZVxyXG52YXIgZGJQcm9taXNlID0gaWRiLm9wZW4oXCJkYXRhLXN0b3Jlc1wiLCAzLCBkYiA9PiB7XHJcblx0Ly8gdXBncmFkZSBvciBjcmVhdGUgdGhlIGRiXHJcblx0aWYoZGIub2xkVmVyc2lvbiA8IDEpXHJcblx0XHRkYi5jcmVhdGVPYmplY3RTdG9yZShcImFzc2lnbm1lbnRzXCIsIHsga2V5UGF0aDogXCJpZFwiIH0pO1xyXG5cdGlmKGRiLm9sZFZlcnNpb24gPCAyKVxyXG5cdFx0ZGIuY3JlYXRlT2JqZWN0U3RvcmUoXCJzeW5jLXN0b3JlXCIsIHsga2V5UGF0aDogXCJpZFwiIH0pO1xyXG5cclxuXHQvLyB0aGUgdmVyc2lvbiAyIHN5bmMtc3RvcmUgaGFkIGEgZGlmZmVyZW50IHN0cnVjdHVyZSB0aGF0IHRoZSB2ZXJzaW9uIDNcclxuXHRpZihkYi5vbGRWZXJzaW9uID09IDIpIHtcclxuXHRcdGRiLmRlbGV0ZU9iamVjdFN0b3JlKFwic3luYy1zdG9yZVwiKTtcclxuXHRcdGRiLmNyZWF0ZU9iamVjdFN0b3JlKFwic3luYy1zdG9yZVwiLCB7IGtleVBhdGg6IFwiaWRcIiB9KTtcclxuXHR9XHJcbn0pO1xyXG5cclxuY2xhc3MgSWRiQWRhcHRvciB7XHJcblx0Y29uc3RydWN0b3IobmFtZSkge1xyXG5cdFx0dGhpcy5uYW1lID0gbmFtZTtcclxuXHJcblx0XHQvLyBjaGVjayB0aGUgc3RvcmUgaXMgdmFsaWRcclxuXHRcdGlmKFZBTElEX1NUT1JFUy5pbmRleE9mKG5hbWUpID09PSAtMSkge1xyXG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoYFRoZSBkYXRhIHN0b3JlICR7bmFtZX0gaXMgbm90IGluIGlkYiB1cGRhdGUgdGhlIGRiYCk7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHQvLyBjcmVhdGUgYSB0cmFuc2FjdGlvblxyXG5cdF90cmFuc2FjdGlvbihyZWFkV3JpdGUpIHtcclxuXHRcdHJldHVybiBkYlByb21pc2UudGhlbihkYiA9PiB7XHJcblx0XHRcdHJldHVybiBkYlxyXG5cdFx0XHRcdC50cmFuc2FjdGlvbih0aGlzLm5hbWUsIHJlYWRXcml0ZSAmJiBcInJlYWR3cml0ZVwiKVxyXG5cdFx0XHRcdC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpO1xyXG5cdFx0fSk7XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBHZXQgYWxsIHRoZSB2YWx1ZXMgaW4gdGhlIG9iamVjdCBzdG9yZVxyXG5cdCAqL1xyXG5cdGdldEFsbCgpIHtcclxuXHRcdHJldHVybiB0aGlzLl90cmFuc2FjdGlvbigpXHJcblx0XHRcdC50aGVuKHRyYW5zID0+IHRyYW5zLmdldEFsbCgpKTtcclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIEdldCBhIHNwZWNpZmljIHZhbHVlXHJcblx0ICovXHJcblx0Z2V0KGtleSkge1xyXG5cdFx0cmV0dXJuIHRoaXMuX3RyYW5zYWN0aW9uKClcclxuXHRcdFx0LnRoZW4odHJhbnMgPT4gdHJhbnMuZ2V0KGtleSkpO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogU3RvcmUgYSB2YWx1ZSBpbiBpZGJcclxuXHQgKi9cclxuXHRzZXQodmFsdWUpIHtcclxuXHRcdHJldHVybiB0aGlzLl90cmFuc2FjdGlvbih0cnVlKVxyXG5cdFx0XHQudGhlbih0cmFucyA9PiB0cmFucy5wdXQodmFsdWUpKTtcclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIFJlbW92ZSBhIHZhbHVlIGZyb20gaWRiXHJcblx0ICovXHJcblx0cmVtb3ZlKGtleSkge1xyXG5cdFx0cmV0dXJuIHRoaXMuX3RyYW5zYWN0aW9uKHRydWUpXHJcblx0XHRcdC50aGVuKHRyYW5zID0+IHRyYW5zLmRlbGV0ZShrZXkpKTtcclxuXHR9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gSWRiQWRhcHRvcjtcclxuIiwiLyoqXHJcbiAqIEJyb3dzZXIgc3BlY2lmaWMgZ2xvYmFsc1xyXG4gKi9cclxuXHJcbmxpZmVMaW5lLm1ha2VEb20gPSByZXF1aXJlKFwiLi91dGlsL2RvbS1tYWtlclwiKTtcclxuXHJcbi8vIGFkZCBhIGZ1bmN0aW9uIGZvciBhZGRpbmcgYWN0aW9uc1xyXG5saWZlTGluZS5hZGRBY3Rpb24gPSBmdW5jdGlvbihuYW1lLCBmbikge1xyXG5cdC8vIGF0dGFjaCB0aGUgY2FsbGJhY2tcclxuXHR2YXIgbGlzdGVuZXIgPSBsaWZlTGluZS5vbihcImFjdGlvbi1leGVjLVwiICsgbmFtZSwgZm4pO1xyXG5cclxuXHQvLyBpbmZvcm0gYW55IGFjdGlvbiBwcm92aWRlcnNcclxuXHRsaWZlTGluZS5lbWl0KFwiYWN0aW9uLWNyZWF0ZVwiLCBuYW1lKTtcclxuXHJcblx0Ly8gYWxsIGFjdGlvbnMgcmVtb3ZlZFxyXG5cdHZhciByZW1vdmVBbGwgPSBsaWZlTGluZS5vbihcImFjdGlvbi1yZW1vdmUtYWxsXCIsICgpID0+IHtcclxuXHRcdC8vIHJlbW92ZSB0aGUgYWN0aW9uIGxpc3RlbmVyXHJcblx0XHRsaXN0ZW5lci51bnN1YnNjcmliZSgpO1xyXG5cdFx0cmVtb3ZlQWxsLnVuc3Vic2NyaWJlKCk7XHJcblx0fSk7XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHR1bnN1YnNjcmliZSgpIHtcclxuXHRcdFx0Ly8gcmVtb3ZlIHRoZSBhY3Rpb24gbGlzdGVuZXJcclxuXHRcdFx0bGlzdGVuZXIudW5zdWJzY3JpYmUoKTtcclxuXHRcdFx0cmVtb3ZlQWxsLnVuc3Vic2NyaWJlKCk7XHJcblxyXG5cdFx0XHQvLyBpbmZvcm0gYW55IGFjdGlvbiBwcm92aWRlcnNcclxuXHRcdFx0bGlmZUxpbmUuZW1pdChcImFjdGlvbi1yZW1vdmVcIiwgbmFtZSk7XHJcblx0XHR9XHJcblx0fTtcclxufTtcclxuIiwiLy8gY3JlYXRlIHRoZSBnbG9iYWwgb2JqZWN0XHJcbnJlcXVpcmUoXCIuLi9jb21tb24vZ2xvYmFsXCIpO1xyXG5yZXF1aXJlKFwiLi9nbG9iYWxcIik7XHJcblxyXG52YXIgS2V5VmFsdWVTdG9yZSA9IHJlcXVpcmUoXCIuLi9jb21tb24vZGF0YS1zdG9yZXMva2V5LXZhbHVlLXN0b3JlXCIpO1xyXG52YXIgSWRiQWRhcHRvciA9IHJlcXVpcmUoXCIuL2RhdGEtc3RvcmVzL2lkYi1hZGFwdG9yXCIpO1xyXG5cclxudmFyIHN5bmNTdG9yZSA9IG5ldyBLZXlWYWx1ZVN0b3JlKG5ldyBJZGJBZGFwdG9yKFwic3luYy1zdG9yZVwiKSk7XHJcblxyXG4vLyBhbGwgdGhlIGZpbGVzIHRvIGNhY2hlXHJcbmNvbnN0IENBQ0hFRF9GSUxFUyA9IFtcclxuXHRcIi9cIixcclxuXHRcIi9zdGF0aWMvYnVuZGxlLmpzXCIsXHJcblx0XCIvc3RhdGljL3N0eWxlLmNzc1wiLFxyXG5cdFwiL3N0YXRpYy9pY29uLTE0NC5wbmdcIixcclxuXHRcIi9zdGF0aWMvbWFuaWZlc3QuanNvblwiXHJcbl07XHJcblxyXG5jb25zdCBTVEFUSUNfQ0FDSEUgPSBcInN0YXRpY1wiO1xyXG5cclxuLy8gY2FjaGUgdGhlIHZlcnNpb24gb2YgdGhlIGNsaWVudFxyXG52YXIgY2xpZW50VmVyc2lvbjtcclxuXHJcbi8vIGRvd25sb2FkIGEgbmV3IHZlcnNpb25cclxudmFyIGRvd25sb2FkID0gZnVuY3Rpb24oKSB7XHJcblx0Ly8gc2F2ZSB0aGUgbmV3IHZlcnNpb25cclxuXHR2YXIgdmVyc2lvbjtcclxuXHJcblx0Ly8gb3BlbiB0aGUgY2FjaGVcclxuXHRyZXR1cm4gY2FjaGVzLm9wZW4oU1RBVElDX0NBQ0hFKVxyXG5cclxuXHQudGhlbihjYWNoZSA9PiB7XHJcblx0XHQvLyBkb3dubG9hZCBhbGwgdGhlIGZpbGVzXHJcblx0XHRyZXR1cm4gUHJvbWlzZS5hbGwoXHJcblx0XHRcdENBQ0hFRF9GSUxFUy5tYXAodXJsID0+IHtcclxuXHRcdFx0XHQvLyBkb3dubG9hZCB0aGUgZmlsZVxyXG5cdFx0XHRcdHJldHVybiBmZXRjaCh1cmwpXHJcblxyXG5cdFx0XHRcdC50aGVuKHJlcyA9PiB7XHJcblx0XHRcdFx0XHQvLyBzYXZlIHRoZSBmaWxlXHJcblx0XHRcdFx0XHR2YXIgcHJvbWlzZXMgPSBbXHJcblx0XHRcdFx0XHRcdGNhY2hlLnB1dChuZXcgUmVxdWVzdCh1cmwpLCByZXMpXHJcblx0XHRcdFx0XHRdO1xyXG5cclxuXHRcdFx0XHRcdC8vIHNhdmUgdGhlIHZlcnNpb25cclxuXHRcdFx0XHRcdGlmKCF2ZXJzaW9uKSB7XHJcblx0XHRcdFx0XHRcdHZlcnNpb24gPSBjbGllbnRWZXJzaW9uID0gcmVzLmhlYWRlcnMuZ2V0KFwic2VydmVyXCIpO1xyXG5cclxuXHRcdFx0XHRcdFx0cHJvbWlzZXMucHVzaChzeW5jU3RvcmUuc2V0KFwidmVyc2lvblwiLCB2ZXJzaW9uKSk7XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0cmV0dXJuIHByb21pc2VzLmxlbmd0aCA9PSAxID8gcHJvbWlzZXNbMF0gOiBQcm9taXNlLmFsbChwcm9taXNlcyk7XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH0pXHJcblx0XHQpXHJcblxyXG5cdFx0Ly8gbm90aWZ5IHRoZSBjbGllbnQocykgb2YgdGhlIHVwZGF0ZVxyXG5cdFx0LnRoZW4oKCkgPT4gbm90aWZ5Q2xpZW50cyh2ZXJzaW9uKSk7XHJcblx0fSk7XHJcbn07XHJcblxyXG4vLyBub3RpZnkgdGhlIGNsaWVudChzKSBvZiBhbiB1cGRhdGVcclxudmFyIG5vdGlmeUNsaWVudHMgPSBmdW5jdGlvbih2ZXJzaW9uKSB7XHJcblx0Ly8gZ2V0IGFsbCB0aGUgY2xpZW50c1xyXG5cdHJldHVybiBjbGllbnRzLm1hdGNoQWxsKHt9KVxyXG5cclxuXHQudGhlbihjbGllbnRzID0+IHtcclxuXHRcdGZvcihsZXQgY2xpZW50IG9mIGNsaWVudHMpIHtcclxuXHRcdFx0Ly8gc2VuZCB0aGUgdmVyc2lvblxyXG5cdFx0XHRjbGllbnQucG9zdE1lc3NhZ2Uoe1xyXG5cdFx0XHRcdHR5cGU6IFwidmVyc2lvbi1jaGFuZ2VcIixcclxuXHRcdFx0XHR2ZXJzaW9uXHJcblx0XHRcdH0pO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG59O1xyXG5cclxuLy8gY2hlY2sgZm9yIHVwZGF0ZXNcclxudmFyIGNoZWNrRm9yVXBkYXRlcyA9IGZ1bmN0aW9uKG5ld1ZlcnNpb24pIHtcclxuXHQvLyBpZiB3ZSBoYXZlIGEgdmVyc2lvbiB1c2UgdGhhdFxyXG5cdGlmKG5ld1ZlcnNpb24pIHtcclxuXHRcdG5ld1ZlcnNpb24gPSBQcm9taXNlLnJlc29sdmUobmV3VmVyc2lvbik7XHJcblx0fVxyXG5cdC8vIGZldGNoIHRoZSB2ZXJzaW9uXHJcblx0ZWxzZSB7XHJcblx0XHRuZXdWZXJzaW9uID0gZmV0Y2goXCIvXCIpXHJcblxyXG5cdFx0LnRoZW4ocmVzID0+IHJlcy5oZWFkZXJzLmdldChcInNlcnZlclwiKSk7XHJcblx0fVxyXG5cclxuXHR2YXIgb2xkVmVyc2lvbjtcclxuXHJcblx0Ly8gYWxyZWFkeSBpbiBtZW1vcnlcclxuXHRpZihjbGllbnRWZXJzaW9uKSB7XHJcblx0XHRvbGRWZXJzaW9uID0gUHJvbWlzZS5yZXNvbHZlKGNsaWVudFZlcnNpb24pO1xyXG5cdH1cclxuXHRlbHNlIHtcclxuXHRcdG9sZFZlcnNpb24gPSBzeW5jU3RvcmUuZ2V0KFwidmVyc2lvblwiKTtcclxuXHR9XHJcblxyXG5cdHJldHVybiBQcm9taXNlLmFsbChbXHJcblx0XHRuZXdWZXJzaW9uLFxyXG5cdFx0b2xkVmVyc2lvblxyXG5cdF0pXHJcblxyXG5cdC50aGVuKChbbmV3VmVyc2lvbiwgb2xkVmVyc2lvbl0pID0+IHtcclxuXHRcdC8vIHNhbWUgdmVyc2lvbiBkbyBub3RoaW5nXHJcblx0XHRpZihuZXdWZXJzaW9uID09IG9sZFZlcnNpb24pIHtcclxuXHRcdFx0cmV0dXJuIHN5bmNTdG9yZS5zZXQoXCJ2ZXJzaW9uXCIsIG9sZFZlcnNpb24pO1xyXG5cdFx0fVxyXG5cclxuXHRcdC8vIGRvd25sb2FkIHRoZSBuZXcgdmVyc2lvblxyXG5cdFx0cmV0dXJuIGRvd25sb2FkKCk7XHJcblx0fSk7XHJcbn07XHJcblxyXG4vLyB3aGVuIHdlIGFyZSBpbnN0YWxsZWQgY2hlY2sgZm9yIHVwZGF0ZXNcclxuc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiaW5zdGFsbFwiLCBlID0+IGUud2FpdFVudGlsKGNoZWNrRm9yVXBkYXRlcygpKSk7XHJcblxyXG4vLyBoYW5kbGUgYSBuZXR3b3JrIFJlcXVlc3Rcclxuc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZmV0Y2hcIiwgZSA9PiB7XHJcblx0Ly8gZ2V0IHRoZSBwYWdlIHVybFxyXG5cdHZhciB1cmwgPSBuZXcgVVJMKGUucmVxdWVzdC51cmwpLnBhdGhuYW1lO1xyXG5cclxuXHQvLyBqdXN0IGdvIHRvIHRoZSBzZXJ2ZXIgZm9yIGFwaSBjYWxsc1xyXG5cdGlmKHVybC5zdWJzdHIoMCwgNSkgPT0gXCIvYXBpL1wiKSB7XHJcblx0XHRlLnJlc3BvbmRXaXRoKFxyXG5cdFx0XHRmZXRjaChlLnJlcXVlc3QsIHtcclxuXHRcdFx0XHRjcmVkZW50aWFsczogXCJpbmNsdWRlXCJcclxuXHRcdFx0fSlcclxuXHJcblx0XHRcdC8vIG5ldHdvcmsgZXJyb3JcclxuXHRcdFx0LmNhdGNoKGVyciA9PiB7XHJcblx0XHRcdFx0Ly8gc2VuZCBhbiBlcnJvciByZXNwb25zZVxyXG5cdFx0XHRcdHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoe1xyXG5cdFx0XHRcdFx0c3RhdHVzOiBcImZhaWxcIixcclxuXHRcdFx0XHRcdGRhdGE6IHtcclxuXHRcdFx0XHRcdFx0cmVhc29uOiBcIm5ldHdvcmstZXJyb3JcIlxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0pLCB7XHJcblx0XHRcdFx0XHRoZWFkZXJzOiB7XHJcblx0XHRcdFx0XHRcdFwiY29udGVudC10eXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH0pXHJcblxyXG5cdFx0XHQudGhlbihyZXMgPT4ge1xyXG5cdFx0XHRcdC8vIGNoZWNrIGZvciB1cGRhdGVzXHJcblx0XHRcdFx0Y2hlY2tGb3JVcGRhdGVzKHJlcy5oZWFkZXJzLmdldChcInNlcnZlclwiKSk7XHJcblxyXG5cdFx0XHRcdHJldHVybiByZXM7XHJcblx0XHRcdH0pXHJcblx0XHQpO1xyXG5cdH1cclxuXHQvLyByZXNwb25kIGZyb20gdGhlIGNhY2hlXHJcblx0ZWxzZSB7XHJcblx0XHRlLnJlc3BvbmRXaXRoKFxyXG5cdFx0XHRjYWNoZXMubWF0Y2goZS5yZXF1ZXN0KVxyXG5cclxuXHRcdFx0LnRoZW4ocmVzID0+IHtcclxuXHRcdFx0XHQvLyBpZiB0aGVyZSB3YXMgbm8gbWF0Y2ggc2VuZCB0aGUgaW5kZXggcGFnZVxyXG5cdFx0XHRcdGlmKCFyZXMpIHtcclxuXHRcdFx0XHRcdHJldHVybiBjYWNoZXMubWF0Y2gobmV3IFJlcXVlc3QoXCIvXCIpKTtcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdHJldHVybiByZXM7XHJcblx0XHRcdH0pXHJcblx0XHQpO1xyXG5cdH1cclxufSk7XHJcbiIsIi8qKlxyXG4gKiBBIGhlbHBlciBmb3IgYnVpbGRpbmcgZG9tIG5vZGVzXHJcbiAqL1xyXG5cclxuY29uc3QgU1ZHX0VMRU1FTlRTID0gW1wic3ZnXCIsIFwibGluZVwiXTtcclxuY29uc3QgU1ZHX05BTUVTUEFDRSA9IFwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIjtcclxuXHJcbi8vIGJ1aWxkIGEgc2luZ2xlIGRvbSBub2RlXHJcbnZhciBtYWtlRG9tID0gZnVuY3Rpb24ob3B0cyA9IHt9KSB7XHJcblx0Ly8gZ2V0IG9yIGNyZWF0ZSB0aGUgbmFtZSBtYXBwaW5nXHJcblx0dmFyIG1hcHBlZCA9IG9wdHMubWFwcGVkIHx8IHt9O1xyXG5cclxuXHR2YXIgJGVsO1xyXG5cclxuXHQvLyB0aGUgZWxlbWVudCBpcyBwYXJ0IG9mIHRoZSBzdmcgbmFtZXNwYWNlXHJcblx0aWYoU1ZHX0VMRU1FTlRTLmluZGV4T2Yob3B0cy50YWcpICE9PSAtMSkge1xyXG5cdFx0JGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFNWR19OQU1FU1BBQ0UsIG9wdHMudGFnKTtcclxuXHR9XHJcblx0Ly8gYSBwbGFpbiBlbGVtZW50XHJcblx0ZWxzZSB7XHJcblx0XHQkZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG9wdHMudGFnIHx8IFwiZGl2XCIpO1xyXG5cdH1cclxuXHJcblx0Ly8gc2V0IHRoZSBjbGFzc2VzXHJcblx0aWYob3B0cy5jbGFzc2VzKSB7XHJcblx0XHQkZWwuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdHlwZW9mIG9wdHMuY2xhc3NlcyA9PSBcInN0cmluZ1wiID8gb3B0cy5jbGFzc2VzIDogb3B0cy5jbGFzc2VzLmpvaW4oXCIgXCIpKTtcclxuXHR9XHJcblxyXG5cdC8vIGF0dGFjaCB0aGUgYXR0cmlidXRlc1xyXG5cdGlmKG9wdHMuYXR0cnMpIHtcclxuXHRcdE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9wdHMuYXR0cnMpXHJcblxyXG5cdFx0LmZvckVhY2goYXR0ciA9PiAkZWwuc2V0QXR0cmlidXRlKGF0dHIsIG9wdHMuYXR0cnNbYXR0cl0pKTtcclxuXHR9XHJcblxyXG5cdC8vIHNldCB0aGUgdGV4dCBjb250ZW50XHJcblx0aWYob3B0cy50ZXh0KSB7XHJcblx0XHQkZWwuaW5uZXJUZXh0ID0gb3B0cy50ZXh0O1xyXG5cdH1cclxuXHJcblx0Ly8gYXR0YWNoIHRoZSBub2RlIHRvIGl0cyBwYXJlbnRcclxuXHRpZihvcHRzLnBhcmVudCkge1xyXG5cdFx0b3B0cy5wYXJlbnQuaW5zZXJ0QmVmb3JlKCRlbCwgb3B0cy5iZWZvcmUpO1xyXG5cdH1cclxuXHJcblx0Ly8gYWRkIGV2ZW50IGxpc3RlbmVyc1xyXG5cdGlmKG9wdHMub24pIHtcclxuXHRcdGZvcihsZXQgbmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvcHRzLm9uKSkge1xyXG5cdFx0XHQkZWwuYWRkRXZlbnRMaXN0ZW5lcihuYW1lLCBvcHRzLm9uW25hbWVdKTtcclxuXHJcblx0XHRcdC8vIGF0dGFjaCB0aGUgZG9tIHRvIGEgZGlzcG9zYWJsZVxyXG5cdFx0XHRpZihvcHRzLmRpc3ApIHtcclxuXHRcdFx0XHRvcHRzLmRpc3AuYWRkKHtcclxuXHRcdFx0XHRcdHVuc3Vic2NyaWJlOiAoKSA9PiAkZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihuYW1lLCBvcHRzLm9uW25hbWVdKVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHQvLyBzZXQgdGhlIHZhbHVlIG9mIGFuIGlucHV0IGVsZW1lbnRcclxuXHRpZihvcHRzLnZhbHVlKSB7XHJcblx0XHQkZWwudmFsdWUgPSBvcHRzLnZhbHVlO1xyXG5cdH1cclxuXHJcblx0Ly8gYWRkIHRoZSBuYW1lIG1hcHBpbmdcclxuXHRpZihvcHRzLm5hbWUpIHtcclxuXHRcdG1hcHBlZFtvcHRzLm5hbWVdID0gJGVsO1xyXG5cdH1cclxuXHJcblx0Ly8gY3JlYXRlIHRoZSBjaGlsZCBkb20gbm9kZXNcclxuXHRpZihvcHRzLmNoaWxkcmVuKSB7XHJcblx0XHRmb3IobGV0IGNoaWxkIG9mIG9wdHMuY2hpbGRyZW4pIHtcclxuXHRcdFx0Ly8gbWFrZSBhbiBhcnJheSBpbnRvIGEgZ3JvdXAgT2JqZWN0XHJcblx0XHRcdGlmKEFycmF5LmlzQXJyYXkoY2hpbGQpKSB7XHJcblx0XHRcdFx0Y2hpbGQgPSB7XHJcblx0XHRcdFx0XHRncm91cDogY2hpbGRcclxuXHRcdFx0XHR9O1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBhdHRhY2ggaW5mb3JtYXRpb24gZm9yIHRoZSBncm91cFxyXG5cdFx0XHRjaGlsZC5wYXJlbnQgPSAkZWw7XHJcblx0XHRcdGNoaWxkLmRpc3AgPSBvcHRzLmRpc3A7XHJcblx0XHRcdGNoaWxkLm1hcHBlZCA9IG1hcHBlZDtcclxuXHJcblx0XHRcdC8vIGJ1aWxkIHRoZSBub2RlIG9yIGdyb3VwXHJcblx0XHRcdG1ha2UoY2hpbGQpO1xyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0cmV0dXJuIG1hcHBlZDtcclxufVxyXG5cclxuLy8gYnVpbGQgYSBncm91cCBvZiBkb20gbm9kZXNcclxudmFyIG1ha2VHcm91cCA9IGZ1bmN0aW9uKGdyb3VwKSB7XHJcblx0Ly8gc2hvcnRoYW5kIGZvciBhIGdyb3Vwc1xyXG5cdGlmKEFycmF5LmlzQXJyYXkoZ3JvdXApKSB7XHJcblx0XHRncm91cCA9IHtcclxuXHRcdFx0Y2hpbGRyZW46IGdyb3VwXHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0Ly8gZ2V0IG9yIGNyZWF0ZSB0aGUgbmFtZSBtYXBwaW5nXHJcblx0dmFyIG1hcHBlZCA9IHt9O1xyXG5cclxuXHRmb3IobGV0IG5vZGUgb2YgZ3JvdXAuZ3JvdXApIHtcclxuXHRcdC8vIGNvcHkgb3ZlciBwcm9wZXJ0aWVzIGZyb20gdGhlIGdyb3VwXHJcblx0XHRub2RlLnBhcmVudCB8fCAobm9kZS5wYXJlbnQgPSBncm91cC5wYXJlbnQpO1xyXG5cdFx0bm9kZS5kaXNwIHx8IChub2RlLmRpc3AgPSBncm91cC5kaXNwKTtcclxuXHRcdG5vZGUubWFwcGVkID0gbWFwcGVkO1xyXG5cclxuXHRcdC8vIG1ha2UgdGhlIGRvbVxyXG5cdFx0bWFrZShub2RlKTtcclxuXHR9XHJcblxyXG5cdC8vIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIG1hcHBlZCBuYW1lc1xyXG5cdGlmKGdyb3VwLmJpbmQpIHtcclxuXHRcdHZhciBzdWJzY3JpcHRpb24gPSBncm91cC5iaW5kKG1hcHBlZCk7XHJcblxyXG5cdFx0Ly8gaWYgdGhlIHJldHVybiBhIHN1YnNjcmlwdGlvbiBhdHRhY2ggaXQgdG8gdGhlIGRpc3Bvc2FibGVcclxuXHRcdGlmKHN1YnNjcmlwdGlvbiAmJiBncm91cC5kaXNwKSB7XHJcblx0XHRcdGdyb3VwLmRpc3AuYWRkKHN1YnNjcmlwdGlvbik7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHRyZXR1cm4gbWFwcGVkO1xyXG59O1xyXG5cclxuLy8gYSBjb2xsZWN0aW9uIG9mIHdpZGdldHNcclxudmFyIHdpZGdldHMgPSB7fTtcclxuXHJcbnZhciBtYWtlID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvcHRzKSB7XHJcblx0Ly8gaGFuZGxlIGEgZ3JvdXBcclxuXHRpZihBcnJheS5pc0FycmF5KG9wdHMpIHx8IG9wdHMuZ3JvdXApIHtcclxuXHRcdHJldHVybiBtYWtlR3JvdXAob3B0cyk7XHJcblx0fVxyXG5cdC8vIG1ha2UgYSB3aWRnZXRcclxuXHRlbHNlIGlmKG9wdHMud2lkZ2V0KSB7XHJcblx0XHR2YXIgd2lkZ2V0ID0gd2lkZ2V0c1tvcHRzLndpZGdldF07XHJcblxyXG5cdFx0Ly8gbm90IGRlZmluZWRcclxuXHRcdGlmKCF3aWRnZXQpIHtcclxuXHRcdFx0dGhyb3cgbmV3IEVycm9yKGBXaWRnZXQgJyR7b3B0cy53aWRnZXR9JyBpcyBub3QgZGVmaW5lZCBtYWtlIHN1cmUgaXRzIGJlZW4gaW1wb3J0ZWRgKTtcclxuXHRcdH1cclxuXHJcblx0XHQvLyBnZW5lcmF0ZSB0aGUgd2lkZ2V0IGNvbnRlbnRcclxuXHRcdHZhciBidWlsdCA9IHdpZGdldC5tYWtlKG9wdHMpO1xyXG5cclxuXHRcdHJldHVybiBtYWtlR3JvdXAoe1xyXG5cdFx0XHRwYXJlbnQ6IG9wdHMucGFyZW50LFxyXG5cdFx0XHRkaXNwOiBvcHRzLmRpc3AsXHJcblx0XHRcdGdyb3VwOiBBcnJheS5pc0FycmF5KGJ1aWx0KSA/IGJ1aWx0IDogW2J1aWx0XSxcclxuXHRcdFx0YmluZDogd2lkZ2V0LmJpbmQgJiYgd2lkZ2V0LmJpbmQuYmluZCh3aWRnZXQsIG9wdHMpXHJcblx0XHR9KTtcclxuXHR9XHJcblx0Ly8gbWFrZSBhIHNpbmdsZSBub2RlXHJcblx0ZWxzZSB7XHJcblx0XHRyZXR1cm4gbWFrZURvbShvcHRzKTtcclxuXHR9XHJcbn07XHJcblxyXG4vLyByZWdpc3RlciBhIHdpZGdldFxyXG5tYWtlLnJlZ2lzdGVyID0gZnVuY3Rpb24obmFtZSwgd2lkZ2V0KSB7XHJcblx0d2lkZ2V0c1tuYW1lXSA9IHdpZGdldDtcclxufTtcclxuIiwiLyoqXHJcbiAqIEEgYmFzaWMga2V5IHZhbHVlIGRhdGEgc3RvcmVcclxuICovXHJcblxyXG5jbGFzcyBLZXlWYWx1ZVN0b3JlIGV4dGVuZHMgbGlmZUxpbmUuRXZlbnRFbWl0dGVyIHtcclxuXHRjb25zdHJ1Y3RvcihhZGFwdGVyKSB7XHJcblx0XHRzdXBlcigpO1xyXG5cdFx0dGhpcy5fYWRhcHRlciA9IGFkYXB0ZXI7XHJcblxyXG5cdFx0Ly8gbWFrZSBzdXJlIHdlIGhhdmUgYW4gYWRhcHRlclxyXG5cdFx0aWYoIWFkYXB0ZXIpIHtcclxuXHRcdFx0dGhyb3cgbmV3IEVycm9yKFwiS2V5VmFsdWVTdG9yZSBtdXN0IGJlIGluaXRpYWxpemVkIHdpdGggYW4gYWRhcHRlclwiKVxyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogR2V0IHRoZSBjb3JyaXNwb25kaW5nIHZhbHVlIG91dCBvZiB0aGUgZGF0YSBzdG9yZSBvdGhlcndpc2UgcmV0dXJuIGRlZmF1bHRcclxuXHQgKi9cclxuXHRnZXQoa2V5LCBfZGVmYXVsdCkge1xyXG5cdFx0Ly8gY2hlY2sgaWYgdGhpcyB2YWx1ZSBoYXMgYmVlbiBvdmVycmlkZW5cclxuXHRcdGlmKHRoaXMuX292ZXJyaWRlcyAmJiB0aGlzLl9vdmVycmlkZXMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xyXG5cdFx0XHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuX292ZXJyaWRlc1trZXldKTtcclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gdGhpcy5fYWRhcHRlci5nZXQoa2V5KVxyXG5cclxuXHRcdC50aGVuKHJlc3VsdCA9PiB7XHJcblx0XHRcdC8vIHRoZSBpdGVtIGlzIG5vdCBkZWZpbmVkXHJcblx0XHRcdGlmKCFyZXN1bHQpIHtcclxuXHRcdFx0XHRyZXR1cm4gX2RlZmF1bHQ7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHJldHVybiByZXN1bHQudmFsdWU7XHJcblx0XHR9KTtcclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIFNldCBhIHNpbmdsZSB2YWx1ZSBvciBzZXZlcmFsIHZhbHVlc1xyXG5cdCAqXHJcblx0ICoga2V5IC0+IHZhbHVlXHJcblx0ICogb3JcclxuXHQgKiB7IGtleTogdmFsdWUgfVxyXG5cdCAqL1xyXG5cdHNldChrZXksIHZhbHVlKSB7XHJcblx0XHQvLyBzZXQgYSBzaW5nbGUgdmFsdWVcclxuXHRcdGlmKHR5cGVvZiBrZXkgPT0gXCJzdHJpbmdcIikge1xyXG5cdFx0XHR2YXIgcHJvbWlzZSA9IHRoaXMuX2FkYXB0ZXIuc2V0KHtcclxuXHRcdFx0XHRpZDoga2V5LFxyXG5cdFx0XHRcdHZhbHVlLFxyXG5cdFx0XHRcdG1vZGlmaWVkOiBEYXRlLm5vdygpXHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0Ly8gdHJpZ2dlciB0aGUgY2hhbmdlXHJcblx0XHRcdHRoaXMuZW1pdChrZXksIHZhbHVlKTtcclxuXHJcblx0XHRcdHJldHVybiBwcm9taXNlO1xyXG5cdFx0fVxyXG5cdFx0Ly8gc2V0IHNldmVyYWwgdmFsdWVzXHJcblx0XHRlbHNlIHtcclxuXHRcdFx0Ly8gdGVsbCB0aGUgY2FsbGVyIHdoZW4gd2UgYXJlIGRvbmVcclxuXHRcdFx0bGV0IHByb21pc2VzID0gW107XHJcblxyXG5cdFx0XHRmb3IobGV0IF9rZXkgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoa2V5KSkge1xyXG5cdFx0XHRcdHByb21pc2VzLnB1c2goXHJcblx0XHRcdFx0XHR0aGlzLl9hZGFwdGVyLnNldCh7XHJcblx0XHRcdFx0XHRcdGlkOiBfa2V5LFxyXG5cdFx0XHRcdFx0XHR2YWx1ZToga2V5W19rZXldLFxyXG5cdFx0XHRcdFx0XHRtb2RpZmllZDogRGF0ZS5ub3coKVxyXG5cdFx0XHRcdFx0fSlcclxuXHRcdFx0XHQpO1xyXG5cclxuXHRcdFx0XHQvLyB0cmlnZ2VyIHRoZSBjaGFuZ2VcclxuXHRcdFx0XHR0aGlzLmVtaXQoX2tleSwga2V5W19rZXldKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0cmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKTtcclxuXHRcdH1cclxuXHR9XHJcblxyXG5cdCAvKipcclxuXHQgICogV2F0Y2ggdGhlIHZhbHVlIGZvciBjaGFuZ2VzXHJcblx0ICAqXHJcblx0ICAqIG9wdHMuY3VycmVudCAtIHNlbmQgdGhlIGN1cnJlbnQgdmFsdWUgb2Yga2V5IChkZWZhdWx0OiBmYWxzZSlcclxuXHQgICogb3B0cy5kZWZhdWx0IC0gdGhlIGRlZmF1bHQgdmFsdWUgdG8gc2VuZCBmb3Igb3B0cy5jdXJyZW50XHJcblx0ICAqL1xyXG5cdCB3YXRjaChrZXksIG9wdHMsIGZuKSB7XHJcblx0XHQgLy8gbWFrZSBvcHRzIG9wdGlvbmFsXHJcblx0XHQgaWYodHlwZW9mIG9wdHMgPT0gXCJmdW5jdGlvblwiKSB7XHJcblx0XHRcdCBmbiA9IG9wdHM7XHJcblx0XHRcdCBvcHRzID0ge307XHJcblx0XHQgfVxyXG5cclxuXHRcdCAvLyBzZW5kIHRoZSBjdXJyZW50IHZhbHVlXHJcblx0XHQgaWYob3B0cy5jdXJyZW50KSB7XHJcblx0XHRcdCB0aGlzLmdldChrZXksIG9wdHMuZGVmYXVsdClcclxuXHRcdFx0IFx0LnRoZW4odmFsdWUgPT4gZm4odmFsdWUpKTtcclxuXHRcdCB9XHJcblxyXG5cdFx0IC8vIGxpc3RlbiBmb3IgYW55IGNoYW5nZXNcclxuXHRcdCByZXR1cm4gdGhpcy5vbihrZXksIHZhbHVlID0+IHtcclxuXHRcdFx0IC8vIG9ubHkgZW1pdCB0aGUgY2hhbmdlIGlmIHRoZXJlIGlzIG5vdCBhbiBvdmVycmlkZSBpbiBwbGFjZVxyXG5cdFx0XHQgaWYoIXRoaXMuX292ZXJyaWRlcyB8fCAhdGhpcy5fb3ZlcnJpZGVzLmhhc093blByb3BlcnR5KGtleSkpIHtcclxuXHRcdFx0XHQgZm4odmFsdWUpO1xyXG5cdFx0XHQgfVxyXG5cdFx0IH0pO1xyXG5cdCB9XHJcblxyXG5cdCAvKipcclxuXHQgICogT3ZlcnJpZGUgdGhlIHZhbHVlcyBmcm9tIHRoZSBhZGFwdG9yIHdpdGhvdXQgd3JpdGluZyB0byB0aGVtXHJcblx0ICAqXHJcblx0ICAqIFVzZWZ1bCBmb3IgY29tYmluaW5nIGpzb24gc2V0dGluZ3Mgd2l0aCBjb21tYW5kIGxpbmUgZmxhZ3NcclxuXHQgICovXHJcblx0IHNldE92ZXJyaWRlcyhvdmVycmlkZXMpIHtcclxuXHRcdCB0aGlzLl9vdmVycmlkZXMgPSBvdmVycmlkZXM7XHJcblxyXG5cdFx0IC8vIGVtaXQgY2hhbmdlcyBmb3IgZWFjaCBvZiB0aGUgb3ZlcnJpZGVzXHJcblx0XHQgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob3ZlcnJpZGVzKVxyXG5cclxuXHRcdCAuZm9yRWFjaChrZXkgPT4gdGhpcy5lbWl0KGtleSwgb3ZlcnJpZGVzW2tleV0pKTtcclxuXHQgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEtleVZhbHVlU3RvcmU7XHJcbiIsIi8qKlxyXG4gKiBBbiBpbiBtZW1vcnkgYWRhcHRlciBmb3IgZGF0YSBzdG9yZXNcclxuICovXHJcblxyXG5jbGFzcyBNZW1BZGFwdG9yIHtcclxuXHRjb25zdHJ1Y3RvcigpIHtcclxuXHRcdHRoaXMuX2RhdGEgPSB7fTtcclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIEdldCBhbiBhcnJheSBvZiB2YWx1ZXNcclxuXHQgKi9cclxuXHRnZXRBbGwoKSB7XHJcblx0XHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKFxyXG5cdFx0XHRPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyh0aGlzLl9kYXRhKVxyXG5cclxuXHRcdFx0Lm1hcChuYW1lID0+IHRoaXMuX2RhdGFbbmFtZV0pXHJcblx0XHQpO1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogTG9va3VwIGEgdmFsdWVcclxuXHQgKlxyXG5cdCAqIHJldHVybnMge2lkLCB2YWx1ZX1cclxuXHQgKi9cclxuXHRnZXQoaWQpIHtcclxuXHRcdC8vIGNoZWNrIGlmIHdlIGhhdmUgdGhlIHZhbHVlXHJcblx0XHRpZih0aGlzLl9kYXRhLmhhc093blByb3BlcnR5KGlkKSkge1xyXG5cdFx0XHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuX2RhdGFbaWRdKTtcclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBTdG9yZSBhIHZhbHVlXHJcblx0ICpcclxuXHQgKiBUaGUgdmFsdWUgaXMgc3RvcmVkIGJ5IGl0cyBpZCBwcm9wZXJ0eVxyXG5cdCAqL1xyXG5cdHNldCh2YWx1ZSkge1xyXG5cdFx0Ly8gc3RvcmUgdGhlIHZhbHVlXHJcblx0XHR0aGlzLl9kYXRhW3ZhbHVlLmlkXSA9IHZhbHVlO1xyXG5cclxuXHRcdHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIFJlbW92ZSBhIHZhbHVlIGZyb20gdGhlIGFkYXB0b3JcclxuXHQgKi9cclxuXHRyZW1vdmUoa2V5KSB7XHJcblx0XHRkZWxldGUgdGhpcy5fZGF0YVtrZXldO1xyXG5cclxuXHRcdHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcclxuXHR9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTWVtQWRhcHRvcjtcclxuIiwiLyoqXHJcbiAqIENyZWF0ZSBhIGdsb2JhbCBvYmplY3Qgd2l0aCBjb21tb25seSB1c2VkIG1vZHVsZXMgdG8gYXZvaWQgNTAgbWlsbGlvbiByZXF1aXJlc1xyXG4gKi9cclxuXHJcbnZhciBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKFwiLi91dGlsL2V2ZW50LWVtaXR0ZXJcIik7XHJcblxyXG52YXIgbGlmZUxpbmUgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XHJcblxyXG4vLyBwbGF0Zm9ybSBkZXRlY3Rpb25cclxubGlmZUxpbmUubm9kZSA9IHR5cGVvZiBwcm9jZXNzID09IFwib2JqZWN0XCI7XHJcbmxpZmVMaW5lLmJyb3dzZXIgPSB0eXBlb2Ygd2luZG93ID09IFwib2JqZWN0XCI7XHJcblxyXG4vLyBhdHRhY2ggdXRpbHNcclxubGlmZUxpbmUuRGlzcG9zYWJsZSA9IHJlcXVpcmUoXCIuL3V0aWwvZGlzcG9zYWJsZVwiKTtcclxubGlmZUxpbmUuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xyXG5cclxuLy8gYXR0YWNoIGxpZmVsaW5lIHRvIHRoZSBnbG9iYWwgb2JqZWN0XHJcbihsaWZlTGluZS5ub2RlID8gZ2xvYmFsIDogYnJvd3NlcikubGlmZUxpbmUgPSBsaWZlTGluZTtcclxuXHJcbi8vIGF0dGFjaCBjb25maWdcclxudmFyIE1lbUFkYXB0b3IgPSByZXF1aXJlKFwiLi9kYXRhLXN0b3Jlcy9tZW0tYWRhcHRvclwiKTtcclxudmFyIEtleVZhbHVlU3RvcmUgPSByZXF1aXJlKFwiLi9kYXRhLXN0b3Jlcy9rZXktdmFsdWUtc3RvcmVcIik7XHJcblxyXG5saWZlTGluZS5jb25maWcgPSBuZXcgS2V5VmFsdWVTdG9yZShuZXcgTWVtQWRhcHRvcigpKTtcclxuIiwiLyoqXHJcbiAqIEtlZXAgYSBsaXN0IG9mIHN1YnNjcmlwdGlvbnMgdG8gdW5zdWJzY3JpYmUgZnJvbSB0b2dldGhlclxyXG4gKi9cclxuXHJcbmNsYXNzIERpc3Bvc2FibGUge1xyXG5cdGNvbnN0cnVjdG9yKCkge1xyXG5cdFx0dGhpcy5fc3Vic2NyaXB0aW9ucyA9IFtdO1xyXG5cdH1cclxuXHJcblx0Ly8gVW5zdWJzY3JpYmUgZnJvbSBhbGwgc3Vic2NyaXB0aW9uc1xyXG5cdGRpc3Bvc2UoKSB7XHJcblx0XHQvLyByZW1vdmUgdGhlIGZpcnN0IHN1YnNjcmlwdGlvbiB1bnRpbCB0aGVyZSBhcmUgbm9uZSBsZWZ0XHJcblx0XHR3aGlsZSh0aGlzLl9zdWJzY3JpcHRpb25zLmxlbmd0aCA+IDApIHtcclxuXHRcdFx0dGhpcy5fc3Vic2NyaXB0aW9ucy5zaGlmdCgpLnVuc3Vic2NyaWJlKCk7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHQvLyBBZGQgYSBzdWJzY3JpcHRpb24gdG8gdGhlIGRpc3Bvc2FibGVcclxuXHRhZGQoc3Vic2NyaXB0aW9uKSB7XHJcblx0XHR0aGlzLl9zdWJzY3JpcHRpb25zLnB1c2goc3Vic2NyaXB0aW9uKTtcclxuXHR9XHJcblxyXG5cdC8vIGRpc3Bvc2Ugd2hlbiBhbiBldmVudCBpcyBmaXJlZFxyXG5cdGRpc3Bvc2VPbihlbWl0dGVyLCBldmVudCkge1xyXG5cdFx0dGhpcy5hZGQoZW1pdHRlci5vbihldmVudCwgKCkgPT4gdGhpcy5kaXNwb3NlKCkpKTtcclxuXHR9XHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IERpc3Bvc2FibGU7XHJcbiIsIi8qKlxyXG4gKiBBIGJhc2ljIGV2ZW50IGVtaXR0ZXJcclxuICovXHJcblxyXG5jbGFzcyBFdmVudEVtaXR0ZXIge1xyXG5cdGNvbnN0cnVjdG9yKCkge1xyXG5cdFx0dGhpcy5fbGlzdGVuZXJzID0ge307XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBBZGQgYW4gZXZlbnQgbGlzdGVuZXJcclxuXHQgKi9cclxuXHRvbihuYW1lLCBsaXN0ZW5lcikge1xyXG5cdFx0Ly8gaWYgd2UgZG9uJ3QgaGF2ZSBhbiBleGlzdGluZyBsaXN0ZW5lcnMgYXJyYXkgY3JlYXRlIG9uZVxyXG5cdFx0aWYoIXRoaXMuX2xpc3RlbmVyc1tuYW1lXSkge1xyXG5cdFx0XHR0aGlzLl9saXN0ZW5lcnNbbmFtZV0gPSBbXTtcclxuXHRcdH1cclxuXHJcblx0XHQvLyBhZGQgdGhlIGxpc3RlbmVyXHJcblx0XHR0aGlzLl9saXN0ZW5lcnNbbmFtZV0ucHVzaChsaXN0ZW5lcik7XHJcblxyXG5cdFx0Ly8gZ2l2ZSB0aGVtIGEgc3Vic2NyaXB0aW9uXHJcblx0XHRyZXR1cm4ge1xyXG5cdFx0XHRfbGlzdGVuZXI6IGxpc3RlbmVyLFxyXG5cclxuXHRcdFx0dW5zdWJzY3JpYmU6ICgpID0+IHtcclxuXHRcdFx0XHQvLyBmaW5kIHRoZSBsaXN0ZW5lclxyXG5cdFx0XHRcdHZhciBpbmRleCA9IHRoaXMuX2xpc3RlbmVyc1tuYW1lXS5pbmRleE9mKGxpc3RlbmVyKTtcclxuXHJcblx0XHRcdFx0aWYoaW5kZXggIT09IC0xKSB7XHJcblx0XHRcdFx0XHR0aGlzLl9saXN0ZW5lcnNbbmFtZV0uc3BsaWNlKGluZGV4LCAxKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBFbWl0IGFuIGV2ZW50XHJcblx0ICovXHJcblx0ZW1pdChuYW1lLCAuLi5hcmdzKSB7XHJcblx0XHQvLyBjaGVjayBmb3IgbGlzdGVuZXJzXHJcblx0XHRpZih0aGlzLl9saXN0ZW5lcnNbbmFtZV0pIHtcclxuXHRcdFx0Zm9yKGxldCBsaXN0ZW5lciBvZiB0aGlzLl9saXN0ZW5lcnNbbmFtZV0pIHtcclxuXHRcdFx0XHQvLyBjYWxsIHRoZSBsaXN0ZW5lcnNcclxuXHRcdFx0XHRsaXN0ZW5lciguLi5hcmdzKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogRW1pdCBhbiBldmVudCBhbmQgc2tpcCBzb21lIGxpc3RlbmVyc1xyXG5cdCAqL1xyXG5cdHBhcnRpYWxFbWl0KG5hbWUsIHNraXBzID0gW10sIC4uLmFyZ3MpIHtcclxuXHRcdC8vIGFsbG93IGEgc2luZ2xlIGl0ZW1cclxuXHRcdGlmKCFBcnJheS5pc0FycmF5KHNraXBzKSkge1xyXG5cdFx0XHRza2lwcyA9IFtza2lwc107XHJcblx0XHR9XHJcblxyXG5cdFx0Ly8gY2hlY2sgZm9yIGxpc3RlbmVyc1xyXG5cdFx0aWYodGhpcy5fbGlzdGVuZXJzW25hbWVdKSB7XHJcblx0XHRcdGZvcihsZXQgbGlzdGVuZXIgb2YgdGhpcy5fbGlzdGVuZXJzW25hbWVdKSB7XHJcblx0XHRcdFx0Ly8gdGhpcyBldmVudCBsaXN0ZW5lciBpcyBiZWluZyBza2lwZWRcclxuXHRcdFx0XHRpZihza2lwcy5maW5kKHNraXAgPT4gc2tpcC5fbGlzdGVuZXIgPT0gbGlzdGVuZXIpKSB7XHJcblx0XHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdC8vIGNhbGwgdGhlIGxpc3RlbmVyc1xyXG5cdFx0XHRcdGxpc3RlbmVyKC4uLmFyZ3MpO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcclxuIl19
