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

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

exports.store = store;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/**
 * Work with data stores
 */

var DEBOUNCE_TIME = 2000;
var DATA_STORE_ROOT = "/api/data/";

var idb = require("idb");

// cache data store instances
var stores = {};

// get/create a datastore
function store(name) {
	// use the cached store
	if (name in stores) {
		return stores[name];
	}

	var store = new Store(name);

	// cache the data store instance
	stores[name] = store;

	// tell any listeners the store has been created
	lifeLine.emit("data-store-created", store);

	return store;
};

var Store = function (_lifeLine$EventEmitte) {
	_inherits(Store, _lifeLine$EventEmitte);

	function Store(name) {
		_classCallCheck(this, Store);

		var _this = _possibleConstructorReturn(this, (Store.__proto__ || Object.getPrototypeOf(Store)).call(this));

		_this.name = name;
		_this._cache = {};
		// don't send duplicate requests
		_this._requesting = [];
		// promise for the database
		_this._db = idb.open("data-stores", 2, function (db) {
			// upgrade or create the db
			if (db.oldVersion < 1) db.createObjectStore("assignments", { keyPath: "id" });
			if (db.oldVersion < 2) db.createObjectStore("sync-store", { keyPath: "id" });
		});
		return _this;
	}

	// set the function to deserialize all data from the server


	_createClass(Store, [{
		key: "setInit",
		value: function setInit(fn) {
			this._deserializer = fn;
		}

		// get all the items and listen for any changes

	}, {
		key: "getAll",
		value: function getAll(fn) {
			var _this2 = this;

			if (!fn) {
				// load items from idb
				return this._db.then(function (db) {
					return db.transaction(_this2.name).objectStore(_this2.name).getAll();
				});
			}

			// go to the cache first
			fn(arrayFromObject(this._cache));

			// load items from idb
			this._db.then(function (db) {
				db.transaction(_this2.name).objectStore(_this2.name).getAll().then(function (all) {
					// store items in the cache
					var _iteratorNormalCompletion = true;
					var _didIteratorError = false;
					var _iteratorError = undefined;

					try {
						for (var _iterator = all[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
							var item = _step.value;

							_this2._cache[item.id] = item;
						}

						// notify listeners we loaded the data
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

					_this2.emit("change");
				});
			});

			// listen for any changes
			return this.on("change", function () {
				// the changes will we in the cache
				fn(arrayFromObject(_this2._cache));
			});
		}

		// get a single item and listen for changes

	}, {
		key: "get",
		value: function get(id, fn) {
			var _this3 = this;

			// just load the value from idb
			if (!fn) {
				// hit the cache
				if (this._cache[id]) return Promise.resolve(this._cache[id]);

				// hit idb
				return this._db.then(function (db) {
					return db.transaction(_this3.name).objectStore(_this3.name).get(id).then(function (item) {
						if (typeof _this3._deserializer == "function") {
							return _this3._deserializer(item) || item;
						}

						return item;
					});
				});
			}

			// go to the cache first
			fn(this._cache[id]);

			// load the item from idb
			this._db.then(function (db) {
				db.transaction(_this3.name).objectStore(_this3.name).get(id).then(function (item) {
					if (item) {
						// store item in the cache
						_this3._cache[item.id] = item;

						// notify listeners we loaded the data
						_this3.emit("change");
					}
				});
			});

			// listen for any changes
			return this.on("change", function () {
				fn(_this3._cache[id]);
			});
		}

		// store a value in the store

	}, {
		key: "set",
		value: function set(value, skips) {
			var _this4 = this;

			var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

			var isNew = !!this._cache[value.id];

			// deserialize
			if (typeof this._deserializer == "function") {
				value = this._deserializer(value) || value;
			}

			// store the value in the cache
			this._cache[value.id] = value;

			// save the item
			var save = function () {
				// save the item in the db
				_this4._db.then(function (db) {
					db.transaction(_this4.name, "readwrite").objectStore(_this4.name).put(value);
				});

				// sync the changes to the server
				_this4.partialEmit("sync-put", skips, value, isNew);
			};

			// emit a change
			this.partialEmit("change", skips);

			// don't wait to send the changes to the server
			if (opts.saveNow) return save();else debounce(this.name + "/" + value.id, save);
		}

		// remove a value from the store

	}, {
		key: "remove",
		value: function remove(id, skips) {
			var _this5 = this;

			// remove the value from the cache
			delete this._cache[id];

			// emit a change
			this.partialEmit("change", skips);

			// sync the changes to the server
			this.partialEmit("sync-delete", skips, id);

			// delete the item
			return this._db.then(function (db) {
				return db.transaction(_this5.name, "readwrite").objectStore(_this5.name).delete(id);
			});
		}

		// force saves to go through

	}, {
		key: "forceSave",
		value: function forceSave() {
			var _this6 = this;

			var _iteratorNormalCompletion2 = true;
			var _didIteratorError2 = false;
			var _iteratorError2 = undefined;

			try {
				for (var _iterator2 = Object.getOwnPropertyNames(debounceTimers)[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
					var timer = _step2.value;

					// only save items from this data store
					if (timer.indexOf(this.name + "/") === 0) {
						continue;
					}

					// look up the timer id
					var id = timer.substr(timer.indexOf("/") + 1);
					var value = this._cache[id];

					// clear the timer
					clearTimeout(timer);

					// remove the timer from the list
					delete debounceTimers[timer];

					// don't save on delete
					if (!value) return;

					// save the item in the db
					this._db.then(function (db) {
						db.transaction(_this6.name, "readwrite").objectStore(_this6.name).put(value);
					});

					// sync the changes to the server
					this.emit("sync-put", value);
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
	}]);

	return Store;
}(lifeLine.EventEmitter);

// get an array from an object


var arrayFromObject = function (obj) {
	return Object.getOwnPropertyNames(obj).map(function (name) {
		return obj[name];
	});
};

// don't call a function too often
var debounceTimers = {};

var debounce = function (id, fn) {
	// cancel the previous delay
	clearTimeout(debounceTimers[id]);
	// start a new delay
	debounceTimers[id] = setTimeout(fn, DEBOUNCE_TIME);
};

},{"idb":1}],4:[function(require,module,exports){
"use strict";

/**
 * Browser specific globals
 */

lifeLine.makeDom = require("./util/dom-maker").default;
lifeLine.syncer = require("./syncer").syncer;

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

},{"./syncer":6,"./util/dom-maker":8}],5:[function(require,module,exports){
"use strict";

require("../common/global");

require("./global");

require("./widgets/sidebar");

require("./widgets/content");

require("./widgets/link");

require("./widgets/list");

require("./widgets/input");

require("./widgets/toggle-btns");

var _lists = require("./views/lists");

require("./views/item");

require("./views/edit");

require("./views/login");

require("./views/account");

require("./views/users");

require("./views/todo");

var _dataStore = require("./data-store");

// load all the views


// load all the widgets
// create the global object
(0, _dataStore.store)("assignments").setInit(function (item) {
	// parse the date
	if (typeof item.date == "string") {
		item.date = new Date(item.date);
	}
});

// instantiate the dom


// set up the data store
lifeLine.makeDom({
	parent: document.body,
	group: [{ widget: "sidebar" }, { widget: "content" }]
});

// Add a link to the toda/home page
lifeLine.addNavCommand("Todo", "/");

// add list views to the navbar
(0, _lists.initNavBar)();

// create a new assignment
lifeLine.addCommand("New assignment", function () {
	var id = Math.floor(Math.random() * 100000000);

	lifeLine.nav.navigate("/edit/" + id);
});

// create the logout button
lifeLine.addNavCommand("Account", "/account");

},{"../common/global":25,"./data-store":3,"./global":4,"./views/account":9,"./views/edit":10,"./views/item":11,"./views/lists":12,"./views/login":13,"./views/todo":14,"./views/users":15,"./widgets/content":16,"./widgets/input":17,"./widgets/link":18,"./widgets/list":19,"./widgets/sidebar":20,"./widgets/toggle-btns":21}],6:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.syncer = undefined;

var _dataStore = require("./data-store");

function _toArray(arr) { return Array.isArray(arr) ? arr : Array.from(arr); } /**
                                                                               * Syncronize this client with the server
                                                                               */

window.syncStore = (0, _dataStore.store)("sync-store");

var STORES = ["assignments"];

// create the global syncer refrence
var syncer = exports.syncer = new lifeLine.EventEmitter();

// save subscriptions to data store sync events so we dont trigger our self when we sync
var syncSubs = [];

// don't sync while we are syncing
var isSyncing = false;
var syncAgain = false;

// add a change to the sync queue
var enqueueChange = function (change) {
	// load the queue
	return syncStore.get("change-queue").then(function () {
		var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
		    _ref$changes = _ref.changes,
		    changes = _ref$changes === undefined ? [] : _ref$changes;

		// get the id for the change
		var chId = change.type == "delete" ? change.id : change.data.id;

		var existing = changes.findIndex(function (ch) {
			return ch.type == "delete" ? ch.id == chId : ch.data.id == chId;
		});

		// remove the existing change
		if (existing !== -1) {
			changes.splice(existing, 1);
		}

		// add the change to the queue
		changes.push(change);

		// save the queue
		return syncStore.set({
			id: "change-queue",
			changes: changes
		});
	})

	// sync when idle
	.then(function () {
		return idle(syncer.sync);
	});
};

// add a sync listener to a data store
var onSync = function (ds, name, fn) {
	syncSubs.push(ds.on("sync-" + name, fn));
};

// when a data store is opened listen for changes
lifeLine.on("data-store-created", function (ds) {
	// don't sync the sync store
	if (ds.name == "sync-store") return;

	// create and enqueue a put change
	onSync(ds, "put", function (value, isNew) {
		enqueueChange({
			store: ds.name,
			type: isNew ? "create" : "put",
			data: value
		});
	});

	// create and enqueue a delete change
	onSync(ds, "delete", function (id) {
		enqueueChange({
			store: ds.name,
			type: "delete",
			id: id,
			timestamp: Date.now()
		});
	});
});

// wait for some idle time
var idle = function (fn) {
	if (typeof requestIdleCallback == "function") {
		requestIdleCallback(fn);
	} else {
		setTimeout(fn, 100);
	}
};

// sync with the server
syncer.sync = function () {
	// don't sync while offline
	if (navigator.online) {
		return;
	}

	// only do one sync at a time
	if (isSyncing) {
		syncAgain = true;
		return;
	}

	isSyncing = true;

	console.log("Sync start");

	// load the change queue
	var promises = [syncStore.get("change-queue").then(function () {
		var _ref2 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
		    _ref2$changes = _ref2.changes,
		    changes = _ref2$changes === undefined ? [] : _ref2$changes;

		return changes;
	})];

	// load all ids

	var _loop = function (storeName) {
		promises.push((0, _dataStore.store)(storeName).getAll().then(function (items) {
			var dates = {};

			// map modified date to the id
			items.forEach(function (item) {
				return dates[item.id] = item.modified;
			});

			return [storeName, dates];
		}));
	};

	var _iteratorNormalCompletion = true;
	var _didIteratorError = false;
	var _iteratorError = undefined;

	try {
		for (var _iterator = STORES[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
			var storeName = _step.value;

			_loop(storeName);
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

	Promise.all(promises).then(function (_ref3) {
		var _ref4 = _toArray(_ref3),
		    changes = _ref4[0],
		    modifieds = _ref4.slice(1);

		// convert modifieds to an object
		var modifiedsObj = {};

		modifieds.forEach(function (modified) {
			return modifiedsObj[modified[0]] = modified[1];
		});

		// send the changes to the server
		return fetch("/api/data/", {
			method: "POST",
			credentials: "include",
			body: JSON.stringify({
				changes: changes,
				modifieds: modifiedsObj
			})
		});
	})

	// parse the body
	.then(function (res) {
		return res.json();
	})

	// catch any network errors
	.catch(function () {
		return { status: "fail", data: { reason: "network-error" } };
	}).then(function (_ref5) {
		var status = _ref5.status,
		    results = _ref5.data,
		    reason = _ref5.reason;

		// catch any error
		if (status == "fail") {
			// log the user in
			if (results.reason == "logged-out") {
				lifeLine.nav.navigate("/login");
			}

			return;
		}

		// clear the change queue
		results.unshift(syncStore.set({
			id: "change-queue",
			changes: []
		}));

		// apply the results
		return Promise.all(results.map(function (result, index) {
			// first result is the promise to reset the change queue
			if (index === 0) return result;
			console.log(result);

			// delete the local copy
			if (result.code == "item-deleted") {
				var store = (0, _dataStore.store)(result.store);

				return store.remove(result.id, syncSubs);
			}
			// save the newer version from the server
			else if (result.code == "newer-version") {
					var _store = (0, _dataStore.store)(result.store);

					return _store.set(result.data, syncSubs, { saveNow: true });
				}
		}));
	}).then(function () {
		// release the lock
		isSyncing = false;

		// there was an attempt to sync while we where syncing
		if (syncAgain) {
			syncAgain = false;

			idle(syncer.sync);
		}

		console.log("Sync complete");
	});
};

// don't add event listeners in the service worker
if (typeof window == "function") {
	// when we come back on line sync
	window.addEventListener("online", function () {
		return syncer.sync();
	});

	// when the user navigates back sync
	window.addEventListener("visibilitychange", function () {
		if (!document.hidden) {
			syncer.sync();
		}
	});
}

},{"./data-store":3}],7:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isSameDate = isSameDate;
exports.isSoonerDate = isSoonerDate;
exports.daysFromNow = daysFromNow;
exports.stringifyDate = stringifyDate;
exports.isSkipTime = isSkipTime;
exports.stringifyTime = stringifyTime;
/**
 * Date related tools
 */

// check if the dates are the same day
function isSameDate(date1, date2) {
  return date1.getFullYear() == date2.getFullYear() && date1.getMonth() == date2.getMonth() && date1.getDate() == date2.getDate();
};

// check if a date is less than another
function isSoonerDate(date1, date2) {
  // check the year first
  if (date1.getFullYear() != date2.getFullYear()) {
    return date1.getFullYear() < date2.getFullYear();
  }

  // check the month next
  if (date1.getMonth() != date2.getMonth()) {
    return date1.getMonth() < date2.getMonth();
  }

  // check the day
  return date1.getDate() < date2.getDate();
};

// get the date days from now
function daysFromNow(days) {
  var date = new Date();

  // advance the date
  date.setDate(date.getDate() + days);

  return date;
};

var STRING_DAYS = ["Sunday", "Monday", "Tuesday", "Wedensday", "Thursday", "Friday", "Saturday"];

// convert a date to a string
function stringifyDate(date) {
  var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  var strDate,
      strTime = "";

  // check if the date is before today
  var beforeNow = date.getTime() < Date.now();

  // Today
  if (isSameDate(date, new Date())) strDate = "Today";

  // Tomorrow
  else if (isSameDate(date, daysFromNow(1)) && !beforeNow) strDate = "Tomorrow";

    // day of the week (this week)
    else if (isSoonerDate(date, daysFromNow(7)) && !beforeNow) strDate = STRING_DAYS[date.getDay()];

      // print the date
      else strDate = STRING_DAYS[date.getDay()] + " " + (date.getMonth() + 1) + "/" + date.getDate();

  // add the time on
  if (opts.includeTime && !isSkipTime(date, opts.skipTimes)) {
    return strDate + ", " + stringifyTime(date);
  }

  return strDate;
};

// check if this is one of the given skip times
function isSkipTime(date) {
  var skips = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

  return skips.find(function (skip) {
    return skip.hour === date.getHours() && skip.minute === date.getMinutes();
  });
};

// convert a time to a string
function stringifyTime(date) {
  var hour = date.getHours();

  // get the am/pm time
  var isAm = hour < 12;

  // midnight
  if (hour === 0) hour = 12;
  // after noon
  if (hour > 12) hour = hour - 12;

  var minute = date.getMinutes();

  // add a leading 0
  if (minute < 10) minute = "0" + minute;

  return hour + ":" + minute + (isAm ? "am" : "pm");
}

},{}],8:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.default = make;
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

function make(opts) {
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

},{}],9:[function(require,module,exports){
"use strict";

var _backup = require("../../common/backup");

lifeLine.nav.register({
	matcher: /^(?:\/user\/(.+?)|\/account)$/,

	make: function (_ref) {
		var setTitle = _ref.setTitle,
		    content = _ref.content,
		    match = _ref.match;

		setTitle("Account");

		var url = "/api/auth/info/get";

		// add the username if one is given
		if (match[1]) url += "?username=" + match[1];

		// load the user data
		fetch(url, { credentials: "include" }).then(function (res) {
			return res.json();
		}).then(function (res) {
			// no such user or access is denied
			if (res.status == "fail") {
				lifeLine.makeDom({
					parent: content,
					classes: "content-padded",
					text: "Could not access the user you were looking for"
				});

				return;
			}

			var user = res.data;

			// generate the page
			var children = [];

			children.push({
				tag: "h2",
				text: user.username
			});

			// display the admin status of another user
			if (match[1]) {
				children.push({
					text: user.username + " is " + (user.admin ? "" : "not") + " an admin"
				});
			}
			// display the admin status of this user
			else {
					children.push({
						text: "You are " + (user.admin ? "" : "not") + " an admin"
					});

					// add a link at a list of all users
					if (user.admin) {
						children.push({ tag: "br" });

						children.push({
							widget: "link",
							href: "/users",
							text: "View all users"
						});
					}
				}

			// create a backup link
			if (!match[1]) {
				children.push({ tag: "br" });
				children.push({ tag: "br" });

				children.push({
					tag: "a",
					text: "Download backup",
					attrs: {
						href: "/api/backup",
						download: (0, _backup.genBackupName)()
					}
				});
			}

			var passwordChange = {};

			children.push({
				tag: "form",
				children: [{
					classes: "editor-row",
					children: [{
						widget: "input",
						type: "password",
						placeholder: "Old password",
						bind: passwordChange,
						prop: "oldPassword"
					}, {
						widget: "input",
						type: "password",
						placeholder: "New password",
						bind: passwordChange,
						prop: "password"
					}]
				}, {
					tag: "button",
					classes: "fancy-button",
					text: "Change password",
					attrs: {
						type: "submit"
					}
				}, {
					name: "msg"
				}],
				on: {
					// change the password
					submit: function (e) {
						e.preventDefault();

						// no password supplied
						if (!passwordChange.password) {
							showMsg("Enter a new password");
							return;
						}

						// send the password change request
						fetch("/api/auth/info/set?username=" + user.username, {
							credentials: "include",
							method: "POST",
							body: JSON.stringify(passwordChange)
						}).then(function (res) {
							return res.json();
						}).then(function (res) {
							// password change failed
							if (res.status == "fail") {
								showMsg(res.data.msg);
							}

							if (res.status == "success") {
								showMsg("Password changed");
							}
						});
					}
				}
			});

			children.push({ tag: "br" });
			children.push({ tag: "br" });

			// only display the logout button if we are on the /account page
			if (!match[1]) {
				children.push({
					tag: "button",
					classes: "fancy-button",
					text: "Logout",
					on: {
						click: function () {
							// send the logout request
							fetch("/api/auth/logout", { credentials: "include" })

							// return to the login page
							.then(function () {
								return lifeLine.nav.navigate("/login");
							});
						}
					}
				});
			}

			var _lifeLine$makeDom = lifeLine.makeDom({
				parent: content,
				classes: "content-padded",
				children: children
			}),
			    msg = _lifeLine$makeDom.msg;

			// show a message


			var showMsg = function (text) {
				msg.innerText = text;
			};
		});
	}
}); /**
     * A view for accessing/modifying information about the current user
     */

},{"../../common/backup":22}],10:[function(require,module,exports){
"use strict";

var _date = require("../util/date");

var _dataStore = require("../data-store");

/**
 * Edit an assignemnt
 */

var assignments = (0, _dataStore.store)("assignments");

lifeLine.nav.register({
	matcher: /^\/edit\/(.+?)$/,

	make: function (_ref) {
		var match = _ref.match,
		    content = _ref.content,
		    setTitle = _ref.setTitle,
		    disposable = _ref.disposable;

		var actionSub, deleteSub;

		// push the changes through when the page is closed
		disposable.add({
			unsubscribe: function () {
				return assignments.forceSave();
			}
		});

		var changeSub = assignments.get(match[1], function (item) {
			// clear the content
			content.innerHTML = "";

			// remove the previous action
			if (actionSub) {
				actionSub.unsubscribe();
				deleteSub.unsubscribe();
			}

			// add a button back to the view
			if (item) {
				actionSub = lifeLine.addAction("View", function () {
					return lifeLine.nav.navigate("/item/" + item.id);
				});

				deleteSub = lifeLine.addAction("Delete", function () {
					// remove the item
					assignments.remove(item.id);

					// navigate away
					lifeLine.nav.navigate("/");
				});
			}

			// if the item does not exist create it
			if (!item) {
				item = {
					name: "Unnamed item",
					class: "Class",
					date: genDate(),
					id: match[1],
					description: "",
					modified: Date.now(),
					type: "assignment"
				};
			}

			// set the inital title
			setTitle("Editing");

			// save changes
			var change = function () {
				// update the modified date
				item.modified = Date.now();

				// find the date and time inputs
				var dateInput = document.querySelector("input[type=date]");
				var timeInput = document.querySelector("input[type=time]");

				// parse the date
				item.date = new Date(dateInput.value + " " + timeInput.value);

				// remove assignemnt fields from tasks
				if (item.type == "task") {
					delete item.date;
					delete item.class;
				}

				// add a button back to the view
				if (!actionSub) {
					actionSub = lifeLine.addAction("View", function () {
						return lifeLine.nav.navigate("/item/" + item.id);
					});

					deleteSub = lifeLine.addAction("Delete", function () {
						// remove the item
						assignments.remove(item.id);

						// navigate away
						lifeLine.nav.navigate("/");
					});
				}

				// save the changes
				assignments.set(item, changeSub);
			};

			// hide and show specific fields for different assignment types
			var toggleFields = function () {
				if (item.type == "task") {
					mapped.classField.style.display = "none";
					mapped.dateField.style.display = "none";
				} else {
					mapped.classField.style.display = "";
					mapped.dateField.style.display = "";
				}

				// fill in date if it is missing
				if (!item.date) {
					item.date = genDate();
				}

				if (!item.class) {
					item.class = "Class";
				}
			};

			// render the ui
			var mapped = lifeLine.makeDom({
				parent: content,
				group: [{
					classes: "editor-row",
					children: [{
						widget: "input",
						bind: item,
						prop: "name",
						change: change
					}]
				}, {
					classes: "editor-row",
					children: [{
						widget: "toggle-btns",
						btns: [{ text: "Assignment", value: "assignment" }, { text: "Task", value: "task" }],
						value: item.type,
						change: function (type) {
							// update the item type
							item.type = type;

							// hide/show specific fields
							toggleFields();

							// emit the change
							change();
						}
					}]
				}, {
					name: "classField",
					classes: "editor-row",
					children: [{
						widget: "input",
						bind: item,
						prop: "class",
						change: change
					}]
				}, {
					name: "dateField",
					classes: "editor-row",
					children: [{
						widget: "input",
						type: "date",
						value: item.date && item.date.getFullYear() + "-" + pad(item.date.getMonth() + 1) + "-" + pad(item.date.getDate()),
						change: change
					}, {
						widget: "input",
						type: "time",
						value: item.date && item.date.getHours() + ":" + pad(item.date.getMinutes()),
						change: change
					}]
				}, {
					classes: "textarea-wrapper",
					children: [{
						widget: "input",
						tag: "textarea",
						classes: "textarea-fill",
						placeholder: "Description",
						bind: item,
						prop: "description",
						change: change
					}]
				}]
			});

			// show the fields for this item type
			toggleFields();
		});

		// remove the subscription when this view is destroyed
		disposable.add(changeSub);
	}
});

// add a leading 0 if a number is less than 10
var pad = function (number) {
	return number < 10 ? "0" + number : number;
};

// create a date of today at 11:59pm
var genDate = function () {
	var date = new Date();

	// set the time
	date.setHours(23);
	date.setMinutes(59);

	return date;
};

},{"../data-store":3,"../util/date":7}],11:[function(require,module,exports){
"use strict";

var _date = require("../util/date");

var _dataStore = require("../data-store");

/**
 * The view for an assignment
 */

var assignments = (0, _dataStore.store)("assignments");

lifeLine.nav.register({
	matcher: /^\/item\/(.+?)$/,

	make: function (_ref) {
		var match = _ref.match,
		    setTitle = _ref.setTitle,
		    content = _ref.content,
		    disposable = _ref.disposable;

		var actionDoneSub, actionEditSub;

		disposable.add(assignments.get(match[1], function (item) {
			// clear the content
			content.innerHTML = "";

			// remove the old action
			if (actionDoneSub) {
				actionDoneSub.unsubscribe();
				actionEditSub.unsubscribe();
			}

			// no such assignment
			if (!item) {
				setTitle("Not found");

				lifeLine.makeDom({
					parent: content,
					classes: "content-padded",
					children: [{
						tag: "span",
						text: "The assignment you where looking for could not be found. "
					}, {
						widget: "link",
						href: "/",
						text: "Go home."
					}]
				});

				return;
			}

			// set the title for the content
			setTitle("Assignment");

			// mark the item as done
			actionDoneSub = lifeLine.addAction(item.done ? "Done" : "Not done", function () {
				// mark the item done
				item.done = !item.done;

				// update the modified time
				item.modified = Date.now();

				// save the change
				assignments.set(item, [], { saveNow: true });
			});

			// edit the item
			actionEditSub = lifeLine.addAction("Edit", function () {
				return lifeLine.nav.navigate("/edit/" + item.id);
			});

			// times to skip
			var skipTimes = [{ hour: 23, minute: 59 }];

			lifeLine.makeDom({
				parent: content,
				classes: "content-padded",
				children: [{
					classes: "assignment-name",
					text: item.name
				}, {
					classes: "assignment-info-row",
					children: [{
						classes: "assignment-info-grow",
						text: item.class
					}, {
						text: item.date && (0, _date.stringifyDate)(item.date, { includeTime: true, skipTimes: skipTimes })
					}]
				}, {
					classes: "assignment-description",
					text: item.description
				}]
			});
		}));
	}
});

},{"../data-store":3,"../util/date":7}],12:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.initNavBar = initNavBar;

var _date = require("../util/date");

var _dataStore = require("../data-store");

/**
 * Display a list of upcomming assignments
 */

var assignments = (0, _dataStore.store)("assignments");

// all the different lists
var LISTS = [{
	url: "/week",
	title: "This week",
	createCtx: function () {
		return {
			// days to the end of this week
			endDate: (0, _date.daysFromNow)(7 - new Date().getDay()),
			// todays date
			today: new Date()
		};
	},
	// show all at reasonable number of incomplete assignments
	filter: function (item, _ref) {
		var today = _ref.today,
		    endDate = _ref.endDate;

		// already done
		if (item.done) return;

		// show all tasks
		if (item.type == "task") return true;

		// check if the item is past this week
		if (!(0, _date.isSoonerDate)(item.date, endDate) && !(0, _date.isSameDate)(item.date, endDate)) return;

		// check if the date is before today
		if ((0, _date.isSoonerDate)(item.date, today)) return;

		return true;
	}
}, {
	url: "/upcoming",
	filter: function (item) {
		return !item.done;
	},
	title: "Upcoming"
}, {
	url: "/done",
	filter: function (item) {
		return item.done;
	},
	title: "Done"
}];

// add list view links to the navbar
function initNavBar() {
	LISTS.forEach(function (list) {
		return lifeLine.addNavCommand(list.title, list.url);
	});
};

lifeLine.nav.register({
	matcher: function (url) {
		return LISTS.find(function (list) {
			return list.url == url;
		});
	},


	// make the list
	make: function (_ref2) {
		var setTitle = _ref2.setTitle,
		    content = _ref2.content,
		    disposable = _ref2.disposable,
		    match = _ref2.match;

		disposable.add(assignments.getAll(function (data) {
			// clear the content
			content.innerHTML = "";

			// set the page title
			setTitle(match.title);

			// the context for the filter function
			var ctx;

			if (match.createCtx) {
				ctx = match.createCtx();
			}

			// run the filter function
			data = data.filter(function (item) {
				return match.filter(item, ctx);
			});

			// sort the assingments
			data.sort(function (a, b) {
				// tasks are below assignments
				if (a.type == "task" && b.type != "task") return 1;
				if (a.type != "task" && b.type == "task") return -1;
				//if(a.type == "task" || b.type == "task") return 0;

				// sort by due date
				if (a.type == "assignment" && b.type == "assignment") {
					if (a.date.getTime() != b.date.getTime()) {
						return a.date.getTime() - b.date.getTime();
					}
				}

				// order by name
				if (a.name < b.name) return -1;
				if (a.name > b.name) return 1;

				return 0;
			});

			// make the groups
			var groups = {};

			// render the list
			data.forEach(function (item, i) {
				// get the header name
				var dateStr = item.type == "task" ? "Tasks" : (0, _date.stringifyDate)(item.date);

				// make sure the header exists
				groups[dateStr] || (groups[dateStr] = []);

				// add the item to the list
				var items = [{ text: item.name, grow: true }];

				if (item.type != "task") {
					// show the end time for any non 11:59pm times
					if (item.date.getHours() != 23 || item.date.getMinutes() != 59) {
						items.push((0, _date.stringifyTime)(item.date));
					}

					// show the class
					items.push(item.class);
				}

				groups[dateStr].push({
					href: "/item/" + item.id,
					items: items
				});
			});

			// display all items
			lifeLine.makeDom({
				parent: content,
				widget: "list",
				items: groups
			});
		}));
	}
});

},{"../data-store":3,"../util/date":7}],13:[function(require,module,exports){
"use strict";

/**
 * Show a login button to the user
 */

lifeLine.nav.register({
	matcher: "/login",

	make: function (_ref) {
		var setTitle = _ref.setTitle,
		    content = _ref.content;

		// set the page title
		setTitle("Login");

		// the users credentials
		var auth = {};

		// create the login form

		var _lifeLine$makeDom = lifeLine.makeDom({
			parent: content,
			tag: "form",
			classes: "content-padded",
			children: [{
				classes: "editor-row",
				children: [{
					widget: "input",
					bind: auth,
					prop: "username",
					placeholder: "Username"
				}]
			}, {
				classes: "editor-row",
				children: [{
					widget: "input",
					bind: auth,
					prop: "password",
					type: "password",
					placeholder: "Password"
				}]
			}, {
				tag: "button",
				text: "Login",
				classes: "fancy-button",
				attrs: {
					type: "submit"
				}
			}, {
				classes: "error-msg",
				name: "msg"
			}],
			on: {
				submit: function (e) {
					e.preventDefault();

					// send the login request
					fetch("/api/auth/login", {
						method: "POST",
						credentials: "include",
						body: JSON.stringify(auth)
					})

					// parse the json
					.then(function (res) {
						return res.json();
					})

					// process the response
					.then(function (res) {
						// login suceeded go home
						if (res.status == "success") {
							lifeLine.nav.navigate("/");
							return;
						}

						// login failed
						if (res.status == "fail") {
							errorMsg("Login failed");
						}
					});
				}
			}
		}),
		    username = _lifeLine$makeDom.username,
		    password = _lifeLine$makeDom.password,
		    msg = _lifeLine$makeDom.msg;

		// display an error message


		var errorMsg = function (text) {
			msg.innerText = text;
		};
	}
});

// logout
lifeLine.logout = function () {
	// send the logout request
	fetch("/api/auth/logout", {
		credentials: "include"
	})

	// go to the login page
	.then(function () {
		return lifeLine.nav.navigate("/login");
	});
};

},{}],14:[function(require,module,exports){
"use strict";

var _date = require("../util/date");

var _dataStore = require("../data-store");

/**
 * A list of things todo
 */

var assignments = (0, _dataStore.store)("assignments");

lifeLine.nav.register({
	matcher: "/",

	make: function (_ref) {
		var setTitle = _ref.setTitle,
		    content = _ref.content,
		    disposable = _ref.disposable;

		setTitle("Todo");

		// load the items
		disposable.add(assignments.getAll(function (data) {
			// clear the old content
			content.innerHTML = "";

			var groups = {
				Tasks: [],
				Today: [],
				Tomorrow: []
			};

			// today and tomorrows dates
			var today = new Date();
			var tomorrow = (0, _date.daysFromNow)(1);

			// select the items to display
			data.forEach(function (item) {
				// skip completed items
				if (item.done) return;

				// assignments for today
				if (item.type == "assignment") {
					// today
					if ((0, _date.isSameDate)(today, item.date)) {
						groups.Today.push(createUi(item));
					}
					// tomorrow
					else if ((0, _date.isSameDate)(tomorrow, item.date)) {
							groups.Tomorrow.push(createUi(item));
						}
				}

				// show any tasks
				if (item.type == "task") {
					groups.Tasks.push(createUi(item));
				}
			});

			// remove any empty fields
			Object.getOwnPropertyNames(groups).forEach(function (name) {
				// remove empty groups
				if (groups[name].length === 0) {
					delete groups[name];
				}
			});

			// render the list
			lifeLine.makeDom({
				parent: content,
				widget: "list",
				items: groups
			});
		}));
	}
});

// create a list item
var createUi = function (item) {
	// render a task
	if (item.type == "task") {
		return {
			href: "/item/" + item.id,
			items: [{
				text: item.name,
				grow: true
			}]
		};
	}
	// render an item
	else {
			return {
				href: "/item/" + item.id,
				items: [{
					text: item.name,
					grow: true
				}, (0, _date.stringifyTime)(item.date), item.class]
			};
		}
};

},{"../data-store":3,"../util/date":7}],15:[function(require,module,exports){
"use strict";

/**
 * A page with links to all users
 */

lifeLine.nav.register({
	matcher: "/users",

	make: function (_ref) {
		var setTitle = _ref.setTitle,
		    content = _ref.content;

		setTitle("All users");

		// load the list of users
		fetch("/api/auth/info/users", {
			credentials: "include"
		}).then(function (res) {
			return res.json();
		}).then(function (_ref2) {
			var status = _ref2.status,
			    users = _ref2.data;

			// not authenticated
			if (status == "fail") {
				lifeLine.makeDom({
					parent: content,
					classes: "content-padded",
					text: "You do not have access to the user list"
				});

				return;
			}

			// sort by admin status
			users.sort(function (a, b) {
				// sort admins
				if (a.admin && !b.admin) return -1;
				if (!a.admin && b.admin) return 1;

				// sort by username
				if (a.username < b.username) return -1;
				if (a.username > b.username) return 1;

				return 0;
			});

			var displayUsers = {
				Admins: [],
				Users: []
			};

			// generate the user list
			users.forEach(function (user) {
				// sort the users into admins and users
				displayUsers[user.admin ? "Admins" : "Users"].push({
					href: "/user/" + user.username,
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
		.catch(function (err) {
			lifeLine.makeDom({
				classes: "content-padded",
				text: err.message
			});
		});
	}
});

},{}],16:[function(require,module,exports){
"use strict";

/**
 * The main content pane for the app
 */

lifeLine.makeDom.register("content", {
	make: function () {
		return [{
			classes: "toolbar",
			children: [{
				tag: "svg",
				classes: "menu-icon",
				attrs: {
					viewBox: "0 0 60 50",
					width: "20",
					height: "15"
				},
				children: [{ tag: "line", attrs: { x1: "0", y1: "5", x2: "60", y2: "5" } }, { tag: "line", attrs: { x1: "0", y1: "25", x2: "60", y2: "25" } }, { tag: "line", attrs: { x1: "0", y1: "45", x2: "60", y2: "45" } }],
				on: {
					click: function () {
						return document.body.classList.toggle("sidebar-open");
					}
				}
			}, {
				classes: "toolbar-title",
				name: "title"
			}, {
				classes: "toolbar-buttons",
				name: "btns"
			}]
		}, {
			classes: "content",
			name: "content"
		}];
	},
	bind: function (opts, _ref) {
		var title = _ref.title,
		    btns = _ref.btns,
		    content = _ref.content;

		var disposable;

		// set the page title
		var setTitle = function (titleText) {
			title.innerText = titleText;
			document.title = titleText;
		};

		// add an action button
		lifeLine.on("action-create", function (name) {
			lifeLine.makeDom({
				parent: btns,
				tag: "button",
				classes: "toolbar-button",
				text: name,
				attrs: {
					"data-name": name
				},
				on: {
					click: function () {
						return lifeLine.emit("action-exec-" + name);
					}
				}
			});
		});

		// remove an action button
		lifeLine.on("action-remove", function (name) {
			var btn = btns.querySelector("[data-name=\"" + name + "\"]");

			if (btn) btn.remove();
		});

		// remove all the action buttons
		lifeLine.on("action-remove-all", function () {
			return btns.innerHTML = "";
		});

		// display the content for the view
		var updateView = function () {
			// destroy any listeners from old content
			if (disposable) {
				disposable.dispose();
			}

			// remove any action buttons
			lifeLine.emit("action-remove-all");

			// clear all the old content
			content.innerHTML = "";

			// create the disposable for the content
			disposable = new lifeLine.Disposable();

			var maker = notFoundMaker,
			    match;

			// find the correct content maker
			var _iteratorNormalCompletion = true;
			var _didIteratorError = false;
			var _iteratorError = undefined;

			try {
				for (var _iterator = contentMakers[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
					var $maker = _step.value;

					// run a matcher function
					if (typeof $maker.matcher == "function") {
						match = $maker.matcher(location.pathname);
					}
					// a string match
					else if (typeof $maker.matcher == "string") {
							if ($maker.matcher == location.pathname) {
								match = $maker.matcher;
							}
						}
						// a regex match
						else {
								match = $maker.matcher.exec(location.pathname);
							}

					// match found stop searching
					if (match) {
						maker = $maker;

						break;
					}
				}

				// make the content for this route
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

			maker.make({ disposable: disposable, setTitle: setTitle, content: content, match: match });
		};

		// switch pages
		lifeLine.nav.navigate = function (url) {
			// update the url
			history.pushState(null, null, url);

			// show the new view
			updateView();
		};

		// switch pages when the user pushes the back button
		window.addEventListener("popstate", function () {
			return updateView();
		});

		// show the initial view
		updateView();
	}
});

// all content producers
var contentMakers = [];

// create the namespace
lifeLine.nav = {};

// register a content maker
lifeLine.nav.register = function (maker) {
	contentMakers.push(maker);
};

// the fall back maker for no such page
var notFoundMaker = {
	make: function (_ref2) {
		var setTitle = _ref2.setTitle,
		    content = _ref2.content;

		// update the page title
		setTitle("Not found");

		lifeLine.makeDom({
			parent: content,
			classes: "content-padded",
			children: [{
				tag: "span",
				text: "The page you are looking for could not be found. "
			}, {
				widget: "link",
				href: "/",
				text: "Go home"
			}]
		});
	}
};

},{}],17:[function(require,module,exports){
"use strict";

/**
 * Create an input field
 */

lifeLine.makeDom.register("input", {
	make: function (_ref) {
		var tag = _ref.tag,
		    type = _ref.type,
		    value = _ref.value,
		    change = _ref.change,
		    bind = _ref.bind,
		    prop = _ref.prop,
		    placeholder = _ref.placeholder,
		    classes = _ref.classes;

		// set the initial value of the bound object
		if (typeof bind == "object" && !value) {
			value = bind[prop];
		}

		var input = {
			tag: tag || "input",
			classes: classes || (tag == "textarea" ? "textarea" : "input") + "-fill",
			attrs: {},
			on: {
				input: function (e) {
					// update the property changed
					if (typeof bind == "object") {
						bind[prop] = e.target.value;
					}

					// call the callback
					if (typeof change == "function") {
						change(e.target.value);
					}
				}
			}
		};

		// attach values if they are given
		if (type) input.attrs.type = type;
		if (value) input.attrs.value = value;
		if (placeholder) input.attrs.placeholder = placeholder;

		// for textareas set innerText
		if (tag == "textarea") {
			input.text = value;
		}

		return input;
	}
});

},{}],18:[function(require,module,exports){
"use strict";

/**
 * A widget that creates a link that hooks into the navigator
 */

lifeLine.makeDom.register("link", {
	make: function (opts) {
		return {
			tag: "a",
			attrs: {
				href: opts.href
			},
			on: {
				click: function (e) {
					// don't over ride ctrl or alt or shift clicks
					if (e.ctrlKey || e.altKey || e.shiftKey) return;

					// don't navigate the page
					e.preventDefault();

					lifeLine.nav.navigate(opts.href);
				}
			},
			text: opts.text
		};
	}
});

},{}],19:[function(require,module,exports){
"use strict";

/**
 * Display a list with group headings
 */

lifeLine.makeDom.register("list", {
	make: function (_ref) {
		var items = _ref.items;

		// add all the groups
		return Object.getOwnPropertyNames(items).map(function (groupName) {
			return makeGroup(groupName, items[groupName]);
		});
	}
});

// make a single group
var makeGroup = function (name, items, parent) {
	// add the list header
	items.unshift({
		classes: "list-header",
		text: name
	});

	// render the item
	return {
		parent: parent,
		classes: "list-section",
		children: items.map(function (item, index) {
			// don't modify the header
			if (index === 0) return item;

			var itemDom;

			// create an item
			if (typeof item != "string") {
				itemDom = {
					classes: "list-item",
					children: (item.items || item).map(function (item) {
						return {
							// get the name of the item
							text: typeof item == "string" ? item : item.text,
							// set whether the item should grow
							classes: item.grow ? "list-item-grow" : "list-item-part"
						};
					})
				};
			} else {
				itemDom = {
					classes: "list-item",
					text: item
				};
			}

			// make the item a link
			if (item.href) {
				itemDom.on = {
					click: function () {
						return lifeLine.nav.navigate(item.href);
					}
				};
			}

			return itemDom;
		})
	};
};

},{}],20:[function(require,module,exports){
"use strict";

/**
 * The widget for the sidebar
 */

lifeLine.makeDom.register("sidebar", {
	make: function () {
		return [{
			classes: "sidebar",
			name: "sidebar",
			children: [{
				classes: ["sidebar-actions", "hidden"],
				name: "actions",
				children: [{
					classes: "sidebar-heading",
					text: "Page actions"
				}]
			}, {
				classes: "sidebar-heading",
				text: "More actions"
			}]
		}, {
			classes: "shade",
			on: {
				// close the sidebar
				click: function () {
					return document.body.classList.remove("sidebar-open");
				}
			}
		}];
	},
	bind: function (opts, _ref) {
		var actions = _ref.actions,
		    sidebar = _ref.sidebar;

		// add a command to the sidebar
		lifeLine.addCommand = function (name, fn) {
			// make the sidebar item
			var _lifeLine$makeDom = lifeLine.makeDom({
				parent: sidebar,
				tag: "div",
				name: "item",
				classes: "sidebar-item",
				text: name,
				on: {
					click: function () {
						// close the sidebar
						document.body.classList.remove("sidebar-open");

						// call the listener
						fn();
					}
				}
			}),
			    item = _lifeLine$makeDom.item;

			return {
				unsubscribe: function () {
					return item.remove();
				}
			};
		};

		// add a navigational command
		lifeLine.addNavCommand = function (name, to) {
			lifeLine.addCommand(name, function () {
				return lifeLine.nav.navigate(to);
			});
		};

		// add a sidebar action
		lifeLine.on("action-create", function (name) {
			// show the actions
			actions.classList.remove("hidden");

			// create the button
			lifeLine.makeDom({
				parent: actions,
				tag: "div",
				name: "item",
				classes: "sidebar-item",
				text: name,
				attrs: {
					"data-name": name
				},
				on: {
					click: function () {
						// close the sidebar
						document.body.classList.remove("sidebar-open");

						// trigger the action
						lifeLine.emit("action-exec-" + name);
					}
				}
			});

			// remove a sidebar action
			lifeLine.on("action-remove", function (name) {
				// remove the button
				var btn = actions.querySelector("[data-name=\"" + name + "\"]");

				if (btn) btn.remove();

				// hide the page actions if there are none
				if (actions.children.length == 1) {
					actions.classList.add("hidden");
				}
			});

			// remove all the sidebar actions
			lifeLine.on("action-remove-all", function () {
				// remove all the actions
				var _actions = Array.from(actions.querySelectorAll(".sidebar-item"));

				_actions.forEach(function (action) {
					return action.remove();
				});

				// side the page actions
				actions.classList.add("hidden");
			});
		});
	}
});

},{}],21:[function(require,module,exports){
"use strict";

/**
 * A row of radio style buttons
 */

lifeLine.makeDom.register("toggle-btns", {
	make: function (_ref) {
		var btns = _ref.btns,
		    value = _ref.value;

		// auto select the first button
		if (!value) {
			value = typeof btns[0] == "string" ? btns[0] : btns[0].value;
		}

		return {
			name: "toggleBar",
			classes: "toggle-bar",
			children: btns.map(function (btn) {
				// convert the plain string to an object
				if (typeof btn == "string") {
					btn = { text: btn, value: btn };
				}

				var classes = ["toggle-btn"];

				// add the selected class
				if (value == btn.value) {
					classes.push("toggle-btn-selected");

					// don't select two buttons
					value = undefined;
				}

				return {
					tag: "button",
					classes: classes,
					text: btn.text,
					attrs: {
						"data-value": btn.value
					}
				};
			})
		};
	},
	bind: function (_ref2, _ref3) {
		var change = _ref2.change;
		var toggleBar = _ref3.toggleBar;

		var _loop = function (btn) {
			btn.addEventListener("click", function () {
				var selected = toggleBar.querySelector(".toggle-btn-selected");

				// the button has already been selected
				if (selected == btn) {
					return;
				}

				// untoggle the other button
				if (selected) {
					selected.classList.remove("toggle-btn-selected");
				}

				// select this button
				btn.classList.add("toggle-btn-selected");

				// trigger a selection change
				change(btn.dataset.value);
			});
		};

		// attach listeners
		var _iteratorNormalCompletion = true;
		var _didIteratorError = false;
		var _iteratorError = undefined;

		try {
			for (var _iterator = toggleBar.querySelectorAll(".toggle-btn")[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
				var btn = _step.value;

				_loop(btn);
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
});

},{}],22:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.genBackupName = genBackupName;
/**
 * Name generator for backups
 */

function genBackupName() {
	var date = new Date();

	return "backup-" + date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + ("-" + date.getHours() + "-" + date.getMinutes() + ".zip");
}

},{}],23:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});

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
			// copy the disposable
			if (subscription instanceof Disposable) {
				// copy the subscriptions from the disposable
				this._subscriptions = this._subscriptions.concat(subscription._subscriptions);

				// remove the refrences from the disposable
				subscription._subscriptions = [];
			}
			// add a subscription
			else {
					this._subscriptions.push(subscription);
				}
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

exports.default = Disposable;
;

},{}],24:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});

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

exports.default = EventEmitter;

},{}],25:[function(require,module,exports){
(function (process,global){
"use strict";

var _eventEmitter = require("./event-emitter");

var _eventEmitter2 = _interopRequireDefault(_eventEmitter);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var lifeLine = new _eventEmitter2.default();

// platform detection
/**
 * Create a global object with commonly used modules to avoid 50 million requires
 */

lifeLine.node = typeof process == "object";
lifeLine.browser = typeof window == "object";

// attach utils
lifeLine.Disposable = require("./disposable").default;
lifeLine.EventEmitter = _eventEmitter2.default;

// attach lifeline to the global object
(lifeLine.node ? global : browser).lifeLine = lifeLine;

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./disposable":23,"./event-emitter":24,"_process":2}]},{},[5])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaWRiL2xpYi9pZGIuanMiLCJub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwic3JjXFxjbGllbnRcXGRhdGEtc3RvcmUuanMiLCJzcmNcXGNsaWVudFxcZ2xvYmFsLmpzIiwic3JjXFxjbGllbnRcXGluZGV4LmpzIiwic3JjXFxjbGllbnRcXHN5bmNlci5qcyIsInNyY1xcY2xpZW50XFx1dGlsXFxkYXRlLmpzIiwic3JjXFxjbGllbnRcXHV0aWxcXGRvbS1tYWtlci5qcyIsInNyY1xcY2xpZW50XFx2aWV3c1xcYWNjb3VudC5qcyIsInNyY1xcY2xpZW50XFx2aWV3c1xcZWRpdC5qcyIsInNyY1xcY2xpZW50XFx2aWV3c1xcaXRlbS5qcyIsInNyY1xcY2xpZW50XFx2aWV3c1xcbGlzdHMuanMiLCJzcmNcXGNsaWVudFxcdmlld3NcXGxvZ2luLmpzIiwic3JjXFxjbGllbnRcXHZpZXdzXFx0b2RvLmpzIiwic3JjXFxjbGllbnRcXHZpZXdzXFx1c2Vycy5qcyIsInNyY1xcY2xpZW50XFx3aWRnZXRzXFxjb250ZW50LmpzIiwic3JjXFxjbGllbnRcXHdpZGdldHNcXGlucHV0LmpzIiwic3JjXFxjbGllbnRcXHdpZGdldHNcXGxpbmsuanMiLCJzcmNcXGNsaWVudFxcd2lkZ2V0c1xcbGlzdC5qcyIsInNyY1xcY2xpZW50XFx3aWRnZXRzXFxzaWRlYmFyLmpzIiwic3JjXFxjbGllbnRcXHdpZGdldHNcXHRvZ2dsZS1idG5zLmpzIiwic3JjXFxjb21tb25cXGJhY2t1cC5qcyIsInNyY1xcY29tbW9uXFxkaXNwb3NhYmxlLmpzIiwic3JjXFxjb21tb25cXGV2ZW50LWVtaXR0ZXIuanMiLCJzcmNcXGNvbW1vblxcc3JjXFxjb21tb25cXGdsb2JhbC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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Q2pCLFFBRGlCO0FBRXhCO0FBQ0EsU0FBRyxNQUFNLElBQU4sQ0FBVztBQUFBLGFBQVEsS0FBSyxTQUFMLElBQWtCLFFBQTFCO0FBQUEsTUFBWCxDQUFILEVBQW1EO0FBQ2xEO0FBQ0E7O0FBRUQ7QUFDQSwrQkFBWSxJQUFaO0FBUndCOztBQUFBO0FBQUE7QUFBQTs7QUFBQTtBQUN6QiwyQkFBb0IsS0FBSyxVQUFMLENBQWdCLElBQWhCLENBQXBCLG1JQUEyQztBQUFBLFVBQW5DLFFBQW1DOztBQUFBLHVCQUFuQyxRQUFtQzs7QUFBQSwrQkFHekM7QUFLRDtBQVR3QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBVXpCO0FBQ0Q7Ozs7OztrQkFsRW1CLFk7Ozs7OztBQ0FyQjs7Ozs7O0FBRUEsSUFBSSxXQUFXLDRCQUFmOztBQUVBO0FBUkE7Ozs7QUFTQSxTQUFTLElBQVQsR0FBZ0IsT0FBTyxPQUFQLElBQWtCLFFBQWxDO0FBQ0EsU0FBUyxPQUFULEdBQW1CLE9BQU8sTUFBUCxJQUFpQixRQUFwQzs7QUFFQTtBQUNBLFNBQVMsVUFBVCxHQUFzQixRQUFRLGNBQVIsRUFBd0IsT0FBOUM7QUFDQSxTQUFTLFlBQVQ7O0FBRUE7QUFDQSxDQUFDLFNBQVMsSUFBVCxHQUFnQixNQUFoQixHQUF5QixPQUExQixFQUFtQyxRQUFuQyxHQUE4QyxRQUE5QyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XG5cbihmdW5jdGlvbigpIHtcbiAgZnVuY3Rpb24gdG9BcnJheShhcnIpIHtcbiAgICByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJyKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeVJlcXVlc3QocmVxdWVzdCkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHJlcXVlc3Qub25zdWNjZXNzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlc29sdmUocmVxdWVzdC5yZXN1bHQpO1xuICAgICAgfTtcblxuICAgICAgcmVxdWVzdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJlamVjdChyZXF1ZXN0LmVycm9yKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9taXNpZnlSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncykge1xuICAgIHZhciByZXF1ZXN0O1xuICAgIHZhciBwID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICByZXF1ZXN0ID0gb2JqW21ldGhvZF0uYXBwbHkob2JqLCBhcmdzKTtcbiAgICAgIHByb21pc2lmeVJlcXVlc3QocmVxdWVzdCkudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgIH0pO1xuXG4gICAgcC5yZXF1ZXN0ID0gcmVxdWVzdDtcbiAgICByZXR1cm4gcDtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb21pc2lmeUN1cnNvclJlcXVlc3RDYWxsKG9iaiwgbWV0aG9kLCBhcmdzKSB7XG4gICAgdmFyIHAgPSBwcm9taXNpZnlSZXF1ZXN0Q2FsbChvYmosIG1ldGhvZCwgYXJncyk7XG4gICAgcmV0dXJuIHAudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKCF2YWx1ZSkgcmV0dXJuO1xuICAgICAgcmV0dXJuIG5ldyBDdXJzb3IodmFsdWUsIHAucmVxdWVzdCk7XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eVByb3BlcnRpZXMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgcHJvcGVydGllcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoUHJveHlDbGFzcy5wcm90b3R5cGUsIHByb3AsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpc1t0YXJnZXRQcm9wXVtwcm9wXTtcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWwpIHtcbiAgICAgICAgICB0aGlzW3RhcmdldFByb3BdW3Byb3BdID0gdmFsO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5UmVxdWVzdE1ldGhvZHMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgQ29uc3RydWN0b3IsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgaWYgKCEocHJvcCBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgICBQcm94eUNsYXNzLnByb3RvdHlwZVtwcm9wXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5UmVxdWVzdENhbGwodGhpc1t0YXJnZXRQcm9wXSwgcHJvcCwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm94eU1ldGhvZHMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgQ29uc3RydWN0b3IsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgaWYgKCEocHJvcCBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgICBQcm94eUNsYXNzLnByb3RvdHlwZVtwcm9wXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpc1t0YXJnZXRQcm9wXVtwcm9wXS5hcHBseSh0aGlzW3RhcmdldFByb3BdLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3h5Q3Vyc29yUmVxdWVzdE1ldGhvZHMoUHJveHlDbGFzcywgdGFyZ2V0UHJvcCwgQ29uc3RydWN0b3IsIHByb3BlcnRpZXMpIHtcbiAgICBwcm9wZXJ0aWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcCkge1xuICAgICAgaWYgKCEocHJvcCBpbiBDb25zdHJ1Y3Rvci5wcm90b3R5cGUpKSByZXR1cm47XG4gICAgICBQcm94eUNsYXNzLnByb3RvdHlwZVtwcm9wXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcHJvbWlzaWZ5Q3Vyc29yUmVxdWVzdENhbGwodGhpc1t0YXJnZXRQcm9wXSwgcHJvcCwgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBJbmRleChpbmRleCkge1xuICAgIHRoaXMuX2luZGV4ID0gaW5kZXg7XG4gIH1cblxuICBwcm94eVByb3BlcnRpZXMoSW5kZXgsICdfaW5kZXgnLCBbXG4gICAgJ25hbWUnLFxuICAgICdrZXlQYXRoJyxcbiAgICAnbXVsdGlFbnRyeScsXG4gICAgJ3VuaXF1ZSdcbiAgXSk7XG5cbiAgcHJveHlSZXF1ZXN0TWV0aG9kcyhJbmRleCwgJ19pbmRleCcsIElEQkluZGV4LCBbXG4gICAgJ2dldCcsXG4gICAgJ2dldEtleScsXG4gICAgJ2dldEFsbCcsXG4gICAgJ2dldEFsbEtleXMnLFxuICAgICdjb3VudCdcbiAgXSk7XG5cbiAgcHJveHlDdXJzb3JSZXF1ZXN0TWV0aG9kcyhJbmRleCwgJ19pbmRleCcsIElEQkluZGV4LCBbXG4gICAgJ29wZW5DdXJzb3InLFxuICAgICdvcGVuS2V5Q3Vyc29yJ1xuICBdKTtcblxuICBmdW5jdGlvbiBDdXJzb3IoY3Vyc29yLCByZXF1ZXN0KSB7XG4gICAgdGhpcy5fY3Vyc29yID0gY3Vyc29yO1xuICAgIHRoaXMuX3JlcXVlc3QgPSByZXF1ZXN0O1xuICB9XG5cbiAgcHJveHlQcm9wZXJ0aWVzKEN1cnNvciwgJ19jdXJzb3InLCBbXG4gICAgJ2RpcmVjdGlvbicsXG4gICAgJ2tleScsXG4gICAgJ3ByaW1hcnlLZXknLFxuICAgICd2YWx1ZSdcbiAgXSk7XG5cbiAgcHJveHlSZXF1ZXN0TWV0aG9kcyhDdXJzb3IsICdfY3Vyc29yJywgSURCQ3Vyc29yLCBbXG4gICAgJ3VwZGF0ZScsXG4gICAgJ2RlbGV0ZSdcbiAgXSk7XG5cbiAgLy8gcHJveHkgJ25leHQnIG1ldGhvZHNcbiAgWydhZHZhbmNlJywgJ2NvbnRpbnVlJywgJ2NvbnRpbnVlUHJpbWFyeUtleSddLmZvckVhY2goZnVuY3Rpb24obWV0aG9kTmFtZSkge1xuICAgIGlmICghKG1ldGhvZE5hbWUgaW4gSURCQ3Vyc29yLnByb3RvdHlwZSkpIHJldHVybjtcbiAgICBDdXJzb3IucHJvdG90eXBlW21ldGhvZE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgY3Vyc29yID0gdGhpcztcbiAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgIGN1cnNvci5fY3Vyc29yW21ldGhvZE5hbWVdLmFwcGx5KGN1cnNvci5fY3Vyc29yLCBhcmdzKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3QoY3Vyc29yLl9yZXF1ZXN0KS50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKCF2YWx1ZSkgcmV0dXJuO1xuICAgICAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHZhbHVlLCBjdXJzb3IuX3JlcXVlc3QpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0pO1xuXG4gIGZ1bmN0aW9uIE9iamVjdFN0b3JlKHN0b3JlKSB7XG4gICAgdGhpcy5fc3RvcmUgPSBzdG9yZTtcbiAgfVxuXG4gIE9iamVjdFN0b3JlLnByb3RvdHlwZS5jcmVhdGVJbmRleCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgSW5kZXgodGhpcy5fc3RvcmUuY3JlYXRlSW5kZXguYXBwbHkodGhpcy5fc3RvcmUsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIE9iamVjdFN0b3JlLnByb3RvdHlwZS5pbmRleCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBuZXcgSW5kZXgodGhpcy5fc3RvcmUuaW5kZXguYXBwbHkodGhpcy5fc3RvcmUsIGFyZ3VtZW50cykpO1xuICB9O1xuXG4gIHByb3h5UHJvcGVydGllcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIFtcbiAgICAnbmFtZScsXG4gICAgJ2tleVBhdGgnLFxuICAgICdpbmRleE5hbWVzJyxcbiAgICAnYXV0b0luY3JlbWVudCdcbiAgXSk7XG5cbiAgcHJveHlSZXF1ZXN0TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ3B1dCcsXG4gICAgJ2FkZCcsXG4gICAgJ2RlbGV0ZScsXG4gICAgJ2NsZWFyJyxcbiAgICAnZ2V0JyxcbiAgICAnZ2V0QWxsJyxcbiAgICAnZ2V0S2V5JyxcbiAgICAnZ2V0QWxsS2V5cycsXG4gICAgJ2NvdW50J1xuICBdKTtcblxuICBwcm94eUN1cnNvclJlcXVlc3RNZXRob2RzKE9iamVjdFN0b3JlLCAnX3N0b3JlJywgSURCT2JqZWN0U3RvcmUsIFtcbiAgICAnb3BlbkN1cnNvcicsXG4gICAgJ29wZW5LZXlDdXJzb3InXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhPYmplY3RTdG9yZSwgJ19zdG9yZScsIElEQk9iamVjdFN0b3JlLCBbXG4gICAgJ2RlbGV0ZUluZGV4J1xuICBdKTtcblxuICBmdW5jdGlvbiBUcmFuc2FjdGlvbihpZGJUcmFuc2FjdGlvbikge1xuICAgIHRoaXMuX3R4ID0gaWRiVHJhbnNhY3Rpb247XG4gICAgdGhpcy5jb21wbGV0ZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25jb21wbGV0ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9O1xuICAgICAgaWRiVHJhbnNhY3Rpb24ub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QoaWRiVHJhbnNhY3Rpb24uZXJyb3IpO1xuICAgICAgfTtcbiAgICAgIGlkYlRyYW5zYWN0aW9uLm9uYWJvcnQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KGlkYlRyYW5zYWN0aW9uLmVycm9yKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBUcmFuc2FjdGlvbi5wcm90b3R5cGUub2JqZWN0U3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE9iamVjdFN0b3JlKHRoaXMuX3R4Lm9iamVjdFN0b3JlLmFwcGx5KHRoaXMuX3R4LCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoVHJhbnNhY3Rpb24sICdfdHgnLCBbXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnLFxuICAgICdtb2RlJ1xuICBdKTtcblxuICBwcm94eU1ldGhvZHMoVHJhbnNhY3Rpb24sICdfdHgnLCBJREJUcmFuc2FjdGlvbiwgW1xuICAgICdhYm9ydCdcbiAgXSk7XG5cbiAgZnVuY3Rpb24gVXBncmFkZURCKGRiLCBvbGRWZXJzaW9uLCB0cmFuc2FjdGlvbikge1xuICAgIHRoaXMuX2RiID0gZGI7XG4gICAgdGhpcy5vbGRWZXJzaW9uID0gb2xkVmVyc2lvbjtcbiAgICB0aGlzLnRyYW5zYWN0aW9uID0gbmV3IFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKTtcbiAgfVxuXG4gIFVwZ3JhZGVEQi5wcm90b3R5cGUuY3JlYXRlT2JqZWN0U3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IE9iamVjdFN0b3JlKHRoaXMuX2RiLmNyZWF0ZU9iamVjdFN0b3JlLmFwcGx5KHRoaXMuX2RiLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoVXBncmFkZURCLCAnX2RiJywgW1xuICAgICduYW1lJyxcbiAgICAndmVyc2lvbicsXG4gICAgJ29iamVjdFN0b3JlTmFtZXMnXG4gIF0pO1xuXG4gIHByb3h5TWV0aG9kcyhVcGdyYWRlREIsICdfZGInLCBJREJEYXRhYmFzZSwgW1xuICAgICdkZWxldGVPYmplY3RTdG9yZScsXG4gICAgJ2Nsb3NlJ1xuICBdKTtcblxuICBmdW5jdGlvbiBEQihkYikge1xuICAgIHRoaXMuX2RiID0gZGI7XG4gIH1cblxuICBEQi5wcm90b3R5cGUudHJhbnNhY3Rpb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFRyYW5zYWN0aW9uKHRoaXMuX2RiLnRyYW5zYWN0aW9uLmFwcGx5KHRoaXMuX2RiLCBhcmd1bWVudHMpKTtcbiAgfTtcblxuICBwcm94eVByb3BlcnRpZXMoREIsICdfZGInLCBbXG4gICAgJ25hbWUnLFxuICAgICd2ZXJzaW9uJyxcbiAgICAnb2JqZWN0U3RvcmVOYW1lcydcbiAgXSk7XG5cbiAgcHJveHlNZXRob2RzKERCLCAnX2RiJywgSURCRGF0YWJhc2UsIFtcbiAgICAnY2xvc2UnXG4gIF0pO1xuXG4gIC8vIEFkZCBjdXJzb3IgaXRlcmF0b3JzXG4gIC8vIFRPRE86IHJlbW92ZSB0aGlzIG9uY2UgYnJvd3NlcnMgZG8gdGhlIHJpZ2h0IHRoaW5nIHdpdGggcHJvbWlzZXNcbiAgWydvcGVuQ3Vyc29yJywgJ29wZW5LZXlDdXJzb3InXS5mb3JFYWNoKGZ1bmN0aW9uKGZ1bmNOYW1lKSB7XG4gICAgW09iamVjdFN0b3JlLCBJbmRleF0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgICAgQ29uc3RydWN0b3IucHJvdG90eXBlW2Z1bmNOYW1lLnJlcGxhY2UoJ29wZW4nLCAnaXRlcmF0ZScpXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgYXJncyA9IHRvQXJyYXkoYXJndW1lbnRzKTtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gYXJnc1thcmdzLmxlbmd0aCAtIDFdO1xuICAgICAgICB2YXIgbmF0aXZlT2JqZWN0ID0gdGhpcy5fc3RvcmUgfHwgdGhpcy5faW5kZXg7XG4gICAgICAgIHZhciByZXF1ZXN0ID0gbmF0aXZlT2JqZWN0W2Z1bmNOYW1lXS5hcHBseShuYXRpdmVPYmplY3QsIGFyZ3Muc2xpY2UoMCwgLTEpKTtcbiAgICAgICAgcmVxdWVzdC5vbnN1Y2Nlc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBjYWxsYmFjayhyZXF1ZXN0LnJlc3VsdCk7XG4gICAgICAgIH07XG4gICAgICB9O1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBwb2x5ZmlsbCBnZXRBbGxcbiAgW0luZGV4LCBPYmplY3RTdG9yZV0uZm9yRWFjaChmdW5jdGlvbihDb25zdHJ1Y3Rvcikge1xuICAgIGlmIChDb25zdHJ1Y3Rvci5wcm90b3R5cGUuZ2V0QWxsKSByZXR1cm47XG4gICAgQ29uc3RydWN0b3IucHJvdG90eXBlLmdldEFsbCA9IGZ1bmN0aW9uKHF1ZXJ5LCBjb3VudCkge1xuICAgICAgdmFyIGluc3RhbmNlID0gdGhpcztcbiAgICAgIHZhciBpdGVtcyA9IFtdO1xuXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICBpbnN0YW5jZS5pdGVyYXRlQ3Vyc29yKHF1ZXJ5LCBmdW5jdGlvbihjdXJzb3IpIHtcbiAgICAgICAgICBpZiAoIWN1cnNvcikge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGl0ZW1zLnB1c2goY3Vyc29yLnZhbHVlKTtcblxuICAgICAgICAgIGlmIChjb3VudCAhPT0gdW5kZWZpbmVkICYmIGl0ZW1zLmxlbmd0aCA9PSBjb3VudCkge1xuICAgICAgICAgICAgcmVzb2x2ZShpdGVtcyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIGN1cnNvci5jb250aW51ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0pO1xuXG4gIHZhciBleHAgPSB7XG4gICAgb3BlbjogZnVuY3Rpb24obmFtZSwgdmVyc2lvbiwgdXBncmFkZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcCA9IHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ29wZW4nLCBbbmFtZSwgdmVyc2lvbl0pO1xuICAgICAgdmFyIHJlcXVlc3QgPSBwLnJlcXVlc3Q7XG5cbiAgICAgIHJlcXVlc3Qub251cGdyYWRlbmVlZGVkID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgaWYgKHVwZ3JhZGVDYWxsYmFjaykge1xuICAgICAgICAgIHVwZ3JhZGVDYWxsYmFjayhuZXcgVXBncmFkZURCKHJlcXVlc3QucmVzdWx0LCBldmVudC5vbGRWZXJzaW9uLCByZXF1ZXN0LnRyYW5zYWN0aW9uKSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIHJldHVybiBwLnRoZW4oZnVuY3Rpb24oZGIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBEQihkYik7XG4gICAgICB9KTtcbiAgICB9LFxuICAgIGRlbGV0ZTogZnVuY3Rpb24obmFtZSkge1xuICAgICAgcmV0dXJuIHByb21pc2lmeVJlcXVlc3RDYWxsKGluZGV4ZWREQiwgJ2RlbGV0ZURhdGFiYXNlJywgW25hbWVdKTtcbiAgICB9XG4gIH07XG5cbiAgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBleHA7XG4gIH1cbiAgZWxzZSB7XG4gICAgc2VsZi5pZGIgPSBleHA7XG4gIH1cbn0oKSk7XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxuLy8gY2FjaGVkIGZyb20gd2hhdGV2ZXIgZ2xvYmFsIGlzIHByZXNlbnQgc28gdGhhdCB0ZXN0IHJ1bm5lcnMgdGhhdCBzdHViIGl0XG4vLyBkb24ndCBicmVhayB0aGluZ3MuICBCdXQgd2UgbmVlZCB0byB3cmFwIGl0IGluIGEgdHJ5IGNhdGNoIGluIGNhc2UgaXQgaXNcbi8vIHdyYXBwZWQgaW4gc3RyaWN0IG1vZGUgY29kZSB3aGljaCBkb2Vzbid0IGRlZmluZSBhbnkgZ2xvYmFscy4gIEl0J3MgaW5zaWRlIGFcbi8vIGZ1bmN0aW9uIGJlY2F1c2UgdHJ5L2NhdGNoZXMgZGVvcHRpbWl6ZSBpbiBjZXJ0YWluIGVuZ2luZXMuXG5cbnZhciBjYWNoZWRTZXRUaW1lb3V0O1xudmFyIGNhY2hlZENsZWFyVGltZW91dDtcblxuZnVuY3Rpb24gZGVmYXVsdFNldFRpbW91dCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldFRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbmZ1bmN0aW9uIGRlZmF1bHRDbGVhclRpbWVvdXQgKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY2xlYXJUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG4oZnVuY3Rpb24gKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2V0VGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2YgY2xlYXJUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgIH1cbn0gKCkpXG5mdW5jdGlvbiBydW5UaW1lb3V0KGZ1bikge1xuICAgIGlmIChjYWNoZWRTZXRUaW1lb3V0ID09PSBzZXRUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICAvLyBpZiBzZXRUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkU2V0VGltZW91dCA9PT0gZGVmYXVsdFNldFRpbW91dCB8fCAhY2FjaGVkU2V0VGltZW91dCkgJiYgc2V0VGltZW91dCkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dChmdW4sIDApO1xuICAgIH0gY2F0Y2goZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwobnVsbCwgZnVuLCAwKTtcbiAgICAgICAgfSBjYXRjaChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yXG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKHRoaXMsIGZ1biwgMCk7XG4gICAgICAgIH1cbiAgICB9XG5cblxufVxuZnVuY3Rpb24gcnVuQ2xlYXJUaW1lb3V0KG1hcmtlcikge1xuICAgIGlmIChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGNsZWFyVGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICAvLyBpZiBjbGVhclRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGRlZmF1bHRDbGVhclRpbWVvdXQgfHwgIWNhY2hlZENsZWFyVGltZW91dCkgJiYgY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCAgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbChudWxsLCBtYXJrZXIpO1xuICAgICAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yLlxuICAgICAgICAgICAgLy8gU29tZSB2ZXJzaW9ucyBvZiBJLkUuIGhhdmUgZGlmZmVyZW50IHJ1bGVzIGZvciBjbGVhclRpbWVvdXQgdnMgc2V0VGltZW91dFxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKHRoaXMsIG1hcmtlcik7XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG59XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBpZiAoIWRyYWluaW5nIHx8ICFjdXJyZW50UXVldWUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBydW5UaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50UXVldWUpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBydW5DbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBydW5UaW1lb3V0KGRyYWluUXVldWUpO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwiLyoqXHJcbiAqIFdvcmsgd2l0aCBkYXRhIHN0b3Jlc1xyXG4gKi9cclxuXHJcbmNvbnN0IERFQk9VTkNFX1RJTUUgPSAyMDAwO1xyXG5jb25zdCBEQVRBX1NUT1JFX1JPT1QgPSBcIi9hcGkvZGF0YS9cIjtcclxuXHJcbnZhciBpZGIgPSByZXF1aXJlKFwiaWRiXCIpO1xyXG5cclxuLy8gY2FjaGUgZGF0YSBzdG9yZSBpbnN0YW5jZXNcclxudmFyIHN0b3JlcyA9IHt9O1xyXG5cclxuLy8gZ2V0L2NyZWF0ZSBhIGRhdGFzdG9yZVxyXG5leHBvcnQgZnVuY3Rpb24gc3RvcmUobmFtZSkge1xyXG5cdC8vIHVzZSB0aGUgY2FjaGVkIHN0b3JlXHJcblx0aWYobmFtZSBpbiBzdG9yZXMpIHtcclxuXHRcdHJldHVybiBzdG9yZXNbbmFtZV07XHJcblx0fVxyXG5cclxuXHR2YXIgc3RvcmUgPSBuZXcgU3RvcmUobmFtZSk7XHJcblxyXG5cdC8vIGNhY2hlIHRoZSBkYXRhIHN0b3JlIGluc3RhbmNlXHJcblx0c3RvcmVzW25hbWVdID0gc3RvcmU7XHJcblxyXG5cdC8vIHRlbGwgYW55IGxpc3RlbmVycyB0aGUgc3RvcmUgaGFzIGJlZW4gY3JlYXRlZFxyXG5cdGxpZmVMaW5lLmVtaXQoXCJkYXRhLXN0b3JlLWNyZWF0ZWRcIiwgc3RvcmUpO1xyXG5cclxuXHRyZXR1cm4gc3RvcmU7XHJcbn07XHJcblxyXG5jbGFzcyBTdG9yZSBleHRlbmRzIGxpZmVMaW5lLkV2ZW50RW1pdHRlciB7XHJcblx0Y29uc3RydWN0b3IobmFtZSkge1xyXG5cdFx0c3VwZXIoKTtcclxuXHRcdHRoaXMubmFtZSA9IG5hbWU7XHJcblx0XHR0aGlzLl9jYWNoZSA9IHt9O1xyXG5cdFx0Ly8gZG9uJ3Qgc2VuZCBkdXBsaWNhdGUgcmVxdWVzdHNcclxuXHRcdHRoaXMuX3JlcXVlc3RpbmcgPSBbXTtcclxuXHRcdC8vIHByb21pc2UgZm9yIHRoZSBkYXRhYmFzZVxyXG5cdFx0dGhpcy5fZGIgPSBpZGIub3BlbihcImRhdGEtc3RvcmVzXCIsIDIsIGRiID0+IHtcclxuXHRcdFx0Ly8gdXBncmFkZSBvciBjcmVhdGUgdGhlIGRiXHJcblx0XHRcdGlmKGRiLm9sZFZlcnNpb24gPCAxKVxyXG5cdFx0XHRcdGRiLmNyZWF0ZU9iamVjdFN0b3JlKFwiYXNzaWdubWVudHNcIiwgeyBrZXlQYXRoOiBcImlkXCIgfSk7XHJcblx0XHRcdGlmKGRiLm9sZFZlcnNpb24gPCAyKVxyXG5cdFx0XHRcdGRiLmNyZWF0ZU9iamVjdFN0b3JlKFwic3luYy1zdG9yZVwiLCB7IGtleVBhdGg6IFwiaWRcIiB9KTtcclxuXHRcdH0pO1xyXG5cdH1cclxuXHJcblx0Ly8gc2V0IHRoZSBmdW5jdGlvbiB0byBkZXNlcmlhbGl6ZSBhbGwgZGF0YSBmcm9tIHRoZSBzZXJ2ZXJcclxuXHRzZXRJbml0KGZuKSB7XHJcblx0XHR0aGlzLl9kZXNlcmlhbGl6ZXIgPSBmbjtcclxuXHR9XHJcblxyXG5cdC8vIGdldCBhbGwgdGhlIGl0ZW1zIGFuZCBsaXN0ZW4gZm9yIGFueSBjaGFuZ2VzXHJcblx0Z2V0QWxsKGZuKSB7XHJcblx0XHRpZighZm4pIHtcclxuXHRcdFx0Ly8gbG9hZCBpdGVtcyBmcm9tIGlkYlxyXG5cdFx0XHRyZXR1cm4gdGhpcy5fZGIudGhlbihkYiA9PiB7XHJcblx0XHRcdFx0cmV0dXJuIGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSlcclxuXHRcdFx0XHRcdC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpXHJcblx0XHRcdFx0XHQuZ2V0QWxsKClcclxuXHRcdFx0fSk7XHJcblx0XHR9XHJcblxyXG5cdFx0Ly8gZ28gdG8gdGhlIGNhY2hlIGZpcnN0XHJcblx0XHRmbihhcnJheUZyb21PYmplY3QodGhpcy5fY2FjaGUpKTtcclxuXHJcblx0XHQvLyBsb2FkIGl0ZW1zIGZyb20gaWRiXHJcblx0XHR0aGlzLl9kYi50aGVuKGRiID0+IHtcclxuXHRcdFx0ZGIudHJhbnNhY3Rpb24odGhpcy5uYW1lKVxyXG5cdFx0XHRcdC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpXHJcblx0XHRcdFx0LmdldEFsbCgpXHJcblx0XHRcdFx0LnRoZW4oYWxsID0+IHtcclxuXHRcdFx0XHRcdC8vIHN0b3JlIGl0ZW1zIGluIHRoZSBjYWNoZVxyXG5cdFx0XHRcdFx0Zm9yKGxldCBpdGVtIG9mIGFsbCkge1xyXG5cdFx0XHRcdFx0XHR0aGlzLl9jYWNoZVtpdGVtLmlkXSA9IGl0ZW07XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0Ly8gbm90aWZ5IGxpc3RlbmVycyB3ZSBsb2FkZWQgdGhlIGRhdGFcclxuXHRcdFx0XHRcdHRoaXMuZW1pdChcImNoYW5nZVwiKTtcclxuXHRcdFx0XHR9KTtcclxuXHRcdH0pO1xyXG5cclxuXHRcdC8vIGxpc3RlbiBmb3IgYW55IGNoYW5nZXNcclxuXHRcdHJldHVybiB0aGlzLm9uKFwiY2hhbmdlXCIsICgpID0+IHtcclxuXHRcdFx0Ly8gdGhlIGNoYW5nZXMgd2lsbCB3ZSBpbiB0aGUgY2FjaGVcclxuXHRcdFx0Zm4oYXJyYXlGcm9tT2JqZWN0KHRoaXMuX2NhY2hlKSk7XHJcblx0XHR9KTtcclxuXHR9XHJcblxyXG5cdC8vIGdldCBhIHNpbmdsZSBpdGVtIGFuZCBsaXN0ZW4gZm9yIGNoYW5nZXNcclxuXHRnZXQoaWQsIGZuKSB7XHJcblx0XHQvLyBqdXN0IGxvYWQgdGhlIHZhbHVlIGZyb20gaWRiXHJcblx0XHRpZighZm4pIHtcclxuXHRcdFx0Ly8gaGl0IHRoZSBjYWNoZVxyXG5cdFx0XHRpZih0aGlzLl9jYWNoZVtpZF0pIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5fY2FjaGVbaWRdKTtcclxuXHJcblx0XHRcdC8vIGhpdCBpZGJcclxuXHRcdFx0cmV0dXJuIHRoaXMuX2RiLnRoZW4oZGIgPT4ge1xyXG5cdFx0XHRcdHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXHJcblx0XHRcdFx0XHQub2JqZWN0U3RvcmUodGhpcy5uYW1lKVxyXG5cdFx0XHRcdFx0LmdldChpZClcclxuXHRcdFx0XHRcdC50aGVuKGl0ZW0gPT4ge1xyXG5cdFx0XHRcdFx0XHRpZih0eXBlb2YgdGhpcy5fZGVzZXJpYWxpemVyID09IFwiZnVuY3Rpb25cIikge1xyXG5cdFx0XHRcdFx0XHRcdHJldHVybiB0aGlzLl9kZXNlcmlhbGl6ZXIoaXRlbSkgfHwgaXRlbTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdFx0cmV0dXJuIGl0ZW07XHJcblx0XHRcdFx0XHR9KTtcclxuXHRcdFx0fSk7XHJcblx0XHR9XHJcblxyXG5cdFx0Ly8gZ28gdG8gdGhlIGNhY2hlIGZpcnN0XHJcblx0XHRmbih0aGlzLl9jYWNoZVtpZF0pO1xyXG5cclxuXHRcdC8vIGxvYWQgdGhlIGl0ZW0gZnJvbSBpZGJcclxuXHRcdHRoaXMuX2RiLnRoZW4oZGIgPT4ge1xyXG5cdFx0XHRkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUpXHJcblx0XHRcdFx0Lm9iamVjdFN0b3JlKHRoaXMubmFtZSlcclxuXHRcdFx0XHQuZ2V0KGlkKVxyXG5cdFx0XHRcdC50aGVuKGl0ZW0gPT4ge1xyXG5cdFx0XHRcdFx0aWYoaXRlbSkge1xyXG5cdFx0XHRcdFx0XHQvLyBzdG9yZSBpdGVtIGluIHRoZSBjYWNoZVxyXG5cdFx0XHRcdFx0XHR0aGlzLl9jYWNoZVtpdGVtLmlkXSA9IGl0ZW07XHJcblxyXG5cdFx0XHRcdFx0XHQvLyBub3RpZnkgbGlzdGVuZXJzIHdlIGxvYWRlZCB0aGUgZGF0YVxyXG5cdFx0XHRcdFx0XHR0aGlzLmVtaXQoXCJjaGFuZ2VcIik7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSk7XHJcblx0XHR9KTtcclxuXHJcblx0XHQvLyBsaXN0ZW4gZm9yIGFueSBjaGFuZ2VzXHJcblx0XHRyZXR1cm4gdGhpcy5vbihcImNoYW5nZVwiLCAoKSA9PiB7XHJcblx0XHRcdGZuKHRoaXMuX2NhY2hlW2lkXSk7XHJcblx0XHR9KTtcclxuXHR9XHJcblxyXG5cdC8vIHN0b3JlIGEgdmFsdWUgaW4gdGhlIHN0b3JlXHJcblx0c2V0KHZhbHVlLCBza2lwcywgb3B0cyA9IHt9KSB7XHJcblx0XHR2YXIgaXNOZXcgPSAhIXRoaXMuX2NhY2hlW3ZhbHVlLmlkXTtcclxuXHJcblx0XHQvLyBkZXNlcmlhbGl6ZVxyXG5cdFx0aWYodHlwZW9mIHRoaXMuX2Rlc2VyaWFsaXplciA9PSBcImZ1bmN0aW9uXCIpIHtcclxuXHRcdFx0dmFsdWUgPSB0aGlzLl9kZXNlcmlhbGl6ZXIodmFsdWUpIHx8IHZhbHVlO1xyXG5cdFx0fVxyXG5cclxuXHRcdC8vIHN0b3JlIHRoZSB2YWx1ZSBpbiB0aGUgY2FjaGVcclxuXHRcdHRoaXMuX2NhY2hlW3ZhbHVlLmlkXSA9IHZhbHVlO1xyXG5cclxuXHRcdC8vIHNhdmUgdGhlIGl0ZW1cclxuXHRcdHZhciBzYXZlID0gKCkgPT4ge1xyXG5cdFx0XHQvLyBzYXZlIHRoZSBpdGVtIGluIHRoZSBkYlxyXG5cdFx0XHR0aGlzLl9kYi50aGVuKGRiID0+IHtcclxuXHRcdFx0XHRkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsIFwicmVhZHdyaXRlXCIpXHJcblx0XHRcdFx0XHQub2JqZWN0U3RvcmUodGhpcy5uYW1lKVxyXG5cdFx0XHRcdFx0LnB1dCh2YWx1ZSk7XHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0Ly8gc3luYyB0aGUgY2hhbmdlcyB0byB0aGUgc2VydmVyXHJcblx0XHRcdHRoaXMucGFydGlhbEVtaXQoXCJzeW5jLXB1dFwiLCBza2lwcywgdmFsdWUsIGlzTmV3KTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gZW1pdCBhIGNoYW5nZVxyXG5cdFx0dGhpcy5wYXJ0aWFsRW1pdChcImNoYW5nZVwiLCBza2lwcyk7XHJcblxyXG5cdFx0Ly8gZG9uJ3Qgd2FpdCB0byBzZW5kIHRoZSBjaGFuZ2VzIHRvIHRoZSBzZXJ2ZXJcclxuXHRcdGlmKG9wdHMuc2F2ZU5vdykgcmV0dXJuIHNhdmUoKTtcclxuXHRcdGVsc2UgZGVib3VuY2UoYCR7dGhpcy5uYW1lfS8ke3ZhbHVlLmlkfWAsIHNhdmUpO1xyXG5cdH1cclxuXHJcblx0Ly8gcmVtb3ZlIGEgdmFsdWUgZnJvbSB0aGUgc3RvcmVcclxuXHRyZW1vdmUoaWQsIHNraXBzKSB7XHJcblx0XHQvLyByZW1vdmUgdGhlIHZhbHVlIGZyb20gdGhlIGNhY2hlXHJcblx0XHRkZWxldGUgdGhpcy5fY2FjaGVbaWRdO1xyXG5cclxuXHRcdC8vIGVtaXQgYSBjaGFuZ2VcclxuXHRcdHRoaXMucGFydGlhbEVtaXQoXCJjaGFuZ2VcIiwgc2tpcHMpO1xyXG5cclxuXHRcdC8vIHN5bmMgdGhlIGNoYW5nZXMgdG8gdGhlIHNlcnZlclxyXG5cdFx0dGhpcy5wYXJ0aWFsRW1pdChcInN5bmMtZGVsZXRlXCIsIHNraXBzLCBpZCk7XHJcblxyXG5cdFx0Ly8gZGVsZXRlIHRoZSBpdGVtXHJcblx0XHRyZXR1cm4gdGhpcy5fZGIudGhlbihkYiA9PiB7XHJcblx0XHRcdHJldHVybiBkYi50cmFuc2FjdGlvbih0aGlzLm5hbWUsIFwicmVhZHdyaXRlXCIpXHJcblx0XHRcdFx0Lm9iamVjdFN0b3JlKHRoaXMubmFtZSlcclxuXHRcdFx0XHQuZGVsZXRlKGlkKTtcclxuXHRcdH0pO1xyXG5cdH1cclxuXHJcblx0Ly8gZm9yY2Ugc2F2ZXMgdG8gZ28gdGhyb3VnaFxyXG5cdGZvcmNlU2F2ZSgpIHtcclxuXHRcdGZvcihsZXQgdGltZXIgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoZGVib3VuY2VUaW1lcnMpKSB7XHJcblx0XHRcdC8vIG9ubHkgc2F2ZSBpdGVtcyBmcm9tIHRoaXMgZGF0YSBzdG9yZVxyXG5cdFx0XHRpZih0aW1lci5pbmRleE9mKGAke3RoaXMubmFtZX0vYCkgPT09IDApIHtcclxuXHRcdFx0XHRjb250aW51ZTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gbG9vayB1cCB0aGUgdGltZXIgaWRcclxuXHRcdFx0bGV0IGlkID0gdGltZXIuc3Vic3RyKHRpbWVyLmluZGV4T2YoXCIvXCIpICsgMSk7XHJcblx0XHRcdHZhciB2YWx1ZSA9IHRoaXMuX2NhY2hlW2lkXTtcclxuXHJcblx0XHRcdC8vIGNsZWFyIHRoZSB0aW1lclxyXG5cdFx0XHRjbGVhclRpbWVvdXQodGltZXIpO1xyXG5cclxuXHRcdFx0Ly8gcmVtb3ZlIHRoZSB0aW1lciBmcm9tIHRoZSBsaXN0XHJcblx0XHRcdGRlbGV0ZSBkZWJvdW5jZVRpbWVyc1t0aW1lcl07XHJcblxyXG5cdFx0XHQvLyBkb24ndCBzYXZlIG9uIGRlbGV0ZVxyXG5cdFx0XHRpZighdmFsdWUpIHJldHVybjtcclxuXHJcblx0XHRcdC8vIHNhdmUgdGhlIGl0ZW0gaW4gdGhlIGRiXHJcblx0XHRcdHRoaXMuX2RiLnRoZW4oZGIgPT4ge1xyXG5cdFx0XHRcdGRiLnRyYW5zYWN0aW9uKHRoaXMubmFtZSwgXCJyZWFkd3JpdGVcIilcclxuXHRcdFx0XHRcdC5vYmplY3RTdG9yZSh0aGlzLm5hbWUpXHJcblx0XHRcdFx0XHQucHV0KHZhbHVlKTtcclxuXHRcdFx0fSk7XHJcblxyXG5cdFx0XHQvLyBzeW5jIHRoZSBjaGFuZ2VzIHRvIHRoZSBzZXJ2ZXJcclxuXHRcdFx0dGhpcy5lbWl0KFwic3luYy1wdXRcIiwgdmFsdWUpO1xyXG5cdFx0fVxyXG5cdH1cclxufVxyXG5cclxuLy8gZ2V0IGFuIGFycmF5IGZyb20gYW4gb2JqZWN0XHJcbnZhciBhcnJheUZyb21PYmplY3QgPSBmdW5jdGlvbihvYmopIHtcclxuXHRyZXR1cm4gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqKVxyXG5cdFx0Lm1hcChuYW1lID0+IG9ialtuYW1lXSk7XHJcbn07XHJcblxyXG4vLyBkb24ndCBjYWxsIGEgZnVuY3Rpb24gdG9vIG9mdGVuXHJcbnZhciBkZWJvdW5jZVRpbWVycyA9IHt9O1xyXG5cclxudmFyIGRlYm91bmNlID0gKGlkLCBmbikgPT4ge1xyXG5cdC8vIGNhbmNlbCB0aGUgcHJldmlvdXMgZGVsYXlcclxuXHRjbGVhclRpbWVvdXQoZGVib3VuY2VUaW1lcnNbaWRdKTtcclxuXHQvLyBzdGFydCBhIG5ldyBkZWxheVxyXG5cdGRlYm91bmNlVGltZXJzW2lkXSA9IHNldFRpbWVvdXQoZm4sIERFQk9VTkNFX1RJTUUpO1xyXG59O1xyXG4iLCIvKipcclxuICogQnJvd3NlciBzcGVjaWZpYyBnbG9iYWxzXHJcbiAqL1xyXG5cclxubGlmZUxpbmUubWFrZURvbSA9IHJlcXVpcmUoXCIuL3V0aWwvZG9tLW1ha2VyXCIpLmRlZmF1bHQ7XHJcbmxpZmVMaW5lLnN5bmNlciA9IHJlcXVpcmUoXCIuL3N5bmNlclwiKS5zeW5jZXI7XHJcblxyXG4vLyBhZGQgYSBmdW5jdGlvbiBmb3IgYWRkaW5nIGFjdGlvbnNcclxubGlmZUxpbmUuYWRkQWN0aW9uID0gZnVuY3Rpb24obmFtZSwgZm4pIHtcclxuXHQvLyBhdHRhY2ggdGhlIGNhbGxiYWNrXHJcblx0dmFyIGxpc3RlbmVyID0gbGlmZUxpbmUub24oXCJhY3Rpb24tZXhlYy1cIiArIG5hbWUsIGZuKTtcclxuXHJcblx0Ly8gaW5mb3JtIGFueSBhY3Rpb24gcHJvdmlkZXJzXHJcblx0bGlmZUxpbmUuZW1pdChcImFjdGlvbi1jcmVhdGVcIiwgbmFtZSk7XHJcblxyXG5cdC8vIGFsbCBhY3Rpb25zIHJlbW92ZWRcclxuXHR2YXIgcmVtb3ZlQWxsID0gbGlmZUxpbmUub24oXCJhY3Rpb24tcmVtb3ZlLWFsbFwiLCAoKSA9PiB7XHJcblx0XHQvLyByZW1vdmUgdGhlIGFjdGlvbiBsaXN0ZW5lclxyXG5cdFx0bGlzdGVuZXIudW5zdWJzY3JpYmUoKTtcclxuXHRcdHJlbW92ZUFsbC51bnN1YnNjcmliZSgpO1xyXG5cdH0pO1xyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0dW5zdWJzY3JpYmUoKSB7XHJcblx0XHRcdC8vIHJlbW92ZSB0aGUgYWN0aW9uIGxpc3RlbmVyXHJcblx0XHRcdGxpc3RlbmVyLnVuc3Vic2NyaWJlKCk7XHJcblx0XHRcdHJlbW92ZUFsbC51bnN1YnNjcmliZSgpO1xyXG5cclxuXHRcdFx0Ly8gaW5mb3JtIGFueSBhY3Rpb24gcHJvdmlkZXJzXHJcblx0XHRcdGxpZmVMaW5lLmVtaXQoXCJhY3Rpb24tcmVtb3ZlXCIsIG5hbWUpO1xyXG5cdFx0fVxyXG5cdH07XHJcbn07XHJcbiIsIi8vIGNyZWF0ZSB0aGUgZ2xvYmFsIG9iamVjdFxyXG5pbXBvcnQgXCIuLi9jb21tb24vZ2xvYmFsXCI7XHJcbmltcG9ydCBcIi4vZ2xvYmFsXCI7XHJcblxyXG4vLyBsb2FkIGFsbCB0aGUgd2lkZ2V0c1xyXG5pbXBvcnQgXCIuL3dpZGdldHMvc2lkZWJhclwiO1xyXG5pbXBvcnQgXCIuL3dpZGdldHMvY29udGVudFwiO1xyXG5pbXBvcnQgXCIuL3dpZGdldHMvbGlua1wiO1xyXG5pbXBvcnQgXCIuL3dpZGdldHMvbGlzdFwiO1xyXG5pbXBvcnQgXCIuL3dpZGdldHMvaW5wdXRcIjtcclxuaW1wb3J0IFwiLi93aWRnZXRzL3RvZ2dsZS1idG5zXCI7XHJcblxyXG4vLyBsb2FkIGFsbCB0aGUgdmlld3NcclxuaW1wb3J0IHtpbml0TmF2QmFyfSBmcm9tIFwiLi92aWV3cy9saXN0c1wiO1xyXG5pbXBvcnQgXCIuL3ZpZXdzL2l0ZW1cIjtcclxuaW1wb3J0IFwiLi92aWV3cy9lZGl0XCI7XHJcbmltcG9ydCBcIi4vdmlld3MvbG9naW5cIjtcclxuaW1wb3J0IFwiLi92aWV3cy9hY2NvdW50XCI7XHJcbmltcG9ydCBcIi4vdmlld3MvdXNlcnNcIjtcclxuaW1wb3J0IFwiLi92aWV3cy90b2RvXCI7XHJcblxyXG4vLyBzZXQgdXAgdGhlIGRhdGEgc3RvcmVcclxuaW1wb3J0IHtzdG9yZX0gZnJvbSBcIi4vZGF0YS1zdG9yZVwiO1xyXG5cclxuc3RvcmUoXCJhc3NpZ25tZW50c1wiKS5zZXRJbml0KGZ1bmN0aW9uKGl0ZW0pIHtcclxuXHQvLyBwYXJzZSB0aGUgZGF0ZVxyXG5cdGlmKHR5cGVvZiBpdGVtLmRhdGUgPT0gXCJzdHJpbmdcIikge1xyXG5cdFx0aXRlbS5kYXRlID0gbmV3IERhdGUoaXRlbS5kYXRlKTtcclxuXHR9XHJcbn0pO1xyXG5cclxuLy8gaW5zdGFudGlhdGUgdGhlIGRvbVxyXG5saWZlTGluZS5tYWtlRG9tKHtcclxuXHRwYXJlbnQ6IGRvY3VtZW50LmJvZHksXHJcblx0Z3JvdXA6IFtcclxuXHRcdHsgd2lkZ2V0OiBcInNpZGViYXJcIiB9LFxyXG5cdFx0eyB3aWRnZXQ6IFwiY29udGVudFwiIH1cclxuXHRdXHJcbn0pO1xyXG5cclxuLy8gQWRkIGEgbGluayB0byB0aGUgdG9kYS9ob21lIHBhZ2VcclxubGlmZUxpbmUuYWRkTmF2Q29tbWFuZChcIlRvZG9cIiwgXCIvXCIpO1xyXG5cclxuLy8gYWRkIGxpc3Qgdmlld3MgdG8gdGhlIG5hdmJhclxyXG5pbml0TmF2QmFyKCk7XHJcblxyXG4vLyBjcmVhdGUgYSBuZXcgYXNzaWdubWVudFxyXG5saWZlTGluZS5hZGRDb21tYW5kKFwiTmV3IGFzc2lnbm1lbnRcIiwgKCkgPT4ge1xyXG5cdHZhciBpZCA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwMDAwMCk7XHJcblxyXG5cdGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZShcIi9lZGl0L1wiICsgaWQpO1xyXG59KTtcclxuXHJcbi8vIGNyZWF0ZSB0aGUgbG9nb3V0IGJ1dHRvblxyXG5saWZlTGluZS5hZGROYXZDb21tYW5kKFwiQWNjb3VudFwiLCBcIi9hY2NvdW50XCIpO1xyXG4iLCIvKipcclxuICogU3luY3Jvbml6ZSB0aGlzIGNsaWVudCB3aXRoIHRoZSBzZXJ2ZXJcclxuICovXHJcblxyXG5pbXBvcnQge3N0b3JlIGFzIGRhdGFTdG9yZX0gZnJvbSBcIi4vZGF0YS1zdG9yZVwiO1xyXG5cclxud2luZG93LnN5bmNTdG9yZSA9IGRhdGFTdG9yZShcInN5bmMtc3RvcmVcIik7XHJcblxyXG5jb25zdCBTVE9SRVMgPSBbXCJhc3NpZ25tZW50c1wiXTtcclxuXHJcbi8vIGNyZWF0ZSB0aGUgZ2xvYmFsIHN5bmNlciByZWZyZW5jZVxyXG5leHBvcnQgdmFyIHN5bmNlciA9IG5ldyBsaWZlTGluZS5FdmVudEVtaXR0ZXIoKTtcclxuXHJcbi8vIHNhdmUgc3Vic2NyaXB0aW9ucyB0byBkYXRhIHN0b3JlIHN5bmMgZXZlbnRzIHNvIHdlIGRvbnQgdHJpZ2dlciBvdXIgc2VsZiB3aGVuIHdlIHN5bmNcclxudmFyIHN5bmNTdWJzID0gW107XHJcblxyXG4vLyBkb24ndCBzeW5jIHdoaWxlIHdlIGFyZSBzeW5jaW5nXHJcbnZhciBpc1N5bmNpbmcgPSBmYWxzZTtcclxudmFyIHN5bmNBZ2FpbiA9IGZhbHNlO1xyXG5cclxuLy8gYWRkIGEgY2hhbmdlIHRvIHRoZSBzeW5jIHF1ZXVlXHJcbnZhciBlbnF1ZXVlQ2hhbmdlID0gY2hhbmdlID0+IHtcclxuXHQvLyBsb2FkIHRoZSBxdWV1ZVxyXG5cdHJldHVybiBzeW5jU3RvcmUuZ2V0KFwiY2hhbmdlLXF1ZXVlXCIpXHJcblxyXG5cdC50aGVuKCh7Y2hhbmdlcyA9IFtdfSA9IHt9KSA9PiB7XHJcblx0XHQvLyBnZXQgdGhlIGlkIGZvciB0aGUgY2hhbmdlXHJcblx0XHR2YXIgY2hJZCA9IGNoYW5nZS50eXBlID09IFwiZGVsZXRlXCIgPyBjaGFuZ2UuaWQgOiBjaGFuZ2UuZGF0YS5pZDtcclxuXHJcblx0XHR2YXIgZXhpc3RpbmcgPSBjaGFuZ2VzLmZpbmRJbmRleChjaCA9PlxyXG5cdFx0XHRjaC50eXBlID09IFwiZGVsZXRlXCIgPyBjaC5pZCA9PSBjaElkIDogY2guZGF0YS5pZCA9PSBjaElkKTtcclxuXHJcblx0XHQvLyByZW1vdmUgdGhlIGV4aXN0aW5nIGNoYW5nZVxyXG5cdFx0aWYoZXhpc3RpbmcgIT09IC0xKSB7XHJcblx0XHRcdGNoYW5nZXMuc3BsaWNlKGV4aXN0aW5nLCAxKTtcclxuXHRcdH1cclxuXHJcblx0XHQvLyBhZGQgdGhlIGNoYW5nZSB0byB0aGUgcXVldWVcclxuXHRcdGNoYW5nZXMucHVzaChjaGFuZ2UpO1xyXG5cclxuXHRcdC8vIHNhdmUgdGhlIHF1ZXVlXHJcblx0XHRyZXR1cm4gc3luY1N0b3JlLnNldCh7XHJcblx0XHRcdGlkOiBcImNoYW5nZS1xdWV1ZVwiLFxyXG5cdFx0XHRjaGFuZ2VzXHJcblx0XHR9KTtcclxuXHR9KVxyXG5cclxuXHQvLyBzeW5jIHdoZW4gaWRsZVxyXG5cdC50aGVuKCgpID0+IGlkbGUoc3luY2VyLnN5bmMpKTtcclxufTtcclxuXHJcbi8vIGFkZCBhIHN5bmMgbGlzdGVuZXIgdG8gYSBkYXRhIHN0b3JlXHJcbnZhciBvblN5bmMgPSBmdW5jdGlvbihkcywgbmFtZSwgZm4pIHtcclxuXHRzeW5jU3Vicy5wdXNoKGRzLm9uKFwic3luYy1cIiArIG5hbWUsIGZuKSk7XHJcbn07XHJcblxyXG4vLyB3aGVuIGEgZGF0YSBzdG9yZSBpcyBvcGVuZWQgbGlzdGVuIGZvciBjaGFuZ2VzXHJcbmxpZmVMaW5lLm9uKFwiZGF0YS1zdG9yZS1jcmVhdGVkXCIsIGRzID0+IHtcclxuXHQvLyBkb24ndCBzeW5jIHRoZSBzeW5jIHN0b3JlXHJcblx0aWYoZHMubmFtZSA9PSBcInN5bmMtc3RvcmVcIikgcmV0dXJuO1xyXG5cclxuXHQvLyBjcmVhdGUgYW5kIGVucXVldWUgYSBwdXQgY2hhbmdlXHJcblx0b25TeW5jKGRzLCBcInB1dFwiLCAodmFsdWUsIGlzTmV3KSA9PiB7XHJcblx0XHRlbnF1ZXVlQ2hhbmdlKHtcclxuXHRcdFx0c3RvcmU6IGRzLm5hbWUsXHJcblx0XHRcdHR5cGU6IGlzTmV3ID8gXCJjcmVhdGVcIiA6IFwicHV0XCIsXHJcblx0XHRcdGRhdGE6IHZhbHVlXHJcblx0XHR9KTtcclxuXHR9KTtcclxuXHJcblx0Ly8gY3JlYXRlIGFuZCBlbnF1ZXVlIGEgZGVsZXRlIGNoYW5nZVxyXG5cdG9uU3luYyhkcywgXCJkZWxldGVcIiwgaWQgPT4ge1xyXG5cdFx0ZW5xdWV1ZUNoYW5nZSh7XHJcblx0XHRcdHN0b3JlOiBkcy5uYW1lLFxyXG5cdFx0XHR0eXBlOiBcImRlbGV0ZVwiLFxyXG5cdFx0XHRpZCxcclxuXHRcdFx0dGltZXN0YW1wOiBEYXRlLm5vdygpXHJcblx0XHR9KTtcclxuXHR9KTtcclxufSk7XHJcblxyXG4vLyB3YWl0IGZvciBzb21lIGlkbGUgdGltZVxyXG52YXIgaWRsZSA9IGZuID0+IHtcclxuXHRpZih0eXBlb2YgcmVxdWVzdElkbGVDYWxsYmFjayA9PSBcImZ1bmN0aW9uXCIpIHtcclxuXHRcdHJlcXVlc3RJZGxlQ2FsbGJhY2soZm4pO1xyXG5cdH1cclxuXHRlbHNlIHtcclxuXHRcdHNldFRpbWVvdXQoZm4sIDEwMCk7XHJcblx0fVxyXG59O1xyXG5cclxuLy8gc3luYyB3aXRoIHRoZSBzZXJ2ZXJcclxuc3luY2VyLnN5bmMgPSBmdW5jdGlvbigpIHtcclxuXHQvLyBkb24ndCBzeW5jIHdoaWxlIG9mZmxpbmVcclxuXHRpZihuYXZpZ2F0b3Iub25saW5lKSB7XHJcblx0XHRyZXR1cm47XHJcblx0fVxyXG5cclxuXHQvLyBvbmx5IGRvIG9uZSBzeW5jIGF0IGEgdGltZVxyXG5cdGlmKGlzU3luY2luZykge1xyXG5cdFx0c3luY0FnYWluID0gdHJ1ZTtcclxuXHRcdHJldHVybjtcclxuXHR9XHJcblxyXG5cdGlzU3luY2luZyA9IHRydWU7XHJcblxyXG5cdGNvbnNvbGUubG9nKFwiU3luYyBzdGFydFwiKTtcclxuXHJcblx0Ly8gbG9hZCB0aGUgY2hhbmdlIHF1ZXVlXHJcblx0dmFyIHByb21pc2VzID0gW1xyXG5cdFx0c3luY1N0b3JlLmdldChcImNoYW5nZS1xdWV1ZVwiKS50aGVuKCh7Y2hhbmdlcyA9IFtdfSA9IHt9KSA9PiBjaGFuZ2VzKVxyXG5cdF07XHJcblxyXG5cdC8vIGxvYWQgYWxsIGlkc1xyXG5cdGZvcihsZXQgc3RvcmVOYW1lIG9mIFNUT1JFUykge1xyXG5cdFx0cHJvbWlzZXMucHVzaChcclxuXHRcdFx0ZGF0YVN0b3JlKHN0b3JlTmFtZSlcclxuXHRcdFx0XHQuZ2V0QWxsKClcclxuXHRcdFx0XHQudGhlbihpdGVtcyA9PiB7XHJcblx0XHRcdFx0XHR2YXIgZGF0ZXMgPSB7fTtcclxuXHJcblx0XHRcdFx0XHQvLyBtYXAgbW9kaWZpZWQgZGF0ZSB0byB0aGUgaWRcclxuXHRcdFx0XHRcdGl0ZW1zLmZvckVhY2goaXRlbSA9PiBkYXRlc1tpdGVtLmlkXSA9IGl0ZW0ubW9kaWZpZWQpO1xyXG5cclxuXHRcdFx0XHRcdHJldHVybiBbc3RvcmVOYW1lLCBkYXRlc107XHJcblx0XHRcdFx0fSlcclxuXHRcdCk7XHJcblx0fVxyXG5cclxuXHRQcm9taXNlLmFsbChwcm9taXNlcykudGhlbigoW2NoYW5nZXMsIC4uLm1vZGlmaWVkc10pID0+IHtcclxuXHRcdC8vIGNvbnZlcnQgbW9kaWZpZWRzIHRvIGFuIG9iamVjdFxyXG5cdFx0dmFyIG1vZGlmaWVkc09iaiA9IHt9O1xyXG5cclxuXHRcdG1vZGlmaWVkcy5mb3JFYWNoKG1vZGlmaWVkID0+IG1vZGlmaWVkc09ialttb2RpZmllZFswXV0gPSBtb2RpZmllZFsxXSk7XHJcblxyXG5cdFx0Ly8gc2VuZCB0aGUgY2hhbmdlcyB0byB0aGUgc2VydmVyXHJcblx0XHRyZXR1cm4gZmV0Y2goXCIvYXBpL2RhdGEvXCIsIHtcclxuXHRcdFx0bWV0aG9kOiBcIlBPU1RcIixcclxuXHRcdFx0Y3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxyXG5cdFx0XHRib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcblx0XHRcdFx0Y2hhbmdlcyxcclxuXHRcdFx0XHRtb2RpZmllZHM6IG1vZGlmaWVkc09ialxyXG5cdFx0XHR9KVxyXG5cdFx0fSk7XHJcblx0fSlcclxuXHJcblx0Ly8gcGFyc2UgdGhlIGJvZHlcclxuXHQudGhlbihyZXMgPT4gcmVzLmpzb24oKSlcclxuXHJcblx0Ly8gY2F0Y2ggYW55IG5ldHdvcmsgZXJyb3JzXHJcblx0LmNhdGNoKCgpID0+ICh7IHN0YXR1czogXCJmYWlsXCIsIGRhdGE6IHsgcmVhc29uOiBcIm5ldHdvcmstZXJyb3JcIiB9IH0pKVxyXG5cclxuXHQudGhlbigoe3N0YXR1cywgZGF0YTogcmVzdWx0cywgcmVhc29ufSkgPT4ge1xyXG5cdFx0Ly8gY2F0Y2ggYW55IGVycm9yXHJcblx0XHRpZihzdGF0dXMgPT0gXCJmYWlsXCIpIHtcclxuXHRcdFx0Ly8gbG9nIHRoZSB1c2VyIGluXHJcblx0XHRcdGlmKHJlc3VsdHMucmVhc29uID09IFwibG9nZ2VkLW91dFwiKSB7XHJcblx0XHRcdFx0bGlmZUxpbmUubmF2Lm5hdmlnYXRlKFwiL2xvZ2luXCIpO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0Ly8gY2xlYXIgdGhlIGNoYW5nZSBxdWV1ZVxyXG5cdFx0cmVzdWx0cy51bnNoaWZ0KFxyXG5cdFx0XHRzeW5jU3RvcmUuc2V0KHtcclxuXHRcdFx0XHRpZDogXCJjaGFuZ2UtcXVldWVcIixcclxuXHRcdFx0XHRjaGFuZ2VzOiBbXVxyXG5cdFx0XHR9KVxyXG5cdFx0KTtcclxuXHJcblx0XHQvLyBhcHBseSB0aGUgcmVzdWx0c1xyXG5cdFx0cmV0dXJuIFByb21pc2UuYWxsKFxyXG5cdFx0XHRyZXN1bHRzLm1hcCgocmVzdWx0LCBpbmRleCkgPT4ge1xyXG5cdFx0XHRcdC8vIGZpcnN0IHJlc3VsdCBpcyB0aGUgcHJvbWlzZSB0byByZXNldCB0aGUgY2hhbmdlIHF1ZXVlXHJcblx0XHRcdFx0aWYoaW5kZXggPT09IDApIHJldHVybiByZXN1bHQ7XHJcblx0XHRcdFx0Y29uc29sZS5sb2cocmVzdWx0KTtcclxuXHJcblx0XHRcdFx0Ly8gZGVsZXRlIHRoZSBsb2NhbCBjb3B5XHJcblx0XHRcdFx0aWYocmVzdWx0LmNvZGUgPT0gXCJpdGVtLWRlbGV0ZWRcIikge1xyXG5cdFx0XHRcdFx0bGV0IHN0b3JlID0gZGF0YVN0b3JlKHJlc3VsdC5zdG9yZSk7XHJcblxyXG5cdFx0XHRcdFx0cmV0dXJuIHN0b3JlLnJlbW92ZShyZXN1bHQuaWQsIHN5bmNTdWJzKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0Ly8gc2F2ZSB0aGUgbmV3ZXIgdmVyc2lvbiBmcm9tIHRoZSBzZXJ2ZXJcclxuXHRcdFx0XHRlbHNlIGlmKHJlc3VsdC5jb2RlID09IFwibmV3ZXItdmVyc2lvblwiKSB7XHJcblx0XHRcdFx0XHRsZXQgc3RvcmUgPSBkYXRhU3RvcmUocmVzdWx0LnN0b3JlKTtcclxuXHJcblx0XHRcdFx0XHRyZXR1cm4gc3RvcmUuc2V0KHJlc3VsdC5kYXRhLCBzeW5jU3VicywgeyBzYXZlTm93OiB0cnVlIH0pO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSlcclxuXHRcdCk7XHJcblx0fSlcclxuXHJcblx0LnRoZW4oKCkgPT4ge1xyXG5cdFx0Ly8gcmVsZWFzZSB0aGUgbG9ja1xyXG5cdFx0aXNTeW5jaW5nID0gZmFsc2U7XHJcblxyXG5cdFx0Ly8gdGhlcmUgd2FzIGFuIGF0dGVtcHQgdG8gc3luYyB3aGlsZSB3ZSB3aGVyZSBzeW5jaW5nXHJcblx0XHRpZihzeW5jQWdhaW4pIHtcclxuXHRcdFx0c3luY0FnYWluID0gZmFsc2U7XHJcblxyXG5cdFx0XHRpZGxlKHN5bmNlci5zeW5jKTtcclxuXHRcdH1cclxuXHJcblx0XHRjb25zb2xlLmxvZyhcIlN5bmMgY29tcGxldGVcIik7XHJcblx0fSk7XHJcbn07XHJcblxyXG4vLyBkb24ndCBhZGQgZXZlbnQgbGlzdGVuZXJzIGluIHRoZSBzZXJ2aWNlIHdvcmtlclxyXG5pZih0eXBlb2Ygd2luZG93ID09IFwiZnVuY3Rpb25cIikge1xyXG5cdC8vIHdoZW4gd2UgY29tZSBiYWNrIG9uIGxpbmUgc3luY1xyXG5cdHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwib25saW5lXCIsICgpID0+IHN5bmNlci5zeW5jKCkpO1xyXG5cclxuXHQvLyB3aGVuIHRoZSB1c2VyIG5hdmlnYXRlcyBiYWNrIHN5bmNcclxuXHR3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInZpc2liaWxpdHljaGFuZ2VcIiwgKCkgPT4ge1xyXG5cdFx0aWYoIWRvY3VtZW50LmhpZGRlbikge1xyXG5cdFx0XHRzeW5jZXIuc3luYygpO1xyXG5cdFx0fVxyXG5cdH0pO1xyXG59XHJcbiIsIi8qKlxyXG4gKiBEYXRlIHJlbGF0ZWQgdG9vbHNcclxuICovXHJcblxyXG4gLy8gY2hlY2sgaWYgdGhlIGRhdGVzIGFyZSB0aGUgc2FtZSBkYXlcclxuIGV4cG9ydCBmdW5jdGlvbiBpc1NhbWVEYXRlKGRhdGUxLCBkYXRlMikge1xyXG4gXHRyZXR1cm4gZGF0ZTEuZ2V0RnVsbFllYXIoKSA9PSBkYXRlMi5nZXRGdWxsWWVhcigpICYmXHJcbiBcdFx0ZGF0ZTEuZ2V0TW9udGgoKSA9PSBkYXRlMi5nZXRNb250aCgpICYmXHJcbiBcdFx0ZGF0ZTEuZ2V0RGF0ZSgpID09IGRhdGUyLmdldERhdGUoKTtcclxuIH07XHJcblxyXG4gLy8gY2hlY2sgaWYgYSBkYXRlIGlzIGxlc3MgdGhhbiBhbm90aGVyXHJcbiBleHBvcnQgZnVuY3Rpb24gaXNTb29uZXJEYXRlKGRhdGUxLCBkYXRlMikge1xyXG4gICAgIC8vIGNoZWNrIHRoZSB5ZWFyIGZpcnN0XHJcbiAgICAgaWYoZGF0ZTEuZ2V0RnVsbFllYXIoKSAhPSBkYXRlMi5nZXRGdWxsWWVhcigpKSB7XHJcbiAgICAgICAgIHJldHVybiBkYXRlMS5nZXRGdWxsWWVhcigpIDwgZGF0ZTIuZ2V0RnVsbFllYXIoKTtcclxuICAgICB9XHJcblxyXG4gICAgIC8vIGNoZWNrIHRoZSBtb250aCBuZXh0XHJcbiAgICAgaWYoZGF0ZTEuZ2V0TW9udGgoKSAhPSBkYXRlMi5nZXRNb250aCgpKSB7XHJcbiAgICAgICAgIHJldHVybiBkYXRlMS5nZXRNb250aCgpIDwgZGF0ZTIuZ2V0TW9udGgoKTtcclxuICAgICB9XHJcblxyXG4gICAgIC8vIGNoZWNrIHRoZSBkYXlcclxuICAgICByZXR1cm4gZGF0ZTEuZ2V0RGF0ZSgpIDwgZGF0ZTIuZ2V0RGF0ZSgpO1xyXG4gfTtcclxuXHJcbiAvLyBnZXQgdGhlIGRhdGUgZGF5cyBmcm9tIG5vd1xyXG4gZXhwb3J0IGZ1bmN0aW9uIGRheXNGcm9tTm93KGRheXMpIHtcclxuIFx0dmFyIGRhdGUgPSBuZXcgRGF0ZSgpO1xyXG5cclxuIFx0Ly8gYWR2YW5jZSB0aGUgZGF0ZVxyXG4gXHRkYXRlLnNldERhdGUoZGF0ZS5nZXREYXRlKCkgKyBkYXlzKTtcclxuXHJcbiBcdHJldHVybiBkYXRlO1xyXG4gfTtcclxuXHJcbiBjb25zdCBTVFJJTkdfREFZUyA9IFtcIlN1bmRheVwiLCBcIk1vbmRheVwiLCBcIlR1ZXNkYXlcIiwgXCJXZWRlbnNkYXlcIiwgXCJUaHVyc2RheVwiLCBcIkZyaWRheVwiLCBcIlNhdHVyZGF5XCJdO1xyXG5cclxuIC8vIGNvbnZlcnQgYSBkYXRlIHRvIGEgc3RyaW5nXHJcbiBleHBvcnQgZnVuY3Rpb24gc3RyaW5naWZ5RGF0ZShkYXRlLCBvcHRzID0ge30pIHtcclxuXHQgdmFyIHN0ckRhdGUsIHN0clRpbWUgPSBcIlwiO1xyXG5cclxuICAgICAvLyBjaGVjayBpZiB0aGUgZGF0ZSBpcyBiZWZvcmUgdG9kYXlcclxuICAgICB2YXIgYmVmb3JlTm93ID0gZGF0ZS5nZXRUaW1lKCkgPCBEYXRlLm5vdygpO1xyXG5cclxuIFx0Ly8gVG9kYXlcclxuIFx0aWYoaXNTYW1lRGF0ZShkYXRlLCBuZXcgRGF0ZSgpKSlcclxuIFx0XHRzdHJEYXRlID0gXCJUb2RheVwiO1xyXG5cclxuIFx0Ly8gVG9tb3Jyb3dcclxuIFx0ZWxzZSBpZihpc1NhbWVEYXRlKGRhdGUsIGRheXNGcm9tTm93KDEpKSAmJiAhYmVmb3JlTm93KVxyXG4gXHRcdHN0ckRhdGUgPSBcIlRvbW9ycm93XCI7XHJcblxyXG4gXHQvLyBkYXkgb2YgdGhlIHdlZWsgKHRoaXMgd2VlaylcclxuIFx0ZWxzZSBpZihpc1Nvb25lckRhdGUoZGF0ZSwgZGF5c0Zyb21Ob3coNykpICYmICFiZWZvcmVOb3cpXHJcbiBcdFx0c3RyRGF0ZSA9IFNUUklOR19EQVlTW2RhdGUuZ2V0RGF5KCldO1xyXG5cclxuIFx0Ly8gcHJpbnQgdGhlIGRhdGVcclxuIFx0ZWxzZVxyXG5cdCBcdHN0ckRhdGUgPSBgJHtTVFJJTkdfREFZU1tkYXRlLmdldERheSgpXX0gJHtkYXRlLmdldE1vbnRoKCkgKyAxfS8ke2RhdGUuZ2V0RGF0ZSgpfWA7XHJcblxyXG5cdC8vIGFkZCB0aGUgdGltZSBvblxyXG5cdGlmKG9wdHMuaW5jbHVkZVRpbWUgJiYgIWlzU2tpcFRpbWUoZGF0ZSwgb3B0cy5za2lwVGltZXMpKSB7XHJcblx0XHRyZXR1cm4gc3RyRGF0ZSArIFwiLCBcIiArIHN0cmluZ2lmeVRpbWUoZGF0ZSk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4gc3RyRGF0ZTtcclxuIH07XHJcblxyXG4vLyBjaGVjayBpZiB0aGlzIGlzIG9uZSBvZiB0aGUgZ2l2ZW4gc2tpcCB0aW1lc1xyXG5leHBvcnQgZnVuY3Rpb24gaXNTa2lwVGltZShkYXRlLCBza2lwcyA9IFtdKSB7XHJcblx0cmV0dXJuIHNraXBzLmZpbmQoc2tpcCA9PiB7XHJcblx0XHRyZXR1cm4gc2tpcC5ob3VyID09PSBkYXRlLmdldEhvdXJzKCkgJiYgc2tpcC5taW51dGUgPT09IGRhdGUuZ2V0TWludXRlcygpO1xyXG5cdH0pO1xyXG59O1xyXG5cclxuLy8gY29udmVydCBhIHRpbWUgdG8gYSBzdHJpbmdcclxuZXhwb3J0IGZ1bmN0aW9uIHN0cmluZ2lmeVRpbWUoZGF0ZSkge1xyXG5cdHZhciBob3VyID0gZGF0ZS5nZXRIb3VycygpO1xyXG5cclxuXHQvLyBnZXQgdGhlIGFtL3BtIHRpbWVcclxuXHR2YXIgaXNBbSA9IGhvdXIgPCAxMjtcclxuXHJcblx0Ly8gbWlkbmlnaHRcclxuXHRpZihob3VyID09PSAwKSBob3VyID0gMTI7XHJcblx0Ly8gYWZ0ZXIgbm9vblxyXG5cdGlmKGhvdXIgPiAxMikgaG91ciA9IGhvdXIgLSAxMjtcclxuXHJcblx0dmFyIG1pbnV0ZSA9IGRhdGUuZ2V0TWludXRlcygpO1xyXG5cclxuXHQvLyBhZGQgYSBsZWFkaW5nIDBcclxuXHRpZihtaW51dGUgPCAxMCkgbWludXRlID0gXCIwXCIgKyBtaW51dGU7XHJcblxyXG5cdHJldHVybiBob3VyICsgXCI6XCIgKyBtaW51dGUgKyAoaXNBbSA/IFwiYW1cIiA6IFwicG1cIik7XHJcbn1cclxuIiwiLyoqXHJcbiAqIEEgaGVscGVyIGZvciBidWlsZGluZyBkb20gbm9kZXNcclxuICovXHJcblxyXG5jb25zdCBTVkdfRUxFTUVOVFMgPSBbXCJzdmdcIiwgXCJsaW5lXCJdO1xyXG5jb25zdCBTVkdfTkFNRVNQQUNFID0gXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiO1xyXG5cclxuLy8gYnVpbGQgYSBzaW5nbGUgZG9tIG5vZGVcclxudmFyIG1ha2VEb20gPSBmdW5jdGlvbihvcHRzID0ge30pIHtcclxuXHQvLyBnZXQgb3IgY3JlYXRlIHRoZSBuYW1lIG1hcHBpbmdcclxuXHR2YXIgbWFwcGVkID0gb3B0cy5tYXBwZWQgfHwge307XHJcblxyXG5cdHZhciAkZWw7XHJcblxyXG5cdC8vIHRoZSBlbGVtZW50IGlzIHBhcnQgb2YgdGhlIHN2ZyBuYW1lc3BhY2VcclxuXHRpZihTVkdfRUxFTUVOVFMuaW5kZXhPZihvcHRzLnRhZykgIT09IC0xKSB7XHJcblx0XHQkZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoU1ZHX05BTUVTUEFDRSwgb3B0cy50YWcpO1xyXG5cdH1cclxuXHQvLyBhIHBsYWluIGVsZW1lbnRcclxuXHRlbHNlIHtcclxuXHRcdCRlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQob3B0cy50YWcgfHwgXCJkaXZcIik7XHJcblx0fVxyXG5cclxuXHQvLyBzZXQgdGhlIGNsYXNzZXNcclxuXHRpZihvcHRzLmNsYXNzZXMpIHtcclxuXHRcdCRlbC5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCB0eXBlb2Ygb3B0cy5jbGFzc2VzID09IFwic3RyaW5nXCIgPyBvcHRzLmNsYXNzZXMgOiBvcHRzLmNsYXNzZXMuam9pbihcIiBcIikpO1xyXG5cdH1cclxuXHJcblx0Ly8gYXR0YWNoIHRoZSBhdHRyaWJ1dGVzXHJcblx0aWYob3B0cy5hdHRycykge1xyXG5cdFx0T2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob3B0cy5hdHRycylcclxuXHJcblx0XHQuZm9yRWFjaChhdHRyID0+ICRlbC5zZXRBdHRyaWJ1dGUoYXR0ciwgb3B0cy5hdHRyc1thdHRyXSkpO1xyXG5cdH1cclxuXHJcblx0Ly8gc2V0IHRoZSB0ZXh0IGNvbnRlbnRcclxuXHRpZihvcHRzLnRleHQpIHtcclxuXHRcdCRlbC5pbm5lclRleHQgPSBvcHRzLnRleHQ7XHJcblx0fVxyXG5cclxuXHQvLyBhdHRhY2ggdGhlIG5vZGUgdG8gaXRzIHBhcmVudFxyXG5cdGlmKG9wdHMucGFyZW50KSB7XHJcblx0XHRvcHRzLnBhcmVudC5pbnNlcnRCZWZvcmUoJGVsLCBvcHRzLmJlZm9yZSk7XHJcblx0fVxyXG5cclxuXHQvLyBhZGQgZXZlbnQgbGlzdGVuZXJzXHJcblx0aWYob3B0cy5vbikge1xyXG5cdFx0Zm9yKGxldCBuYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKG9wdHMub24pKSB7XHJcblx0XHRcdCRlbC5hZGRFdmVudExpc3RlbmVyKG5hbWUsIG9wdHMub25bbmFtZV0pO1xyXG5cclxuXHRcdFx0Ly8gYXR0YWNoIHRoZSBkb20gdG8gYSBkaXNwb3NhYmxlXHJcblx0XHRcdGlmKG9wdHMuZGlzcCkge1xyXG5cdFx0XHRcdG9wdHMuZGlzcC5hZGQoe1xyXG5cdFx0XHRcdFx0dW5zdWJzY3JpYmU6ICgpID0+ICRlbC5yZW1vdmVFdmVudExpc3RlbmVyKG5hbWUsIG9wdHMub25bbmFtZV0pXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9XHJcblxyXG5cdC8vIHNldCB0aGUgdmFsdWUgb2YgYW4gaW5wdXQgZWxlbWVudFxyXG5cdGlmKG9wdHMudmFsdWUpIHtcclxuXHRcdCRlbC52YWx1ZSA9IG9wdHMudmFsdWU7XHJcblx0fVxyXG5cclxuXHQvLyBhZGQgdGhlIG5hbWUgbWFwcGluZ1xyXG5cdGlmKG9wdHMubmFtZSkge1xyXG5cdFx0bWFwcGVkW29wdHMubmFtZV0gPSAkZWw7XHJcblx0fVxyXG5cclxuXHQvLyBjcmVhdGUgdGhlIGNoaWxkIGRvbSBub2Rlc1xyXG5cdGlmKG9wdHMuY2hpbGRyZW4pIHtcclxuXHRcdGZvcihsZXQgY2hpbGQgb2Ygb3B0cy5jaGlsZHJlbikge1xyXG5cdFx0XHQvLyBtYWtlIGFuIGFycmF5IGludG8gYSBncm91cCBPYmplY3RcclxuXHRcdFx0aWYoQXJyYXkuaXNBcnJheShjaGlsZCkpIHtcclxuXHRcdFx0XHRjaGlsZCA9IHtcclxuXHRcdFx0XHRcdGdyb3VwOiBjaGlsZFxyXG5cdFx0XHRcdH07XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIGF0dGFjaCBpbmZvcm1hdGlvbiBmb3IgdGhlIGdyb3VwXHJcblx0XHRcdGNoaWxkLnBhcmVudCA9ICRlbDtcclxuXHRcdFx0Y2hpbGQuZGlzcCA9IG9wdHMuZGlzcDtcclxuXHRcdFx0Y2hpbGQubWFwcGVkID0gbWFwcGVkO1xyXG5cclxuXHRcdFx0Ly8gYnVpbGQgdGhlIG5vZGUgb3IgZ3JvdXBcclxuXHRcdFx0bWFrZShjaGlsZCk7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHRyZXR1cm4gbWFwcGVkO1xyXG59XHJcblxyXG4vLyBidWlsZCBhIGdyb3VwIG9mIGRvbSBub2Rlc1xyXG52YXIgbWFrZUdyb3VwID0gZnVuY3Rpb24oZ3JvdXApIHtcclxuXHQvLyBzaG9ydGhhbmQgZm9yIGEgZ3JvdXBzXHJcblx0aWYoQXJyYXkuaXNBcnJheShncm91cCkpIHtcclxuXHRcdGdyb3VwID0ge1xyXG5cdFx0XHRjaGlsZHJlbjogZ3JvdXBcclxuXHRcdH07XHJcblx0fVxyXG5cclxuXHQvLyBnZXQgb3IgY3JlYXRlIHRoZSBuYW1lIG1hcHBpbmdcclxuXHR2YXIgbWFwcGVkID0ge307XHJcblxyXG5cdGZvcihsZXQgbm9kZSBvZiBncm91cC5ncm91cCkge1xyXG5cdFx0Ly8gY29weSBvdmVyIHByb3BlcnRpZXMgZnJvbSB0aGUgZ3JvdXBcclxuXHRcdG5vZGUucGFyZW50IHx8IChub2RlLnBhcmVudCA9IGdyb3VwLnBhcmVudCk7XHJcblx0XHRub2RlLmRpc3AgfHwgKG5vZGUuZGlzcCA9IGdyb3VwLmRpc3ApO1xyXG5cdFx0bm9kZS5tYXBwZWQgPSBtYXBwZWQ7XHJcblxyXG5cdFx0Ly8gbWFrZSB0aGUgZG9tXHJcblx0XHRtYWtlKG5vZGUpO1xyXG5cdH1cclxuXHJcblx0Ly8gY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgbWFwcGVkIG5hbWVzXHJcblx0aWYoZ3JvdXAuYmluZCkge1xyXG5cdFx0dmFyIHN1YnNjcmlwdGlvbiA9IGdyb3VwLmJpbmQobWFwcGVkKTtcclxuXHJcblx0XHQvLyBpZiB0aGUgcmV0dXJuIGEgc3Vic2NyaXB0aW9uIGF0dGFjaCBpdCB0byB0aGUgZGlzcG9zYWJsZVxyXG5cdFx0aWYoc3Vic2NyaXB0aW9uICYmIGdyb3VwLmRpc3ApIHtcclxuXHRcdFx0Z3JvdXAuZGlzcC5hZGQoc3Vic2NyaXB0aW9uKTtcclxuXHRcdH1cclxuXHR9XHJcblxyXG5cdHJldHVybiBtYXBwZWQ7XHJcbn07XHJcblxyXG4vLyBhIGNvbGxlY3Rpb24gb2Ygd2lkZ2V0c1xyXG52YXIgd2lkZ2V0cyA9IHt9O1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbWFrZShvcHRzKSB7XHJcblx0Ly8gaGFuZGxlIGEgZ3JvdXBcclxuXHRpZihBcnJheS5pc0FycmF5KG9wdHMpIHx8IG9wdHMuZ3JvdXApIHtcclxuXHRcdHJldHVybiBtYWtlR3JvdXAob3B0cyk7XHJcblx0fVxyXG5cdC8vIG1ha2UgYSB3aWRnZXRcclxuXHRlbHNlIGlmKG9wdHMud2lkZ2V0KSB7XHJcblx0XHR2YXIgd2lkZ2V0ID0gd2lkZ2V0c1tvcHRzLndpZGdldF07XHJcblxyXG5cdFx0Ly8gbm90IGRlZmluZWRcclxuXHRcdGlmKCF3aWRnZXQpIHtcclxuXHRcdFx0dGhyb3cgbmV3IEVycm9yKGBXaWRnZXQgJyR7b3B0cy53aWRnZXR9JyBpcyBub3QgZGVmaW5lZCBtYWtlIHN1cmUgaXRzIGJlZW4gaW1wb3J0ZWRgKTtcclxuXHRcdH1cclxuXHJcblx0XHQvLyBnZW5lcmF0ZSB0aGUgd2lkZ2V0IGNvbnRlbnRcclxuXHRcdHZhciBidWlsdCA9IHdpZGdldC5tYWtlKG9wdHMpO1xyXG5cclxuXHRcdHJldHVybiBtYWtlR3JvdXAoe1xyXG5cdFx0XHRwYXJlbnQ6IG9wdHMucGFyZW50LFxyXG5cdFx0XHRkaXNwOiBvcHRzLmRpc3AsXHJcblx0XHRcdGdyb3VwOiBBcnJheS5pc0FycmF5KGJ1aWx0KSA/IGJ1aWx0IDogW2J1aWx0XSxcclxuXHRcdFx0YmluZDogd2lkZ2V0LmJpbmQgJiYgd2lkZ2V0LmJpbmQuYmluZCh3aWRnZXQsIG9wdHMpXHJcblx0XHR9KTtcclxuXHR9XHJcblx0Ly8gbWFrZSBhIHNpbmdsZSBub2RlXHJcblx0ZWxzZSB7XHJcblx0XHRyZXR1cm4gbWFrZURvbShvcHRzKTtcclxuXHR9XHJcbn07XHJcblxyXG4vLyByZWdpc3RlciBhIHdpZGdldFxyXG5tYWtlLnJlZ2lzdGVyID0gZnVuY3Rpb24obmFtZSwgd2lkZ2V0KSB7XHJcblx0d2lkZ2V0c1tuYW1lXSA9IHdpZGdldDtcclxufTtcclxuIiwiLyoqXHJcbiAqIEEgdmlldyBmb3IgYWNjZXNzaW5nL21vZGlmeWluZyBpbmZvcm1hdGlvbiBhYm91dCB0aGUgY3VycmVudCB1c2VyXHJcbiAqL1xyXG5cclxuaW1wb3J0IHtnZW5CYWNrdXBOYW1lfSBmcm9tIFwiLi4vLi4vY29tbW9uL2JhY2t1cFwiO1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyOiAvXig/OlxcL3VzZXJcXC8oLis/KXxcXC9hY2NvdW50KSQvLFxyXG5cclxuXHRtYWtlKHtzZXRUaXRsZSwgY29udGVudCwgbWF0Y2h9KSB7XHJcblx0XHRzZXRUaXRsZShcIkFjY291bnRcIik7XHJcblxyXG5cdFx0dmFyIHVybCA9IFwiL2FwaS9hdXRoL2luZm8vZ2V0XCI7XHJcblxyXG5cdFx0Ly8gYWRkIHRoZSB1c2VybmFtZSBpZiBvbmUgaXMgZ2l2ZW5cclxuXHRcdGlmKG1hdGNoWzFdKSB1cmwgKz0gYD91c2VybmFtZT0ke21hdGNoWzFdfWA7XHJcblxyXG5cdFx0Ly8gbG9hZCB0aGUgdXNlciBkYXRhXHJcblx0XHRmZXRjaCh1cmwsIHsgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiIH0pXHJcblxyXG5cdFx0LnRoZW4ocmVzID0+IHJlcy5qc29uKCkpXHJcblxyXG5cdFx0LnRoZW4ocmVzID0+IHtcclxuXHRcdFx0Ly8gbm8gc3VjaCB1c2VyIG9yIGFjY2VzcyBpcyBkZW5pZWRcclxuXHRcdFx0aWYocmVzLnN0YXR1cyA9PSBcImZhaWxcIikge1xyXG5cdFx0XHRcdGxpZmVMaW5lLm1ha2VEb20oe1xyXG5cdFx0XHRcdFx0cGFyZW50OiBjb250ZW50LFxyXG5cdFx0XHRcdFx0Y2xhc3NlczogXCJjb250ZW50LXBhZGRlZFwiLFxyXG5cdFx0XHRcdFx0dGV4dDogXCJDb3VsZCBub3QgYWNjZXNzIHRoZSB1c2VyIHlvdSB3ZXJlIGxvb2tpbmcgZm9yXCJcclxuXHRcdFx0XHR9KTtcclxuXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIgdXNlciA9IHJlcy5kYXRhO1xyXG5cclxuXHRcdFx0Ly8gZ2VuZXJhdGUgdGhlIHBhZ2VcclxuXHRcdFx0dmFyIGNoaWxkcmVuID0gW107XHJcblxyXG5cdFx0XHRjaGlsZHJlbi5wdXNoKHtcclxuXHRcdFx0XHR0YWc6IFwiaDJcIixcclxuXHRcdFx0XHR0ZXh0OiB1c2VyLnVzZXJuYW1lXHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0Ly8gZGlzcGxheSB0aGUgYWRtaW4gc3RhdHVzIG9mIGFub3RoZXIgdXNlclxyXG5cdFx0XHRpZihtYXRjaFsxXSkge1xyXG5cdFx0XHRcdGNoaWxkcmVuLnB1c2goe1xyXG5cdFx0XHRcdFx0dGV4dDogYCR7dXNlci51c2VybmFtZX0gaXMgJHt1c2VyLmFkbWluID8gXCJcIiA6IFwibm90XCJ9IGFuIGFkbWluYFxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHRcdC8vIGRpc3BsYXkgdGhlIGFkbWluIHN0YXR1cyBvZiB0aGlzIHVzZXJcclxuXHRcdFx0ZWxzZSB7XHJcblx0XHRcdFx0Y2hpbGRyZW4ucHVzaCh7XHJcblx0XHRcdFx0XHR0ZXh0OiBgWW91IGFyZSAke3VzZXIuYWRtaW4gPyBcIlwiIDogXCJub3RcIn0gYW4gYWRtaW5gXHJcblx0XHRcdFx0fSk7XHJcblxyXG5cdFx0XHRcdC8vIGFkZCBhIGxpbmsgYXQgYSBsaXN0IG9mIGFsbCB1c2Vyc1xyXG5cdFx0XHRcdGlmKHVzZXIuYWRtaW4pIHtcclxuXHRcdFx0XHRcdGNoaWxkcmVuLnB1c2goeyB0YWc6IFwiYnJcIiB9KTtcclxuXHJcblx0XHRcdFx0XHRjaGlsZHJlbi5wdXNoKHtcclxuXHRcdFx0XHRcdFx0d2lkZ2V0OiBcImxpbmtcIixcclxuXHRcdFx0XHRcdFx0aHJlZjogXCIvdXNlcnNcIixcclxuXHRcdFx0XHRcdFx0dGV4dDogXCJWaWV3IGFsbCB1c2Vyc1wiXHJcblx0XHRcdFx0XHR9KTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIGNyZWF0ZSBhIGJhY2t1cCBsaW5rXHJcblx0XHRcdGlmKCFtYXRjaFsxXSkge1xyXG5cdFx0XHRcdGNoaWxkcmVuLnB1c2goeyB0YWc6IFwiYnJcIiB9KTtcclxuXHRcdFx0XHRjaGlsZHJlbi5wdXNoKHsgdGFnOiBcImJyXCIgfSk7XHJcblxyXG5cdFx0XHRcdGNoaWxkcmVuLnB1c2goe1xyXG5cdFx0XHRcdFx0dGFnOiBcImFcIixcclxuXHRcdFx0XHRcdHRleHQ6IFwiRG93bmxvYWQgYmFja3VwXCIsXHJcblx0XHRcdFx0XHRhdHRyczoge1xyXG5cdFx0XHRcdFx0XHRocmVmOiBcIi9hcGkvYmFja3VwXCIsXHJcblx0XHRcdFx0XHRcdGRvd25sb2FkOiBnZW5CYWNrdXBOYW1lKClcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9KTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIHBhc3N3b3JkQ2hhbmdlID0ge307XHJcblxyXG5cdFx0XHRjaGlsZHJlbi5wdXNoKHtcclxuXHRcdFx0XHR0YWc6IFwiZm9ybVwiLFxyXG5cdFx0XHRcdGNoaWxkcmVuOiBbXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdGNsYXNzZXM6IFwiZWRpdG9yLXJvd1wiLFxyXG5cdFx0XHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRcdHdpZGdldDogXCJpbnB1dFwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0dHlwZTogXCJwYXNzd29yZFwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0cGxhY2Vob2xkZXI6IFwiT2xkIHBhc3N3b3JkXCIsXHJcblx0XHRcdFx0XHRcdFx0XHRiaW5kOiBwYXNzd29yZENoYW5nZSxcclxuXHRcdFx0XHRcdFx0XHRcdHByb3A6IFwib2xkUGFzc3dvcmRcIlxyXG5cdFx0XHRcdFx0XHRcdH0sXHJcblx0XHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdFx0d2lkZ2V0OiBcImlucHV0XCIsXHJcblx0XHRcdFx0XHRcdFx0XHR0eXBlOiBcInBhc3N3b3JkXCIsXHJcblx0XHRcdFx0XHRcdFx0XHRwbGFjZWhvbGRlcjogXCJOZXcgcGFzc3dvcmRcIixcclxuXHRcdFx0XHRcdFx0XHRcdGJpbmQ6IHBhc3N3b3JkQ2hhbmdlLFxyXG5cdFx0XHRcdFx0XHRcdFx0cHJvcDogXCJwYXNzd29yZFwiXHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHRdXHJcblx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHR0YWc6IFwiYnV0dG9uXCIsXHJcblx0XHRcdFx0XHRcdGNsYXNzZXM6IFwiZmFuY3ktYnV0dG9uXCIsXHJcblx0XHRcdFx0XHRcdHRleHQ6IFwiQ2hhbmdlIHBhc3N3b3JkXCIsXHJcblx0XHRcdFx0XHRcdGF0dHJzOiB7XHJcblx0XHRcdFx0XHRcdFx0dHlwZTogXCJzdWJtaXRcIlxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRuYW1lOiBcIm1zZ1wiXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XSxcclxuXHRcdFx0XHRvbjoge1xyXG5cdFx0XHRcdFx0Ly8gY2hhbmdlIHRoZSBwYXNzd29yZFxyXG5cdFx0XHRcdFx0c3VibWl0OiBlID0+IHtcclxuXHRcdFx0XHRcdFx0ZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG5cclxuXHRcdFx0XHRcdFx0Ly8gbm8gcGFzc3dvcmQgc3VwcGxpZWRcclxuXHRcdFx0XHRcdFx0aWYoIXBhc3N3b3JkQ2hhbmdlLnBhc3N3b3JkKSB7XHJcblx0XHRcdFx0XHRcdFx0c2hvd01zZyhcIkVudGVyIGEgbmV3IHBhc3N3b3JkXCIpO1xyXG5cdFx0XHRcdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdFx0Ly8gc2VuZCB0aGUgcGFzc3dvcmQgY2hhbmdlIHJlcXVlc3RcclxuXHRcdFx0XHRcdFx0ZmV0Y2goYC9hcGkvYXV0aC9pbmZvL3NldD91c2VybmFtZT0ke3VzZXIudXNlcm5hbWV9YCwge1xyXG5cdFx0XHRcdFx0XHRcdGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcclxuXHRcdFx0XHRcdFx0XHRtZXRob2Q6IFwiUE9TVFwiLFxyXG5cdFx0XHRcdFx0XHRcdGJvZHk6IEpTT04uc3RyaW5naWZ5KHBhc3N3b3JkQ2hhbmdlKVxyXG5cdFx0XHRcdFx0XHR9KVxyXG5cclxuXHRcdFx0XHRcdFx0LnRoZW4ocmVzID0+IHJlcy5qc29uKCkpXHJcblxyXG5cdFx0XHRcdFx0XHQudGhlbihyZXMgPT4ge1xyXG5cdFx0XHRcdFx0XHRcdC8vIHBhc3N3b3JkIGNoYW5nZSBmYWlsZWRcclxuXHRcdFx0XHRcdFx0XHRpZihyZXMuc3RhdHVzID09IFwiZmFpbFwiKSB7XHJcblx0XHRcdFx0XHRcdFx0XHRzaG93TXNnKHJlcy5kYXRhLm1zZyk7XHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdFx0XHRpZihyZXMuc3RhdHVzID09IFwic3VjY2Vzc1wiKSB7XHJcblx0XHRcdFx0XHRcdFx0XHRzaG93TXNnKFwiUGFzc3dvcmQgY2hhbmdlZFwiKTtcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdH0pO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSk7XHJcblxyXG5cdFx0XHRjaGlsZHJlbi5wdXNoKHsgdGFnOiBcImJyXCIgfSk7XHJcblx0XHRcdGNoaWxkcmVuLnB1c2goeyB0YWc6IFwiYnJcIiB9KTtcclxuXHJcblx0XHRcdC8vIG9ubHkgZGlzcGxheSB0aGUgbG9nb3V0IGJ1dHRvbiBpZiB3ZSBhcmUgb24gdGhlIC9hY2NvdW50IHBhZ2VcclxuXHRcdFx0aWYoIW1hdGNoWzFdKSB7XHJcblx0XHRcdFx0Y2hpbGRyZW4ucHVzaCh7XHJcblx0XHRcdFx0XHR0YWc6IFwiYnV0dG9uXCIsXHJcblx0XHRcdFx0XHRjbGFzc2VzOiBcImZhbmN5LWJ1dHRvblwiLFxyXG5cdFx0XHRcdFx0dGV4dDogXCJMb2dvdXRcIixcclxuXHRcdFx0XHRcdG9uOiB7XHJcblx0XHRcdFx0XHRcdGNsaWNrOiAoKSA9PiB7XHJcblx0XHRcdFx0XHRcdFx0Ly8gc2VuZCB0aGUgbG9nb3V0IHJlcXVlc3RcclxuXHRcdFx0XHRcdFx0XHRmZXRjaChcIi9hcGkvYXV0aC9sb2dvdXRcIiwgeyBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIgfSlcclxuXHJcblx0XHRcdFx0XHRcdFx0Ly8gcmV0dXJuIHRvIHRoZSBsb2dpbiBwYWdlXHJcblx0XHRcdFx0XHRcdFx0LnRoZW4oKCkgPT4gbGlmZUxpbmUubmF2Lm5hdmlnYXRlKFwiL2xvZ2luXCIpKTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHR2YXIge21zZ30gPSBsaWZlTGluZS5tYWtlRG9tKHtcclxuXHRcdFx0XHRwYXJlbnQ6IGNvbnRlbnQsXHJcblx0XHRcdFx0Y2xhc3NlczogXCJjb250ZW50LXBhZGRlZFwiLFxyXG5cdFx0XHRcdGNoaWxkcmVuXHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0Ly8gc2hvdyBhIG1lc3NhZ2VcclxuXHRcdFx0dmFyIHNob3dNc2cgPSBmdW5jdGlvbih0ZXh0KSB7XHJcblx0XHRcdFx0bXNnLmlubmVyVGV4dCA9IHRleHQ7XHJcblx0XHRcdH07XHJcblx0XHR9KVxyXG5cdH1cclxufSk7XHJcbiIsIi8qKlxyXG4gKiBFZGl0IGFuIGFzc2lnbmVtbnRcclxuICovXHJcblxyXG5pbXBvcnQge2RheXNGcm9tTm93LCBzdHJpbmdpZnlEYXRlfSBmcm9tIFwiLi4vdXRpbC9kYXRlXCI7XHJcbmltcG9ydCB7c3RvcmV9IGZyb20gXCIuLi9kYXRhLXN0b3JlXCI7XHJcblxyXG52YXIgYXNzaWdubWVudHMgPSBzdG9yZShcImFzc2lnbm1lbnRzXCIpO1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyOiAvXlxcL2VkaXRcXC8oLis/KSQvLFxyXG5cclxuXHRtYWtlKHttYXRjaCwgY29udGVudCwgc2V0VGl0bGUsIGRpc3Bvc2FibGV9KSB7XHJcblx0XHR2YXIgYWN0aW9uU3ViLCBkZWxldGVTdWI7XHJcblxyXG5cdFx0Ly8gcHVzaCB0aGUgY2hhbmdlcyB0aHJvdWdoIHdoZW4gdGhlIHBhZ2UgaXMgY2xvc2VkXHJcblx0XHRkaXNwb3NhYmxlLmFkZCh7XHJcblx0XHRcdHVuc3Vic2NyaWJlOiAoKSA9PiBhc3NpZ25tZW50cy5mb3JjZVNhdmUoKVxyXG5cdFx0fSk7XHJcblxyXG5cdFx0dmFyIGNoYW5nZVN1YiA9IGFzc2lnbm1lbnRzLmdldChtYXRjaFsxXSwgZnVuY3Rpb24oaXRlbSkge1xyXG5cdFx0XHQvLyBjbGVhciB0aGUgY29udGVudFxyXG5cdFx0XHRjb250ZW50LmlubmVySFRNTCA9IFwiXCI7XHJcblxyXG5cdFx0XHQvLyByZW1vdmUgdGhlIHByZXZpb3VzIGFjdGlvblxyXG5cdFx0XHRpZihhY3Rpb25TdWIpIHtcclxuXHRcdFx0XHRhY3Rpb25TdWIudW5zdWJzY3JpYmUoKTtcclxuXHRcdFx0XHRkZWxldGVTdWIudW5zdWJzY3JpYmUoKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gYWRkIGEgYnV0dG9uIGJhY2sgdG8gdGhlIHZpZXdcclxuXHRcdFx0aWYoaXRlbSkge1xyXG5cdFx0XHRcdGFjdGlvblN1YiA9IGxpZmVMaW5lLmFkZEFjdGlvbihcIlZpZXdcIiwgKCkgPT4gbGlmZUxpbmUubmF2Lm5hdmlnYXRlKFwiL2l0ZW0vXCIgKyBpdGVtLmlkKSk7XHJcblxyXG5cdFx0XHRcdGRlbGV0ZVN1YiA9IGxpZmVMaW5lLmFkZEFjdGlvbihcIkRlbGV0ZVwiLCAoKSA9PiB7XHJcblx0XHRcdFx0XHQvLyByZW1vdmUgdGhlIGl0ZW1cclxuXHRcdFx0XHRcdGFzc2lnbm1lbnRzLnJlbW92ZShpdGVtLmlkKTtcclxuXHJcblx0XHRcdFx0XHQvLyBuYXZpZ2F0ZSBhd2F5XHJcblx0XHRcdFx0XHRsaWZlTGluZS5uYXYubmF2aWdhdGUoXCIvXCIpO1xyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBpZiB0aGUgaXRlbSBkb2VzIG5vdCBleGlzdCBjcmVhdGUgaXRcclxuXHRcdFx0aWYoIWl0ZW0pIHtcclxuXHRcdFx0XHRpdGVtID0ge1xyXG5cdFx0XHRcdFx0bmFtZTogXCJVbm5hbWVkIGl0ZW1cIixcclxuXHRcdFx0XHRcdGNsYXNzOiBcIkNsYXNzXCIsXHJcblx0XHRcdFx0XHRkYXRlOiBnZW5EYXRlKCksXHJcblx0XHRcdFx0XHRpZDogbWF0Y2hbMV0sXHJcblx0XHRcdFx0XHRkZXNjcmlwdGlvbjogXCJcIixcclxuXHRcdFx0XHRcdG1vZGlmaWVkOiBEYXRlLm5vdygpLFxyXG5cdFx0XHRcdFx0dHlwZTogXCJhc3NpZ25tZW50XCJcclxuXHRcdFx0XHR9O1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBzZXQgdGhlIGluaXRhbCB0aXRsZVxyXG5cdFx0XHRzZXRUaXRsZShcIkVkaXRpbmdcIik7XHJcblxyXG5cdFx0XHQvLyBzYXZlIGNoYW5nZXNcclxuXHRcdFx0dmFyIGNoYW5nZSA9ICgpID0+IHtcclxuXHRcdFx0XHQvLyB1cGRhdGUgdGhlIG1vZGlmaWVkIGRhdGVcclxuXHRcdFx0XHRpdGVtLm1vZGlmaWVkID0gRGF0ZS5ub3coKTtcclxuXHJcblx0XHRcdFx0Ly8gZmluZCB0aGUgZGF0ZSBhbmQgdGltZSBpbnB1dHNcclxuXHRcdFx0XHR2YXIgZGF0ZUlucHV0ID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcImlucHV0W3R5cGU9ZGF0ZV1cIik7XHJcblx0XHRcdFx0dmFyIHRpbWVJbnB1dCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCJpbnB1dFt0eXBlPXRpbWVdXCIpO1xyXG5cclxuXHRcdFx0XHQvLyBwYXJzZSB0aGUgZGF0ZVxyXG5cdFx0XHRcdGl0ZW0uZGF0ZSA9IG5ldyBEYXRlKGRhdGVJbnB1dC52YWx1ZSArIFwiIFwiICsgdGltZUlucHV0LnZhbHVlKTtcclxuXHJcblx0XHRcdFx0Ly8gcmVtb3ZlIGFzc2lnbmVtbnQgZmllbGRzIGZyb20gdGFza3NcclxuXHRcdFx0XHRpZihpdGVtLnR5cGUgPT0gXCJ0YXNrXCIpIHtcclxuXHRcdFx0XHRcdGRlbGV0ZSBpdGVtLmRhdGU7XHJcblx0XHRcdFx0XHRkZWxldGUgaXRlbS5jbGFzcztcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdC8vIGFkZCBhIGJ1dHRvbiBiYWNrIHRvIHRoZSB2aWV3XHJcblx0XHRcdFx0aWYoIWFjdGlvblN1Yikge1xyXG5cdFx0XHRcdFx0YWN0aW9uU3ViID0gbGlmZUxpbmUuYWRkQWN0aW9uKFwiVmlld1wiLCAoKSA9PiBsaWZlTGluZS5uYXYubmF2aWdhdGUoXCIvaXRlbS9cIiArIGl0ZW0uaWQpKTtcclxuXHJcblx0XHRcdFx0XHRkZWxldGVTdWIgPSBsaWZlTGluZS5hZGRBY3Rpb24oXCJEZWxldGVcIiwgKCkgPT4ge1xyXG5cdFx0XHRcdFx0XHQvLyByZW1vdmUgdGhlIGl0ZW1cclxuXHRcdFx0XHRcdFx0YXNzaWdubWVudHMucmVtb3ZlKGl0ZW0uaWQpO1xyXG5cclxuXHRcdFx0XHRcdFx0Ly8gbmF2aWdhdGUgYXdheVxyXG5cdFx0XHRcdFx0XHRsaWZlTGluZS5uYXYubmF2aWdhdGUoXCIvXCIpO1xyXG5cdFx0XHRcdFx0fSk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHQvLyBzYXZlIHRoZSBjaGFuZ2VzXHJcblx0XHRcdFx0YXNzaWdubWVudHMuc2V0KGl0ZW0sIGNoYW5nZVN1Yik7XHJcblx0XHRcdH07XHJcblxyXG5cdFx0XHQvLyBoaWRlIGFuZCBzaG93IHNwZWNpZmljIGZpZWxkcyBmb3IgZGlmZmVyZW50IGFzc2lnbm1lbnQgdHlwZXNcclxuXHRcdFx0dmFyIHRvZ2dsZUZpZWxkcyA9ICgpID0+IHtcclxuXHRcdFx0XHRpZihpdGVtLnR5cGUgPT0gXCJ0YXNrXCIpIHtcclxuXHRcdFx0XHRcdG1hcHBlZC5jbGFzc0ZpZWxkLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuXHRcdFx0XHRcdG1hcHBlZC5kYXRlRmllbGQuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRlbHNlIHtcclxuXHRcdFx0XHRcdG1hcHBlZC5jbGFzc0ZpZWxkLnN0eWxlLmRpc3BsYXkgPSBcIlwiO1xyXG5cdFx0XHRcdFx0bWFwcGVkLmRhdGVGaWVsZC5zdHlsZS5kaXNwbGF5ID0gXCJcIjtcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdC8vIGZpbGwgaW4gZGF0ZSBpZiBpdCBpcyBtaXNzaW5nXHJcblx0XHRcdFx0aWYoIWl0ZW0uZGF0ZSkge1xyXG5cdFx0XHRcdFx0aXRlbS5kYXRlID0gZ2VuRGF0ZSgpO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0aWYoIWl0ZW0uY2xhc3MpIHtcclxuXHRcdFx0XHRcdGl0ZW0uY2xhc3MgPSBcIkNsYXNzXCI7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9O1xyXG5cclxuXHRcdFx0Ly8gcmVuZGVyIHRoZSB1aVxyXG5cdFx0XHR2YXIgbWFwcGVkID0gbGlmZUxpbmUubWFrZURvbSh7XHJcblx0XHRcdFx0cGFyZW50OiBjb250ZW50LFxyXG5cdFx0XHRcdGdyb3VwOiBbXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdGNsYXNzZXM6IFwiZWRpdG9yLXJvd1wiLFxyXG5cdFx0XHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRcdHdpZGdldDogXCJpbnB1dFwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0YmluZDogaXRlbSxcclxuXHRcdFx0XHRcdFx0XHRcdHByb3A6IFwibmFtZVwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0Y2hhbmdlXHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHRdXHJcblx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRjbGFzc2VzOiBcImVkaXRvci1yb3dcIixcclxuXHRcdFx0XHRcdFx0Y2hpbGRyZW46IFtcclxuXHRcdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0XHR3aWRnZXQ6IFwidG9nZ2xlLWJ0bnNcIixcclxuXHRcdFx0XHRcdFx0XHRcdGJ0bnM6IFtcclxuXHRcdFx0XHRcdFx0XHRcdFx0eyB0ZXh0OiBcIkFzc2lnbm1lbnRcIiwgdmFsdWU6IFwiYXNzaWdubWVudFwiIH0sXHJcblx0XHRcdFx0XHRcdFx0XHRcdHsgdGV4dDogXCJUYXNrXCIsIHZhbHVlOiBcInRhc2tcIiB9LFxyXG5cdFx0XHRcdFx0XHRcdFx0XSxcclxuXHRcdFx0XHRcdFx0XHRcdHZhbHVlOiBpdGVtLnR5cGUsXHJcblx0XHRcdFx0XHRcdFx0XHRjaGFuZ2U6IHR5cGUgPT4ge1xyXG5cdFx0XHRcdFx0XHRcdFx0XHQvLyB1cGRhdGUgdGhlIGl0ZW0gdHlwZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHRpdGVtLnR5cGUgPSB0eXBlO1xyXG5cclxuXHRcdFx0XHRcdFx0XHRcdFx0Ly8gaGlkZS9zaG93IHNwZWNpZmljIGZpZWxkc1xyXG5cdFx0XHRcdFx0XHRcdFx0XHR0b2dnbGVGaWVsZHMoKTtcclxuXHJcblx0XHRcdFx0XHRcdFx0XHRcdC8vIGVtaXQgdGhlIGNoYW5nZVxyXG5cdFx0XHRcdFx0XHRcdFx0XHRjaGFuZ2UoKTtcclxuXHRcdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdF1cclxuXHRcdFx0XHRcdH0sXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdG5hbWU6IFwiY2xhc3NGaWVsZFwiLFxyXG5cdFx0XHRcdFx0XHRjbGFzc2VzOiBcImVkaXRvci1yb3dcIixcclxuXHRcdFx0XHRcdFx0Y2hpbGRyZW46IFtcclxuXHRcdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0XHR3aWRnZXQ6IFwiaW5wdXRcIixcclxuXHRcdFx0XHRcdFx0XHRcdGJpbmQ6IGl0ZW0sXHJcblx0XHRcdFx0XHRcdFx0XHRwcm9wOiBcImNsYXNzXCIsXHJcblx0XHRcdFx0XHRcdFx0XHRjaGFuZ2VcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdF1cclxuXHRcdFx0XHRcdH0sXHJcblx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdG5hbWU6IFwiZGF0ZUZpZWxkXCIsXHJcblx0XHRcdFx0XHRcdGNsYXNzZXM6IFwiZWRpdG9yLXJvd1wiLFxyXG5cdFx0XHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRcdHdpZGdldDogXCJpbnB1dFwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0dHlwZTogXCJkYXRlXCIsXHJcblx0XHRcdFx0XHRcdFx0XHR2YWx1ZTogaXRlbS5kYXRlICYmIGAke2l0ZW0uZGF0ZS5nZXRGdWxsWWVhcigpfS0ke3BhZChpdGVtLmRhdGUuZ2V0TW9udGgoKSArIDEpfS0ke3BhZChpdGVtLmRhdGUuZ2V0RGF0ZSgpKX1gLFxyXG5cdFx0XHRcdFx0XHRcdFx0Y2hhbmdlXHJcblx0XHRcdFx0XHRcdFx0fSxcclxuXHRcdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0XHR3aWRnZXQ6IFwiaW5wdXRcIixcclxuXHRcdFx0XHRcdFx0XHRcdHR5cGU6IFwidGltZVwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0dmFsdWU6IGl0ZW0uZGF0ZSAmJiBgJHtpdGVtLmRhdGUuZ2V0SG91cnMoKX06JHtwYWQoaXRlbS5kYXRlLmdldE1pbnV0ZXMoKSl9YCxcclxuXHRcdFx0XHRcdFx0XHRcdGNoYW5nZVxyXG5cdFx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdFx0XVxyXG5cdFx0XHRcdFx0fSxcclxuXHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0Y2xhc3NlczogXCJ0ZXh0YXJlYS13cmFwcGVyXCIsXHJcblx0XHRcdFx0XHRcdGNoaWxkcmVuOiBbXHJcblx0XHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdFx0d2lkZ2V0OiBcImlucHV0XCIsXHJcblx0XHRcdFx0XHRcdFx0XHR0YWc6IFwidGV4dGFyZWFcIixcclxuXHRcdFx0XHRcdFx0XHRcdGNsYXNzZXM6IFwidGV4dGFyZWEtZmlsbFwiLFxyXG5cdFx0XHRcdFx0XHRcdFx0cGxhY2Vob2xkZXI6IFwiRGVzY3JpcHRpb25cIixcclxuXHRcdFx0XHRcdFx0XHRcdGJpbmQ6IGl0ZW0sXHJcblx0XHRcdFx0XHRcdFx0XHRwcm9wOiBcImRlc2NyaXB0aW9uXCIsXHJcblx0XHRcdFx0XHRcdFx0XHRjaGFuZ2VcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdF1cclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRdXHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0Ly8gc2hvdyB0aGUgZmllbGRzIGZvciB0aGlzIGl0ZW0gdHlwZVxyXG5cdFx0XHR0b2dnbGVGaWVsZHMoKTtcclxuXHRcdH0pO1xyXG5cclxuXHRcdC8vIHJlbW92ZSB0aGUgc3Vic2NyaXB0aW9uIHdoZW4gdGhpcyB2aWV3IGlzIGRlc3Ryb3llZFxyXG5cdFx0ZGlzcG9zYWJsZS5hZGQoY2hhbmdlU3ViKTtcclxuXHR9XHJcbn0pO1xyXG5cclxuLy8gYWRkIGEgbGVhZGluZyAwIGlmIGEgbnVtYmVyIGlzIGxlc3MgdGhhbiAxMFxyXG52YXIgcGFkID0gbnVtYmVyID0+IChudW1iZXIgPCAxMCkgPyBcIjBcIiArIG51bWJlciA6IG51bWJlcjtcclxuXHJcbi8vIGNyZWF0ZSBhIGRhdGUgb2YgdG9kYXkgYXQgMTE6NTlwbVxyXG52YXIgZ2VuRGF0ZSA9ICgpID0+IHtcclxuXHR2YXIgZGF0ZSA9IG5ldyBEYXRlKCk7XHJcblxyXG5cdC8vIHNldCB0aGUgdGltZVxyXG5cdGRhdGUuc2V0SG91cnMoMjMpO1xyXG5cdGRhdGUuc2V0TWludXRlcyg1OSk7XHJcblxyXG5cdHJldHVybiBkYXRlO1xyXG59O1xyXG4iLCIvKipcclxuICogVGhlIHZpZXcgZm9yIGFuIGFzc2lnbm1lbnRcclxuICovXHJcblxyXG5pbXBvcnQge2RheXNGcm9tTm93LCBzdHJpbmdpZnlEYXRlfSBmcm9tIFwiLi4vdXRpbC9kYXRlXCI7XHJcbmltcG9ydCB7c3RvcmV9IGZyb20gXCIuLi9kYXRhLXN0b3JlXCI7XHJcblxyXG52YXIgYXNzaWdubWVudHMgPSBzdG9yZShcImFzc2lnbm1lbnRzXCIpO1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyOiAvXlxcL2l0ZW1cXC8oLis/KSQvLFxyXG5cclxuXHRtYWtlKHttYXRjaCwgc2V0VGl0bGUsIGNvbnRlbnQsIGRpc3Bvc2FibGV9KSB7XHJcblx0XHR2YXIgYWN0aW9uRG9uZVN1YiwgYWN0aW9uRWRpdFN1YjtcclxuXHJcblx0IFx0ZGlzcG9zYWJsZS5hZGQoXHJcblx0XHRcdGFzc2lnbm1lbnRzLmdldChtYXRjaFsxXSwgZnVuY3Rpb24oaXRlbSkge1xyXG5cdFx0XHRcdC8vIGNsZWFyIHRoZSBjb250ZW50XHJcblx0XHRcdFx0Y29udGVudC5pbm5lckhUTUwgPSBcIlwiO1xyXG5cclxuXHRcdFx0XHQvLyByZW1vdmUgdGhlIG9sZCBhY3Rpb25cclxuXHRcdFx0XHRpZihhY3Rpb25Eb25lU3ViKSB7XHJcblx0XHRcdFx0XHRhY3Rpb25Eb25lU3ViLnVuc3Vic2NyaWJlKCk7XHJcblx0XHRcdFx0XHRhY3Rpb25FZGl0U3ViLnVuc3Vic2NyaWJlKCk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHQvLyBubyBzdWNoIGFzc2lnbm1lbnRcclxuXHRcdFx0XHRpZighaXRlbSkge1xyXG5cdFx0XHRcdFx0c2V0VGl0bGUoXCJOb3QgZm91bmRcIik7XHJcblxyXG5cdFx0XHRcdFx0bGlmZUxpbmUubWFrZURvbSh7XHJcblx0XHRcdFx0XHRcdHBhcmVudDogY29udGVudCxcclxuXHRcdFx0XHRcdFx0Y2xhc3NlczogXCJjb250ZW50LXBhZGRlZFwiLFxyXG5cdFx0XHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRcdHRhZzogXCJzcGFuXCIsXHJcblx0XHRcdFx0XHRcdFx0XHR0ZXh0OiBcIlRoZSBhc3NpZ25tZW50IHlvdSB3aGVyZSBsb29raW5nIGZvciBjb3VsZCBub3QgYmUgZm91bmQuIFwiXHJcblx0XHRcdFx0XHRcdFx0fSxcclxuXHRcdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0XHR3aWRnZXQ6IFwibGlua1wiLFxyXG5cdFx0XHRcdFx0XHRcdFx0aHJlZjogXCIvXCIsXHJcblx0XHRcdFx0XHRcdFx0XHR0ZXh0OiBcIkdvIGhvbWUuXCJcclxuXHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdF1cclxuXHRcdFx0XHRcdH0pO1xyXG5cclxuXHRcdFx0XHRcdHJldHVybjtcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdC8vIHNldCB0aGUgdGl0bGUgZm9yIHRoZSBjb250ZW50XHJcblx0XHRcdFx0c2V0VGl0bGUoXCJBc3NpZ25tZW50XCIpO1xyXG5cclxuXHRcdFx0XHQvLyBtYXJrIHRoZSBpdGVtIGFzIGRvbmVcclxuXHRcdFx0XHRhY3Rpb25Eb25lU3ViID0gbGlmZUxpbmUuYWRkQWN0aW9uKGl0ZW0uZG9uZSA/IFwiRG9uZVwiIDogXCJOb3QgZG9uZVwiLCAoKSA9PiB7XHJcblx0XHRcdFx0XHQvLyBtYXJrIHRoZSBpdGVtIGRvbmVcclxuXHRcdFx0XHRcdGl0ZW0uZG9uZSA9ICFpdGVtLmRvbmU7XHJcblxyXG5cdFx0XHRcdFx0Ly8gdXBkYXRlIHRoZSBtb2RpZmllZCB0aW1lXHJcblx0XHRcdFx0XHRpdGVtLm1vZGlmaWVkID0gRGF0ZS5ub3coKTtcclxuXHJcblx0XHRcdFx0XHQvLyBzYXZlIHRoZSBjaGFuZ2VcclxuXHRcdFx0XHRcdGFzc2lnbm1lbnRzLnNldChpdGVtLCBbXSwgeyBzYXZlTm93OiB0cnVlIH0pO1xyXG5cdFx0XHRcdH0pO1xyXG5cclxuXHRcdFx0XHQvLyBlZGl0IHRoZSBpdGVtXHJcblx0XHRcdFx0YWN0aW9uRWRpdFN1YiA9IGxpZmVMaW5lLmFkZEFjdGlvbihcIkVkaXRcIixcclxuXHRcdFx0XHRcdCgpID0+IGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZShcIi9lZGl0L1wiICsgaXRlbS5pZCkpO1xyXG5cclxuXHRcdFx0XHQvLyB0aW1lcyB0byBza2lwXHJcblx0XHRcdFx0dmFyIHNraXBUaW1lcyA9IFtcclxuXHRcdFx0XHRcdHsgaG91cjogMjMsIG1pbnV0ZTogNTkgfVxyXG5cdFx0XHRcdF07XHJcblxyXG5cdFx0XHRcdGxpZmVMaW5lLm1ha2VEb20oe1xyXG5cdFx0XHRcdFx0cGFyZW50OiBjb250ZW50LFxyXG5cdFx0XHRcdFx0Y2xhc3NlczogXCJjb250ZW50LXBhZGRlZFwiLFxyXG5cdFx0XHRcdFx0Y2hpbGRyZW46IFtcclxuXHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdGNsYXNzZXM6IFwiYXNzaWdubWVudC1uYW1lXCIsXHJcblx0XHRcdFx0XHRcdFx0dGV4dDogaXRlbS5uYW1lXHJcblx0XHRcdFx0XHRcdH0sXHJcblx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRjbGFzc2VzOiBcImFzc2lnbm1lbnQtaW5mby1yb3dcIixcclxuXHRcdFx0XHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdFx0XHRjbGFzc2VzOiBcImFzc2lnbm1lbnQtaW5mby1ncm93XCIsXHJcblx0XHRcdFx0XHRcdFx0XHRcdHRleHQ6IGl0ZW0uY2xhc3NcclxuXHRcdFx0XHRcdFx0XHRcdH0sXHJcblx0XHRcdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0XHRcdHRleHQ6IGl0ZW0uZGF0ZSAmJiBzdHJpbmdpZnlEYXRlKGl0ZW0uZGF0ZSwgeyBpbmNsdWRlVGltZTogdHJ1ZSwgc2tpcFRpbWVzIH0pXHJcblx0XHRcdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRcdFx0XVxyXG5cdFx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0XHR7XHJcblx0XHRcdFx0XHRcdFx0Y2xhc3NlczogXCJhc3NpZ25tZW50LWRlc2NyaXB0aW9uXCIsXHJcblx0XHRcdFx0XHRcdFx0dGV4dDogaXRlbS5kZXNjcmlwdGlvblxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRdXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH0pXHJcblx0XHQpO1xyXG5cdH1cclxufSk7XHJcbiIsIi8qKlxyXG4gKiBEaXNwbGF5IGEgbGlzdCBvZiB1cGNvbW1pbmcgYXNzaWdubWVudHNcclxuICovXHJcblxyXG5pbXBvcnQge2RheXNGcm9tTm93LCBpc1NhbWVEYXRlLCBzdHJpbmdpZnlEYXRlLCBzdHJpbmdpZnlUaW1lLCBpc1Nvb25lckRhdGV9IGZyb20gXCIuLi91dGlsL2RhdGVcIjtcclxuaW1wb3J0IHtzdG9yZX0gZnJvbSBcIi4uL2RhdGEtc3RvcmVcIjtcclxuXHJcbnZhciBhc3NpZ25tZW50cyA9IHN0b3JlKFwiYXNzaWdubWVudHNcIik7XHJcblxyXG4vLyBhbGwgdGhlIGRpZmZlcmVudCBsaXN0c1xyXG5jb25zdCBMSVNUUyA9IFtcclxuXHR7XHJcblx0XHR1cmw6IFwiL3dlZWtcIixcclxuXHRcdHRpdGxlOiBcIlRoaXMgd2Vla1wiLFxyXG5cdFx0Y3JlYXRlQ3R4OiAoKSA9PiAoe1xyXG5cdFx0XHQvLyBkYXlzIHRvIHRoZSBlbmQgb2YgdGhpcyB3ZWVrXHJcblx0XHRcdGVuZERhdGU6IGRheXNGcm9tTm93KDcgLSAobmV3IERhdGUoKSkuZ2V0RGF5KCkpLFxyXG5cdFx0XHQvLyB0b2RheXMgZGF0ZVxyXG5cdFx0XHR0b2RheTogbmV3IERhdGUoKVxyXG5cdFx0fSksXHJcblx0XHQvLyBzaG93IGFsbCBhdCByZWFzb25hYmxlIG51bWJlciBvZiBpbmNvbXBsZXRlIGFzc2lnbm1lbnRzXHJcblx0XHRmaWx0ZXI6IChpdGVtLCB7dG9kYXksIGVuZERhdGV9KSA9PiB7XHJcblx0XHRcdC8vIGFscmVhZHkgZG9uZVxyXG5cdFx0XHRpZihpdGVtLmRvbmUpIHJldHVybjtcclxuXHJcblx0XHRcdC8vIHNob3cgYWxsIHRhc2tzXHJcblx0XHRcdGlmKGl0ZW0udHlwZSA9PSBcInRhc2tcIikgcmV0dXJuIHRydWU7XHJcblxyXG5cdFx0XHQvLyBjaGVjayBpZiB0aGUgaXRlbSBpcyBwYXN0IHRoaXMgd2Vla1xyXG5cdFx0XHRpZighaXNTb29uZXJEYXRlKGl0ZW0uZGF0ZSwgZW5kRGF0ZSkgJiYgIWlzU2FtZURhdGUoaXRlbS5kYXRlLCBlbmREYXRlKSkgcmV0dXJuO1xyXG5cclxuXHRcdFx0Ly8gY2hlY2sgaWYgdGhlIGRhdGUgaXMgYmVmb3JlIHRvZGF5XHJcblx0XHRcdGlmKGlzU29vbmVyRGF0ZShpdGVtLmRhdGUsIHRvZGF5KSkgcmV0dXJuO1xyXG5cclxuXHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHR9XHJcblx0fSxcclxuXHR7XHJcblx0XHR1cmw6IFwiL3VwY29taW5nXCIsXHJcblx0XHRmaWx0ZXI6IGl0ZW0gPT4gIWl0ZW0uZG9uZSxcclxuXHRcdHRpdGxlOiBcIlVwY29taW5nXCJcclxuXHR9LFxyXG5cdHtcclxuXHRcdHVybDogXCIvZG9uZVwiLFxyXG5cdFx0ZmlsdGVyOiBpdGVtID0+IGl0ZW0uZG9uZSxcclxuXHRcdHRpdGxlOiBcIkRvbmVcIlxyXG5cdH1cclxuXTtcclxuXHJcbi8vIGFkZCBsaXN0IHZpZXcgbGlua3MgdG8gdGhlIG5hdmJhclxyXG5leHBvcnQgZnVuY3Rpb24gaW5pdE5hdkJhcigpIHtcclxuXHRMSVNUUy5mb3JFYWNoKGxpc3QgPT4gbGlmZUxpbmUuYWRkTmF2Q29tbWFuZChsaXN0LnRpdGxlLCBsaXN0LnVybCkpO1xyXG59O1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyKHVybCkge1xyXG5cdFx0cmV0dXJuIExJU1RTLmZpbmQobGlzdCA9PiBsaXN0LnVybCA9PSB1cmwpO1xyXG5cdH0sXHJcblxyXG5cdC8vIG1ha2UgdGhlIGxpc3RcclxuXHRtYWtlKHtzZXRUaXRsZSwgY29udGVudCwgZGlzcG9zYWJsZSwgbWF0Y2h9KSB7XHJcblx0XHRkaXNwb3NhYmxlLmFkZChcclxuXHRcdFx0YXNzaWdubWVudHMuZ2V0QWxsKGZ1bmN0aW9uKGRhdGEpIHtcclxuXHRcdFx0XHQvLyBjbGVhciB0aGUgY29udGVudFxyXG5cdFx0XHRcdGNvbnRlbnQuaW5uZXJIVE1MID0gXCJcIjtcclxuXHJcblx0XHRcdFx0Ly8gc2V0IHRoZSBwYWdlIHRpdGxlXHJcblx0XHRcdFx0c2V0VGl0bGUobWF0Y2gudGl0bGUpO1xyXG5cclxuXHRcdFx0XHQvLyB0aGUgY29udGV4dCBmb3IgdGhlIGZpbHRlciBmdW5jdGlvblxyXG5cdFx0XHRcdHZhciBjdHg7XHJcblxyXG5cdFx0XHRcdGlmKG1hdGNoLmNyZWF0ZUN0eCkge1xyXG5cdFx0XHRcdFx0Y3R4ID0gbWF0Y2guY3JlYXRlQ3R4KCk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHQvLyBydW4gdGhlIGZpbHRlciBmdW5jdGlvblxyXG5cdFx0XHRcdGRhdGEgPSBkYXRhLmZpbHRlcihpdGVtID0+IG1hdGNoLmZpbHRlcihpdGVtLCBjdHgpKTtcclxuXHJcblx0XHRcdFx0Ly8gc29ydCB0aGUgYXNzaW5nbWVudHNcclxuXHRcdFx0XHRkYXRhLnNvcnQoKGEsIGIpID0+IHtcclxuXHRcdFx0XHRcdC8vIHRhc2tzIGFyZSBiZWxvdyBhc3NpZ25tZW50c1xyXG5cdFx0XHRcdFx0aWYoYS50eXBlID09IFwidGFza1wiICYmIGIudHlwZSAhPSBcInRhc2tcIikgcmV0dXJuIDE7XHJcblx0XHRcdFx0XHRpZihhLnR5cGUgIT0gXCJ0YXNrXCIgJiYgYi50eXBlID09IFwidGFza1wiKSByZXR1cm4gLTE7XHJcblx0XHRcdFx0XHQvL2lmKGEudHlwZSA9PSBcInRhc2tcIiB8fCBiLnR5cGUgPT0gXCJ0YXNrXCIpIHJldHVybiAwO1xyXG5cclxuXHRcdFx0XHRcdC8vIHNvcnQgYnkgZHVlIGRhdGVcclxuXHRcdFx0XHRcdGlmKGEudHlwZSA9PSBcImFzc2lnbm1lbnRcIiAmJiBiLnR5cGUgPT0gXCJhc3NpZ25tZW50XCIpIHtcclxuXHRcdFx0XHRcdFx0aWYoYS5kYXRlLmdldFRpbWUoKSAhPSBiLmRhdGUuZ2V0VGltZSgpKSB7XHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuIGEuZGF0ZS5nZXRUaW1lKCkgLSBiLmRhdGUuZ2V0VGltZSgpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0Ly8gb3JkZXIgYnkgbmFtZVxyXG5cdFx0XHRcdFx0aWYoYS5uYW1lIDwgYi5uYW1lKSByZXR1cm4gLTE7XHJcblx0XHRcdFx0XHRpZihhLm5hbWUgPiBiLm5hbWUpIHJldHVybiAxO1xyXG5cclxuXHRcdFx0XHRcdHJldHVybiAwO1xyXG5cdFx0XHRcdH0pO1xyXG5cclxuXHRcdFx0XHQvLyBtYWtlIHRoZSBncm91cHNcclxuXHRcdFx0XHR2YXIgZ3JvdXBzID0ge307XHJcblxyXG5cdFx0XHRcdC8vIHJlbmRlciB0aGUgbGlzdFxyXG5cdFx0XHRcdGRhdGEuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xyXG5cdFx0XHRcdFx0Ly8gZ2V0IHRoZSBoZWFkZXIgbmFtZVxyXG5cdFx0XHRcdFx0dmFyIGRhdGVTdHIgPSBpdGVtLnR5cGUgPT0gXCJ0YXNrXCIgPyBcIlRhc2tzXCIgOiBzdHJpbmdpZnlEYXRlKGl0ZW0uZGF0ZSk7XHJcblxyXG5cdFx0XHRcdFx0Ly8gbWFrZSBzdXJlIHRoZSBoZWFkZXIgZXhpc3RzXHJcblx0XHRcdFx0XHRncm91cHNbZGF0ZVN0cl0gfHwgKGdyb3Vwc1tkYXRlU3RyXSA9IFtdKTtcclxuXHJcblx0XHRcdFx0XHQvLyBhZGQgdGhlIGl0ZW0gdG8gdGhlIGxpc3RcclxuXHRcdFx0XHRcdHZhciBpdGVtcyA9IFtcclxuXHRcdFx0XHRcdFx0eyB0ZXh0OiBpdGVtLm5hbWUsIGdyb3c6IHRydWUgfVxyXG5cdFx0XHRcdFx0XTtcclxuXHJcblx0XHRcdFx0XHRpZihpdGVtLnR5cGUgIT0gXCJ0YXNrXCIpIHtcclxuXHRcdFx0XHRcdFx0Ly8gc2hvdyB0aGUgZW5kIHRpbWUgZm9yIGFueSBub24gMTE6NTlwbSB0aW1lc1xyXG5cdFx0XHRcdFx0XHRpZihpdGVtLmRhdGUuZ2V0SG91cnMoKSAhPSAyMyB8fCBpdGVtLmRhdGUuZ2V0TWludXRlcygpICE9IDU5KSB7XHJcblx0XHRcdFx0XHRcdFx0aXRlbXMucHVzaChzdHJpbmdpZnlUaW1lKGl0ZW0uZGF0ZSkpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0XHQvLyBzaG93IHRoZSBjbGFzc1xyXG5cdFx0XHRcdFx0XHRpdGVtcy5wdXNoKGl0ZW0uY2xhc3MpO1xyXG5cdFx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHRcdGdyb3Vwc1tkYXRlU3RyXS5wdXNoKHtcblx0XHRcdFx0XHRcdGhyZWY6IGAvaXRlbS8ke2l0ZW0uaWR9YCxcblx0XHRcdFx0XHRcdGl0ZW1zXHJcblx0XHRcdFx0XHR9KTtcclxuXHRcdFx0XHR9KTtcclxuXHJcblx0XHRcdFx0Ly8gZGlzcGxheSBhbGwgaXRlbXNcclxuXHRcdFx0XHRsaWZlTGluZS5tYWtlRG9tKHtcclxuXHRcdFx0XHRcdHBhcmVudDogY29udGVudCxcclxuXHRcdFx0XHRcdHdpZGdldDogXCJsaXN0XCIsXHJcblx0XHRcdFx0XHRpdGVtczogZ3JvdXBzXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH0pXHJcblx0XHQpO1xyXG5cdH1cclxufSk7XHJcbiIsIi8qKlxyXG4gKiBTaG93IGEgbG9naW4gYnV0dG9uIHRvIHRoZSB1c2VyXHJcbiAqL1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyOiBcIi9sb2dpblwiLFxyXG5cclxuXHRtYWtlKHtzZXRUaXRsZSwgY29udGVudH0pIHtcclxuXHRcdC8vIHNldCB0aGUgcGFnZSB0aXRsZVxyXG5cdFx0c2V0VGl0bGUoXCJMb2dpblwiKTtcclxuXHJcblx0XHQvLyB0aGUgdXNlcnMgY3JlZGVudGlhbHNcclxuXHRcdHZhciBhdXRoID0ge307XHJcblxyXG5cdFx0Ly8gY3JlYXRlIHRoZSBsb2dpbiBmb3JtXHJcblx0XHR2YXIge3VzZXJuYW1lLCBwYXNzd29yZCwgbXNnfSA9IGxpZmVMaW5lLm1ha2VEb20oe1xyXG5cdFx0XHRwYXJlbnQ6IGNvbnRlbnQsXHJcblx0XHRcdHRhZzogXCJmb3JtXCIsXHJcblx0XHRcdGNsYXNzZXM6IFwiY29udGVudC1wYWRkZWRcIixcclxuXHRcdFx0Y2hpbGRyZW46IFtcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRjbGFzc2VzOiBcImVkaXRvci1yb3dcIixcclxuXHRcdFx0XHRcdGNoaWxkcmVuOiBbXHJcblx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHR3aWRnZXQ6IFwiaW5wdXRcIixcclxuXHRcdFx0XHRcdFx0XHRiaW5kOiBhdXRoLFxyXG5cdFx0XHRcdFx0XHRcdHByb3A6IFwidXNlcm5hbWVcIixcclxuXHRcdFx0XHRcdFx0XHRwbGFjZWhvbGRlcjogXCJVc2VybmFtZVwiXHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdF1cclxuXHRcdFx0XHR9LFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdGNsYXNzZXM6IFwiZWRpdG9yLXJvd1wiLFxyXG5cdFx0XHRcdFx0Y2hpbGRyZW46IFtcclxuXHRcdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRcdHdpZGdldDogXCJpbnB1dFwiLFxyXG5cdFx0XHRcdFx0XHRcdGJpbmQ6IGF1dGgsXHJcblx0XHRcdFx0XHRcdFx0cHJvcDogXCJwYXNzd29yZFwiLFxyXG5cdFx0XHRcdFx0XHRcdHR5cGU6IFwicGFzc3dvcmRcIixcclxuXHRcdFx0XHRcdFx0XHRwbGFjZWhvbGRlcjogXCJQYXNzd29yZFwiXHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdF1cclxuXHRcdFx0XHR9LFxyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHRhZzogXCJidXR0b25cIixcclxuXHRcdFx0XHRcdHRleHQ6IFwiTG9naW5cIixcclxuXHRcdFx0XHRcdGNsYXNzZXM6IFwiZmFuY3ktYnV0dG9uXCIsXHJcblx0XHRcdFx0XHRhdHRyczoge1xyXG5cdFx0XHRcdFx0XHR0eXBlOiBcInN1Ym1pdFwiXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHRjbGFzc2VzOiBcImVycm9yLW1zZ1wiLFxyXG5cdFx0XHRcdFx0bmFtZTogXCJtc2dcIlxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XSxcclxuXHRcdFx0b246IHtcclxuXHRcdFx0XHRzdWJtaXQ6IGUgPT4ge1xyXG5cdFx0XHRcdFx0ZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG5cclxuXHRcdFx0XHRcdC8vIHNlbmQgdGhlIGxvZ2luIHJlcXVlc3RcclxuXHRcdFx0XHRcdGZldGNoKFwiL2FwaS9hdXRoL2xvZ2luXCIsIHtcclxuXHRcdFx0XHRcdFx0bWV0aG9kOiBcIlBPU1RcIixcclxuXHRcdFx0XHRcdFx0Y3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxyXG5cdFx0XHRcdFx0XHRib2R5OiBKU09OLnN0cmluZ2lmeShhdXRoKVxyXG5cdFx0XHRcdFx0fSlcclxuXHJcblx0XHRcdFx0XHQvLyBwYXJzZSB0aGUganNvblxyXG5cdFx0XHRcdFx0LnRoZW4ocmVzID0+IHJlcy5qc29uKCkpXHJcblxyXG5cdFx0XHRcdFx0Ly8gcHJvY2VzcyB0aGUgcmVzcG9uc2VcclxuXHRcdFx0XHRcdC50aGVuKHJlcyA9PiB7XHJcblx0XHRcdFx0XHRcdC8vIGxvZ2luIHN1Y2VlZGVkIGdvIGhvbWVcclxuXHRcdFx0XHRcdFx0aWYocmVzLnN0YXR1cyA9PSBcInN1Y2Nlc3NcIikge1xyXG5cdFx0XHRcdFx0XHRcdGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZShcIi9cIik7XHJcblx0XHRcdFx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0XHQvLyBsb2dpbiBmYWlsZWRcclxuXHRcdFx0XHRcdFx0aWYocmVzLnN0YXR1cyA9PSBcImZhaWxcIikge1xyXG5cdFx0XHRcdFx0XHRcdGVycm9yTXNnKFwiTG9naW4gZmFpbGVkXCIpO1xyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9KTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH0pO1xyXG5cclxuXHRcdC8vIGRpc3BsYXkgYW4gZXJyb3IgbWVzc2FnZVxyXG5cdFx0dmFyIGVycm9yTXNnID0gZnVuY3Rpb24odGV4dCkge1xyXG5cdFx0XHRtc2cuaW5uZXJUZXh0ID0gdGV4dDtcclxuXHRcdH07XHJcblx0fVxyXG59KTtcclxuXHJcbi8vIGxvZ291dFxyXG5saWZlTGluZS5sb2dvdXQgPSBmdW5jdGlvbigpIHtcclxuXHQvLyBzZW5kIHRoZSBsb2dvdXQgcmVxdWVzdFxyXG5cdGZldGNoKFwiL2FwaS9hdXRoL2xvZ291dFwiLCB7XHJcblx0XHRjcmVkZW50aWFsczogXCJpbmNsdWRlXCJcclxuXHR9KVxyXG5cclxuXHQvLyBnbyB0byB0aGUgbG9naW4gcGFnZVxyXG5cdC50aGVuKCgpID0+IGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZShcIi9sb2dpblwiKSk7XHJcbn07XHJcbiIsIi8qKlxyXG4gKiBBIGxpc3Qgb2YgdGhpbmdzIHRvZG9cclxuICovXHJcblxyXG5pbXBvcnQge2RheXNGcm9tTm93LCBpc1NhbWVEYXRlLCBzdHJpbmdpZnlUaW1lfSBmcm9tIFwiLi4vdXRpbC9kYXRlXCI7XHJcbmltcG9ydCB7c3RvcmV9IGZyb20gXCIuLi9kYXRhLXN0b3JlXCI7XHJcblxyXG52YXIgYXNzaWdubWVudHMgPSBzdG9yZShcImFzc2lnbm1lbnRzXCIpO1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyOiBcIi9cIixcclxuXHJcblx0bWFrZSh7c2V0VGl0bGUsIGNvbnRlbnQsIGRpc3Bvc2FibGV9KSB7XHJcblx0XHRzZXRUaXRsZShcIlRvZG9cIik7XHJcblxyXG5cdFx0Ly8gbG9hZCB0aGUgaXRlbXNcclxuXHRcdGRpc3Bvc2FibGUuYWRkKFxyXG5cdFx0XHRhc3NpZ25tZW50cy5nZXRBbGwoZnVuY3Rpb24oZGF0YSkge1xyXG5cdFx0XHRcdC8vIGNsZWFyIHRoZSBvbGQgY29udGVudFxyXG5cdFx0XHRcdGNvbnRlbnQuaW5uZXJIVE1MID0gXCJcIjtcclxuXHJcblx0XHRcdFx0dmFyIGdyb3VwcyA9IHtcclxuXHRcdFx0XHRcdFRhc2tzOiBbXSxcclxuXHRcdFx0XHRcdFRvZGF5OiBbXSxcclxuXHRcdFx0XHRcdFRvbW9ycm93OiBbXVxyXG5cdFx0XHRcdH07XHJcblxyXG5cdFx0XHRcdC8vIHRvZGF5IGFuZCB0b21vcnJvd3MgZGF0ZXNcclxuXHRcdFx0XHR2YXIgdG9kYXkgPSBuZXcgRGF0ZSgpO1xyXG5cdFx0XHRcdHZhciB0b21vcnJvdyA9IGRheXNGcm9tTm93KDEpO1xyXG5cclxuXHRcdFx0XHQvLyBzZWxlY3QgdGhlIGl0ZW1zIHRvIGRpc3BsYXlcclxuXHRcdFx0XHRkYXRhLmZvckVhY2goaXRlbSA9PiB7XHJcblx0XHRcdFx0XHQvLyBza2lwIGNvbXBsZXRlZCBpdGVtc1xyXG5cdFx0XHRcdFx0aWYoaXRlbS5kb25lKSByZXR1cm47XHJcblxyXG5cdFx0XHRcdFx0Ly8gYXNzaWdubWVudHMgZm9yIHRvZGF5XHJcblx0XHRcdFx0XHRpZihpdGVtLnR5cGUgPT0gXCJhc3NpZ25tZW50XCIpIHtcclxuXHRcdFx0XHRcdFx0Ly8gdG9kYXlcclxuXHRcdFx0XHRcdFx0aWYoaXNTYW1lRGF0ZSh0b2RheSwgaXRlbS5kYXRlKSkge1xyXG5cdFx0XHRcdFx0XHRcdGdyb3Vwcy5Ub2RheS5wdXNoKGNyZWF0ZVVpKGl0ZW0pKTtcclxuXHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHQvLyB0b21vcnJvd1xyXG5cdFx0XHRcdFx0XHRlbHNlIGlmKGlzU2FtZURhdGUodG9tb3Jyb3csIGl0ZW0uZGF0ZSkpIHtcclxuXHRcdFx0XHRcdFx0XHRncm91cHMuVG9tb3Jyb3cucHVzaChjcmVhdGVVaShpdGVtKSk7XHJcblx0XHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0XHQvLyBzaG93IGFueSB0YXNrc1xyXG5cdFx0XHRcdFx0aWYoaXRlbS50eXBlID09IFwidGFza1wiKSB7XHJcblx0XHRcdFx0XHRcdGdyb3Vwcy5UYXNrcy5wdXNoKGNyZWF0ZVVpKGl0ZW0pKTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9KTtcclxuXHJcblx0XHRcdFx0Ly8gcmVtb3ZlIGFueSBlbXB0eSBmaWVsZHNcclxuXHRcdFx0XHRPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhncm91cHMpXHJcblxyXG5cdFx0XHRcdC5mb3JFYWNoKG5hbWUgPT4ge1xyXG5cdFx0XHRcdFx0Ly8gcmVtb3ZlIGVtcHR5IGdyb3Vwc1xyXG5cdFx0XHRcdFx0aWYoZ3JvdXBzW25hbWVdLmxlbmd0aCA9PT0gMCkge1xyXG5cdFx0XHRcdFx0XHRkZWxldGUgZ3JvdXBzW25hbWVdO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH0pO1xyXG5cclxuXHRcdFx0XHQvLyByZW5kZXIgdGhlIGxpc3RcclxuXHRcdFx0XHRsaWZlTGluZS5tYWtlRG9tKHtcclxuXHRcdFx0XHRcdHBhcmVudDogY29udGVudCxcclxuXHRcdFx0XHRcdHdpZGdldDogXCJsaXN0XCIsXHJcblx0XHRcdFx0XHRpdGVtczogZ3JvdXBzXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH0pXHJcblx0XHQpO1xyXG5cdH1cclxufSk7XHJcblxyXG4vLyBjcmVhdGUgYSBsaXN0IGl0ZW1cclxudmFyIGNyZWF0ZVVpID0gZnVuY3Rpb24oaXRlbSkge1xyXG5cdC8vIHJlbmRlciBhIHRhc2tcclxuXHRpZihpdGVtLnR5cGUgPT0gXCJ0YXNrXCIpIHtcclxuXHRcdHJldHVybiB7XHJcblx0XHRcdGhyZWY6IGAvaXRlbS8ke2l0ZW0uaWR9YCxcclxuXHRcdFx0aXRlbXM6IFtcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR0ZXh0OiBpdGVtLm5hbWUsXHJcblx0XHRcdFx0XHRncm93OiB0cnVlXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRdXHJcblx0XHR9O1xyXG5cdH1cclxuXHQvLyByZW5kZXIgYW4gaXRlbVxyXG5cdGVsc2Uge1xyXG5cdFx0cmV0dXJuIHtcclxuXHRcdFx0aHJlZjogYC9pdGVtLyR7aXRlbS5pZH1gLFxyXG5cdFx0XHRpdGVtczogW1xyXG5cdFx0XHRcdHtcclxuXHRcdFx0XHRcdHRleHQ6IGl0ZW0ubmFtZSxcclxuXHRcdFx0XHRcdGdyb3c6IHRydWVcclxuXHRcdFx0XHR9LFxyXG5cdFx0XHRcdHN0cmluZ2lmeVRpbWUoaXRlbS5kYXRlKSxcclxuXHRcdFx0XHRpdGVtLmNsYXNzXHJcblx0XHRcdF1cclxuXHRcdH07XHJcblx0fVxyXG59O1xyXG4iLCIvKipcclxuICogQSBwYWdlIHdpdGggbGlua3MgdG8gYWxsIHVzZXJzXHJcbiAqL1xyXG5cclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyKHtcclxuXHRtYXRjaGVyOiBcIi91c2Vyc1wiLFxyXG5cclxuXHRtYWtlKHtzZXRUaXRsZSwgY29udGVudH0pIHtcclxuXHRcdHNldFRpdGxlKFwiQWxsIHVzZXJzXCIpO1xyXG5cclxuXHRcdC8vIGxvYWQgdGhlIGxpc3Qgb2YgdXNlcnNcclxuXHRcdGZldGNoKFwiL2FwaS9hdXRoL2luZm8vdXNlcnNcIiwge1xyXG5cdFx0XHRjcmVkZW50aWFsczogXCJpbmNsdWRlXCJcclxuXHRcdH0pXHJcblxyXG5cdFx0LnRoZW4ocmVzID0+IHJlcy5qc29uKCkpXHJcblxyXG5cdFx0LnRoZW4oKHtzdGF0dXMsIGRhdGE6IHVzZXJzfSkgPT4ge1xyXG5cdFx0XHQvLyBub3QgYXV0aGVudGljYXRlZFxyXG5cdFx0XHRpZihzdGF0dXMgPT0gXCJmYWlsXCIpIHtcclxuXHRcdFx0XHRsaWZlTGluZS5tYWtlRG9tKHtcclxuXHRcdFx0XHRcdHBhcmVudDogY29udGVudCxcclxuXHRcdFx0XHRcdGNsYXNzZXM6IFwiY29udGVudC1wYWRkZWRcIixcclxuXHRcdFx0XHRcdHRleHQ6IFwiWW91IGRvIG5vdCBoYXZlIGFjY2VzcyB0byB0aGUgdXNlciBsaXN0XCJcclxuXHRcdFx0XHR9KTtcclxuXHJcblx0XHRcdFx0cmV0dXJuO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBzb3J0IGJ5IGFkbWluIHN0YXR1c1xyXG5cdFx0XHR1c2Vycy5zb3J0KChhLCBiKSA9PiB7XHJcblx0XHRcdFx0Ly8gc29ydCBhZG1pbnNcclxuXHRcdFx0XHRpZihhLmFkbWluICYmICFiLmFkbWluKSByZXR1cm4gLTE7XHJcblx0XHRcdFx0aWYoIWEuYWRtaW4gJiYgYi5hZG1pbikgcmV0dXJuIDE7XHJcblxyXG5cdFx0XHRcdC8vIHNvcnQgYnkgdXNlcm5hbWVcclxuXHRcdFx0XHRpZihhLnVzZXJuYW1lIDwgYi51c2VybmFtZSkgcmV0dXJuIC0xO1xyXG5cdFx0XHRcdGlmKGEudXNlcm5hbWUgPiBiLnVzZXJuYW1lKSByZXR1cm4gMTtcclxuXHJcblx0XHRcdFx0cmV0dXJuIDA7XHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0dmFyIGRpc3BsYXlVc2VycyA9IHtcclxuXHRcdFx0XHRBZG1pbnM6IFtdLFxyXG5cdFx0XHRcdFVzZXJzOiBbXVxyXG5cdFx0XHR9O1xyXG5cclxuXHRcdFx0Ly8gZ2VuZXJhdGUgdGhlIHVzZXIgbGlzdFxyXG5cdFx0XHR1c2Vycy5mb3JFYWNoKHVzZXIgPT4ge1xyXG5cdFx0XHRcdC8vIHNvcnQgdGhlIHVzZXJzIGludG8gYWRtaW5zIGFuZCB1c2Vyc1xyXG5cdFx0XHRcdGRpc3BsYXlVc2Vyc1t1c2VyLmFkbWluID8gXCJBZG1pbnNcIiA6IFwiVXNlcnNcIl1cclxuXHJcblx0XHRcdFx0LnB1c2goe1xyXG5cdFx0XHRcdFx0aHJlZjogYC91c2VyLyR7dXNlci51c2VybmFtZX1gLFxyXG5cdFx0XHRcdFx0aXRlbXM6IFt7XHJcblx0XHRcdFx0XHRcdHRleHQ6IHVzZXIudXNlcm5hbWUsXHJcblx0XHRcdFx0XHRcdGdyb3c6IHRydWVcclxuXHRcdFx0XHRcdH1dXHJcblx0XHRcdFx0fSk7XHJcblx0XHRcdH0pO1xyXG5cclxuXHRcdFx0Ly8gZGlzcGxheSB0aGUgdXNlciBsaXN0XHJcblx0XHRcdGxpZmVMaW5lLm1ha2VEb20oe1xyXG5cdFx0XHRcdHBhcmVudDogY29udGVudCxcclxuXHRcdFx0XHR3aWRnZXQ6IFwibGlzdFwiLFxyXG5cdFx0XHRcdGl0ZW1zOiBkaXNwbGF5VXNlcnNcclxuXHRcdFx0fSk7XHJcblx0XHR9KVxyXG5cclxuXHRcdC8vIHNvbWV0aGluZyB3ZW50IHdyb25nIHNob3cgYW4gZXJyb3IgbWVzc2FnZVxyXG5cdFx0LmNhdGNoKGVyciA9PiB7XHJcblx0XHRcdGxpZmVMaW5lLm1ha2VEb20oe1xyXG5cdFx0XHRcdGNsYXNzZXM6IFwiY29udGVudC1wYWRkZWRcIixcclxuXHRcdFx0XHR0ZXh0OiBlcnIubWVzc2FnZVxyXG5cdFx0XHR9KTtcclxuXHRcdH0pO1xyXG5cdH1cclxufSk7XHJcbiIsIi8qKlxyXG4gKiBUaGUgbWFpbiBjb250ZW50IHBhbmUgZm9yIHRoZSBhcHBcclxuICovXHJcblxyXG5saWZlTGluZS5tYWtlRG9tLnJlZ2lzdGVyKFwiY29udGVudFwiLCB7XHJcblx0bWFrZSgpIHtcclxuXHRcdHJldHVybiBbXHJcblx0XHRcdHtcclxuXHRcdFx0XHRjbGFzc2VzOiBcInRvb2xiYXJcIixcclxuXHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHR0YWc6IFwic3ZnXCIsXHJcblx0XHRcdFx0XHRcdGNsYXNzZXM6IFwibWVudS1pY29uXCIsXHJcblx0XHRcdFx0XHRcdGF0dHJzOiB7XHJcblx0XHRcdFx0XHRcdFx0dmlld0JveDogXCIwIDAgNjAgNTBcIixcclxuXHRcdFx0XHRcdFx0XHR3aWR0aDogXCIyMFwiLFxyXG5cdFx0XHRcdFx0XHRcdGhlaWdodDogXCIxNVwiXHJcblx0XHRcdFx0XHRcdH0sXHJcblx0XHRcdFx0XHRcdGNoaWxkcmVuOiBbXHJcblx0XHRcdFx0XHRcdFx0eyB0YWc6IFwibGluZVwiLCBhdHRyczogeyB4MTogXCIwXCIsIHkxOiBcIjVcIiwgeDI6IFwiNjBcIiwgeTI6IFwiNVwiIH0gfSxcclxuXHRcdFx0XHRcdFx0XHR7IHRhZzogXCJsaW5lXCIsIGF0dHJzOiB7IHgxOiBcIjBcIiwgeTE6IFwiMjVcIiwgeDI6IFwiNjBcIiwgeTI6IFwiMjVcIiB9IH0sXHJcblx0XHRcdFx0XHRcdFx0eyB0YWc6IFwibGluZVwiLCBhdHRyczogeyB4MTogXCIwXCIsIHkxOiBcIjQ1XCIsIHgyOiBcIjYwXCIsIHkyOiBcIjQ1XCIgfSB9XHJcblx0XHRcdFx0XHRcdF0sXHJcblx0XHRcdFx0XHRcdG9uOiB7XHJcblx0XHRcdFx0XHRcdFx0Y2xpY2s6ICgpID0+IGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnRvZ2dsZShcInNpZGViYXItb3BlblwiKVxyXG5cdFx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRjbGFzc2VzOiBcInRvb2xiYXItdGl0bGVcIixcclxuXHRcdFx0XHRcdFx0bmFtZTogXCJ0aXRsZVwiXHJcblx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRjbGFzc2VzOiBcInRvb2xiYXItYnV0dG9uc1wiLFxyXG5cdFx0XHRcdFx0XHRuYW1lOiBcImJ0bnNcIlxyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdF1cclxuXHRcdFx0fSxcclxuXHRcdFx0e1xyXG5cdFx0XHRcdGNsYXNzZXM6IFwiY29udGVudFwiLFxyXG5cdFx0XHRcdG5hbWU6IFwiY29udGVudFwiXHJcblx0XHRcdH1cclxuXHRcdF07XHJcblx0fSxcclxuXHJcblx0YmluZChvcHRzLCB7dGl0bGUsIGJ0bnMsIGNvbnRlbnR9KSB7XHJcblx0XHR2YXIgZGlzcG9zYWJsZTtcclxuXHJcblx0XHQvLyBzZXQgdGhlIHBhZ2UgdGl0bGVcclxuXHRcdHZhciBzZXRUaXRsZSA9IGZ1bmN0aW9uKHRpdGxlVGV4dCkge1xyXG5cdFx0XHR0aXRsZS5pbm5lclRleHQgPSB0aXRsZVRleHQ7XHJcblx0XHRcdGRvY3VtZW50LnRpdGxlID0gdGl0bGVUZXh0O1xyXG5cdFx0fTtcclxuXHJcblx0XHQvLyBhZGQgYW4gYWN0aW9uIGJ1dHRvblxyXG5cdFx0bGlmZUxpbmUub24oXCJhY3Rpb24tY3JlYXRlXCIsIG5hbWUgPT4ge1xyXG5cdFx0XHRsaWZlTGluZS5tYWtlRG9tKHtcclxuXHRcdFx0XHRwYXJlbnQ6IGJ0bnMsXHJcblx0XHRcdFx0dGFnOiBcImJ1dHRvblwiLFxyXG5cdFx0XHRcdGNsYXNzZXM6IFwidG9vbGJhci1idXR0b25cIixcclxuXHRcdFx0XHR0ZXh0OiBuYW1lLFxyXG5cdFx0XHRcdGF0dHJzOiB7XHJcblx0XHRcdFx0XHRcImRhdGEtbmFtZVwiOiBuYW1lXHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHRvbjoge1xyXG5cdFx0XHRcdFx0Y2xpY2s6ICgpID0+IGxpZmVMaW5lLmVtaXQoXCJhY3Rpb24tZXhlYy1cIiArIG5hbWUpXHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9KTtcclxuXHRcdH0pO1xyXG5cclxuXHRcdC8vIHJlbW92ZSBhbiBhY3Rpb24gYnV0dG9uXHJcblx0XHRsaWZlTGluZS5vbihcImFjdGlvbi1yZW1vdmVcIiwgbmFtZSA9PiB7XHJcblx0XHRcdHZhciBidG4gPSBidG5zLnF1ZXJ5U2VsZWN0b3IoYFtkYXRhLW5hbWU9XCIke25hbWV9XCJdYCk7XHJcblxyXG5cdFx0XHRpZihidG4pIGJ0bi5yZW1vdmUoKTtcclxuXHRcdH0pO1xyXG5cclxuXHRcdC8vIHJlbW92ZSBhbGwgdGhlIGFjdGlvbiBidXR0b25zXHJcblx0XHRsaWZlTGluZS5vbihcImFjdGlvbi1yZW1vdmUtYWxsXCIsICgpID0+IGJ0bnMuaW5uZXJIVE1MID0gXCJcIik7XHJcblxyXG5cdFx0Ly8gZGlzcGxheSB0aGUgY29udGVudCBmb3IgdGhlIHZpZXdcclxuXHRcdHZhciB1cGRhdGVWaWV3ID0gKCkgPT4ge1xyXG5cdFx0XHQvLyBkZXN0cm95IGFueSBsaXN0ZW5lcnMgZnJvbSBvbGQgY29udGVudFxyXG5cdFx0XHRpZihkaXNwb3NhYmxlKSB7XHJcblx0XHRcdFx0ZGlzcG9zYWJsZS5kaXNwb3NlKCk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdC8vIHJlbW92ZSBhbnkgYWN0aW9uIGJ1dHRvbnNcclxuXHRcdFx0bGlmZUxpbmUuZW1pdChcImFjdGlvbi1yZW1vdmUtYWxsXCIpO1xyXG5cclxuXHRcdFx0Ly8gY2xlYXIgYWxsIHRoZSBvbGQgY29udGVudFxyXG5cdFx0XHRjb250ZW50LmlubmVySFRNTCA9IFwiXCI7XHJcblxyXG5cdFx0XHQvLyBjcmVhdGUgdGhlIGRpc3Bvc2FibGUgZm9yIHRoZSBjb250ZW50XHJcblx0XHRcdGRpc3Bvc2FibGUgPSBuZXcgbGlmZUxpbmUuRGlzcG9zYWJsZSgpO1xyXG5cclxuXHRcdFx0dmFyIG1ha2VyID0gbm90Rm91bmRNYWtlciwgbWF0Y2g7XHJcblxyXG5cdFx0XHQvLyBmaW5kIHRoZSBjb3JyZWN0IGNvbnRlbnQgbWFrZXJcclxuXHRcdFx0Zm9yKGxldCAkbWFrZXIgb2YgY29udGVudE1ha2Vycykge1xyXG5cdFx0XHRcdC8vIHJ1biBhIG1hdGNoZXIgZnVuY3Rpb25cclxuXHRcdFx0XHRpZih0eXBlb2YgJG1ha2VyLm1hdGNoZXIgPT0gXCJmdW5jdGlvblwiKSB7XHJcblx0XHRcdFx0XHRtYXRjaCA9ICRtYWtlci5tYXRjaGVyKGxvY2F0aW9uLnBhdGhuYW1lKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0Ly8gYSBzdHJpbmcgbWF0Y2hcclxuXHRcdFx0XHRlbHNlIGlmKHR5cGVvZiAkbWFrZXIubWF0Y2hlciA9PSBcInN0cmluZ1wiKSB7XHJcblx0XHRcdFx0XHRpZigkbWFrZXIubWF0Y2hlciA9PSBsb2NhdGlvbi5wYXRobmFtZSkge1xyXG5cdFx0XHRcdFx0XHRtYXRjaCA9ICRtYWtlci5tYXRjaGVyO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHQvLyBhIHJlZ2V4IG1hdGNoXHJcblx0XHRcdFx0ZWxzZSB7XHJcblx0XHRcdFx0XHRtYXRjaCA9ICRtYWtlci5tYXRjaGVyLmV4ZWMobG9jYXRpb24ucGF0aG5hbWUpO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0Ly8gbWF0Y2ggZm91bmQgc3RvcCBzZWFyY2hpbmdcclxuXHRcdFx0XHRpZihtYXRjaCkge1xyXG5cdFx0XHRcdFx0bWFrZXIgPSAkbWFrZXI7XHJcblxyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblxyXG5cdFx0XHQvLyBtYWtlIHRoZSBjb250ZW50IGZvciB0aGlzIHJvdXRlXHJcblx0XHRcdG1ha2VyLm1ha2Uoe2Rpc3Bvc2FibGUsIHNldFRpdGxlLCBjb250ZW50LCBtYXRjaH0pO1xyXG5cdFx0fTtcclxuXHJcblx0XHQvLyBzd2l0Y2ggcGFnZXNcclxuXHRcdGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZSA9IGZ1bmN0aW9uKHVybCkge1xyXG5cdFx0XHQvLyB1cGRhdGUgdGhlIHVybFxyXG5cdFx0XHRoaXN0b3J5LnB1c2hTdGF0ZShudWxsLCBudWxsLCB1cmwpO1xyXG5cclxuXHRcdFx0Ly8gc2hvdyB0aGUgbmV3IHZpZXdcclxuXHRcdFx0dXBkYXRlVmlldygpO1xyXG5cdFx0fTtcclxuXHJcblx0XHQvLyBzd2l0Y2ggcGFnZXMgd2hlbiB0aGUgdXNlciBwdXNoZXMgdGhlIGJhY2sgYnV0dG9uXHJcblx0XHR3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvcHN0YXRlXCIsICgpID0+IHVwZGF0ZVZpZXcoKSk7XHJcblxyXG5cdFx0Ly8gc2hvdyB0aGUgaW5pdGlhbCB2aWV3XHJcblx0XHR1cGRhdGVWaWV3KCk7XHJcblx0fVxyXG59KTtcclxuXHJcbi8vIGFsbCBjb250ZW50IHByb2R1Y2Vyc1xyXG52YXIgY29udGVudE1ha2VycyA9IFtdO1xyXG5cclxuLy8gY3JlYXRlIHRoZSBuYW1lc3BhY2VcclxubGlmZUxpbmUubmF2ID0ge307XHJcblxyXG4vLyByZWdpc3RlciBhIGNvbnRlbnQgbWFrZXJcclxubGlmZUxpbmUubmF2LnJlZ2lzdGVyID0gZnVuY3Rpb24obWFrZXIpIHtcclxuXHRjb250ZW50TWFrZXJzLnB1c2gobWFrZXIpO1xyXG59O1xyXG5cclxuLy8gdGhlIGZhbGwgYmFjayBtYWtlciBmb3Igbm8gc3VjaCBwYWdlXHJcbnZhciBub3RGb3VuZE1ha2VyID0ge1xyXG5cdG1ha2Uoe3NldFRpdGxlLCBjb250ZW50fSkge1xyXG5cdFx0Ly8gdXBkYXRlIHRoZSBwYWdlIHRpdGxlXHJcblx0XHRzZXRUaXRsZShcIk5vdCBmb3VuZFwiKTtcclxuXHJcblx0XHRsaWZlTGluZS5tYWtlRG9tKHtcclxuXHRcdFx0cGFyZW50OiBjb250ZW50LFxyXG5cdFx0XHRjbGFzc2VzOiBcImNvbnRlbnQtcGFkZGVkXCIsXHJcblx0XHRcdGNoaWxkcmVuOiBbXHJcblx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0dGFnOiBcInNwYW5cIixcclxuXHRcdFx0XHRcdHRleHQ6IFwiVGhlIHBhZ2UgeW91IGFyZSBsb29raW5nIGZvciBjb3VsZCBub3QgYmUgZm91bmQuIFwiXHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHR7XHJcblx0XHRcdFx0XHR3aWRnZXQ6IFwibGlua1wiLFxyXG5cdFx0XHRcdFx0aHJlZjogXCIvXCIsXHJcblx0XHRcdFx0XHR0ZXh0OiBcIkdvIGhvbWVcIlxyXG5cdFx0XHRcdH1cclxuXHRcdFx0XVxyXG5cdFx0fSk7XHJcblx0fVxyXG59O1xyXG4iLCIvKipcclxuICogQ3JlYXRlIGFuIGlucHV0IGZpZWxkXHJcbiAqL1xyXG5cclxubGlmZUxpbmUubWFrZURvbS5yZWdpc3RlcihcImlucHV0XCIsIHtcclxuXHRtYWtlKHt0YWcsIHR5cGUsIHZhbHVlLCBjaGFuZ2UsIGJpbmQsIHByb3AsIHBsYWNlaG9sZGVyLCBjbGFzc2VzfSkge1xyXG5cdFx0Ly8gc2V0IHRoZSBpbml0aWFsIHZhbHVlIG9mIHRoZSBib3VuZCBvYmplY3RcclxuXHRcdGlmKHR5cGVvZiBiaW5kID09IFwib2JqZWN0XCIgJiYgIXZhbHVlKSB7XHJcblx0XHRcdHZhbHVlID0gYmluZFtwcm9wXTtcclxuXHRcdH1cclxuXHJcblx0XHR2YXIgaW5wdXQgPSB7XHJcblx0XHRcdHRhZzogdGFnIHx8IFwiaW5wdXRcIixcclxuXHRcdFx0Y2xhc3NlczogY2xhc3NlcyB8fCBgJHt0YWcgPT0gXCJ0ZXh0YXJlYVwiID8gXCJ0ZXh0YXJlYVwiIDogXCJpbnB1dFwifS1maWxsYCxcclxuXHRcdFx0YXR0cnM6IHt9LFxyXG5cdFx0XHRvbjoge1xyXG5cdFx0XHRcdGlucHV0OiBlID0+IHtcclxuXHRcdFx0XHRcdC8vIHVwZGF0ZSB0aGUgcHJvcGVydHkgY2hhbmdlZFxyXG5cdFx0XHRcdFx0aWYodHlwZW9mIGJpbmQgPT0gXCJvYmplY3RcIikge1xyXG5cdFx0XHRcdFx0XHRiaW5kW3Byb3BdID0gZS50YXJnZXQudmFsdWU7XHJcblx0XHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdFx0Ly8gY2FsbCB0aGUgY2FsbGJhY2tcclxuXHRcdFx0XHRcdGlmKHR5cGVvZiBjaGFuZ2UgPT0gXCJmdW5jdGlvblwiKSB7XHJcblx0XHRcdFx0XHRcdGNoYW5nZShlLnRhcmdldC52YWx1ZSk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9O1xyXG5cclxuXHRcdC8vIGF0dGFjaCB2YWx1ZXMgaWYgdGhleSBhcmUgZ2l2ZW5cclxuXHRcdGlmKHR5cGUpIGlucHV0LmF0dHJzLnR5cGUgPSB0eXBlO1xyXG5cdFx0aWYodmFsdWUpIGlucHV0LmF0dHJzLnZhbHVlID0gdmFsdWU7XHJcblx0XHRpZihwbGFjZWhvbGRlcikgaW5wdXQuYXR0cnMucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlcjtcclxuXHJcblx0XHQvLyBmb3IgdGV4dGFyZWFzIHNldCBpbm5lclRleHRcclxuXHRcdGlmKHRhZyA9PSBcInRleHRhcmVhXCIpIHtcclxuXHRcdFx0aW5wdXQudGV4dCA9IHZhbHVlO1xyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBpbnB1dDtcclxuXHR9XHJcbn0pO1xyXG4iLCIvKipcclxuICogQSB3aWRnZXQgdGhhdCBjcmVhdGVzIGEgbGluayB0aGF0IGhvb2tzIGludG8gdGhlIG5hdmlnYXRvclxyXG4gKi9cclxuXHJcbmxpZmVMaW5lLm1ha2VEb20ucmVnaXN0ZXIoXCJsaW5rXCIsIHtcclxuXHRtYWtlKG9wdHMpIHtcclxuXHRcdHJldHVybiB7XHJcblx0XHRcdHRhZzogXCJhXCIsXHJcblx0XHRcdGF0dHJzOiB7XHJcblx0XHRcdFx0aHJlZjogb3B0cy5ocmVmXHJcblx0XHRcdH0sXHJcblx0XHRcdG9uOiB7XHJcblx0XHRcdFx0Y2xpY2s6IGUgPT4ge1xyXG5cdFx0XHRcdFx0Ly8gZG9uJ3Qgb3ZlciByaWRlIGN0cmwgb3IgYWx0IG9yIHNoaWZ0IGNsaWNrc1xyXG5cdFx0XHRcdFx0aWYoZS5jdHJsS2V5IHx8IGUuYWx0S2V5IHx8IGUuc2hpZnRLZXkpIHJldHVybjtcclxuXHJcblx0XHRcdFx0XHQvLyBkb24ndCBuYXZpZ2F0ZSB0aGUgcGFnZVxyXG5cdFx0XHRcdFx0ZS5wcmV2ZW50RGVmYXVsdCgpO1xyXG5cclxuXHRcdFx0XHRcdGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZShvcHRzLmhyZWYpXHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9LFxyXG5cdFx0XHR0ZXh0OiBvcHRzLnRleHRcclxuXHRcdH07XHJcblx0fVxyXG59KTtcclxuIiwiLyoqXHJcbiAqIERpc3BsYXkgYSBsaXN0IHdpdGggZ3JvdXAgaGVhZGluZ3NcclxuICovXHJcblxyXG5saWZlTGluZS5tYWtlRG9tLnJlZ2lzdGVyKFwibGlzdFwiLCB7XHJcblx0bWFrZSh7aXRlbXN9KSB7XHJcblx0XHQvLyBhZGQgYWxsIHRoZSBncm91cHNcclxuXHRcdHJldHVybiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhpdGVtcylcclxuXHJcblx0XHQubWFwKGdyb3VwTmFtZSA9PiBtYWtlR3JvdXAoZ3JvdXBOYW1lLCBpdGVtc1tncm91cE5hbWVdKSk7XHJcblx0fVxyXG59KTtcclxuXHJcbi8vIG1ha2UgYSBzaW5nbGUgZ3JvdXBcclxudmFyIG1ha2VHcm91cCA9IGZ1bmN0aW9uKG5hbWUsIGl0ZW1zLCBwYXJlbnQpIHtcclxuXHQvLyBhZGQgdGhlIGxpc3QgaGVhZGVyXHJcblx0aXRlbXMudW5zaGlmdCh7XHJcblx0XHRjbGFzc2VzOiBcImxpc3QtaGVhZGVyXCIsXHJcblx0XHR0ZXh0OiBuYW1lXHJcblx0fSk7XHJcblxyXG5cdC8vIHJlbmRlciB0aGUgaXRlbVxyXG5cdHJldHVybiB7XHJcblx0XHRwYXJlbnQsXHJcblx0XHRjbGFzc2VzOiBcImxpc3Qtc2VjdGlvblwiLFxyXG5cdFx0Y2hpbGRyZW46IGl0ZW1zLm1hcCgoaXRlbSwgaW5kZXgpID0+IHtcclxuXHRcdFx0Ly8gZG9uJ3QgbW9kaWZ5IHRoZSBoZWFkZXJcclxuXHRcdFx0aWYoaW5kZXggPT09IDApIHJldHVybiBpdGVtO1xyXG5cclxuXHRcdFx0dmFyIGl0ZW1Eb207XHJcblxyXG5cdFx0XHQvLyBjcmVhdGUgYW4gaXRlbVxyXG5cdFx0XHRpZih0eXBlb2YgaXRlbSAhPSBcInN0cmluZ1wiKSB7XHJcblx0XHRcdFx0aXRlbURvbSA9IHtcclxuXHRcdFx0XHRcdGNsYXNzZXM6IFwibGlzdC1pdGVtXCIsXHJcblx0XHRcdFx0XHRjaGlsZHJlbjogKGl0ZW0uaXRlbXMgfHwgaXRlbSkubWFwKGl0ZW0gPT4ge1xyXG5cdFx0XHRcdFx0XHRyZXR1cm4ge1xyXG5cdFx0XHRcdFx0XHRcdC8vIGdldCB0aGUgbmFtZSBvZiB0aGUgaXRlbVxyXG5cdFx0XHRcdFx0XHRcdHRleHQ6IHR5cGVvZiBpdGVtID09IFwic3RyaW5nXCIgPyBpdGVtIDogaXRlbS50ZXh0LFxyXG5cdFx0XHRcdFx0XHRcdC8vIHNldCB3aGV0aGVyIHRoZSBpdGVtIHNob3VsZCBncm93XHJcblx0XHRcdFx0XHRcdFx0Y2xhc3NlczogaXRlbS5ncm93ID8gXCJsaXN0LWl0ZW0tZ3Jvd1wiIDogXCJsaXN0LWl0ZW0tcGFydFwiXHJcblx0XHRcdFx0XHRcdH07XHJcblx0XHRcdFx0XHR9KVxyXG5cdFx0XHRcdH07XHJcblx0XHRcdH1cclxuXHRcdFx0ZWxzZSB7XHJcblx0XHRcdFx0aXRlbURvbSA9IHtcclxuXHRcdFx0XHRcdGNsYXNzZXM6IFwibGlzdC1pdGVtXCIsXHJcblx0XHRcdFx0XHR0ZXh0OiBpdGVtXHJcblx0XHRcdFx0fTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0Ly8gbWFrZSB0aGUgaXRlbSBhIGxpbmtcclxuXHRcdFx0aWYoaXRlbS5ocmVmKSB7XHJcblx0XHRcdFx0aXRlbURvbS5vbiA9IHtcclxuXHRcdFx0XHRcdGNsaWNrOiAoKSA9PiBsaWZlTGluZS5uYXYubmF2aWdhdGUoaXRlbS5ocmVmKVxyXG5cdFx0XHRcdH07XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdHJldHVybiBpdGVtRG9tO1xyXG5cdFx0fSlcclxuXHR9O1xyXG59O1xyXG4iLCIvKipcclxuICogVGhlIHdpZGdldCBmb3IgdGhlIHNpZGViYXJcclxuICovXHJcblxyXG5saWZlTGluZS5tYWtlRG9tLnJlZ2lzdGVyKFwic2lkZWJhclwiLCB7XHJcblx0bWFrZSgpIHtcclxuXHRcdHJldHVybiBbXHJcblx0XHRcdHtcclxuXHRcdFx0XHRjbGFzc2VzOiBcInNpZGViYXJcIixcclxuXHRcdFx0XHRuYW1lOiBcInNpZGViYXJcIixcclxuXHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRjbGFzc2VzOiBbXCJzaWRlYmFyLWFjdGlvbnNcIiwgXCJoaWRkZW5cIl0sXHJcblx0XHRcdFx0XHRcdG5hbWU6IFwiYWN0aW9uc1wiLFxyXG5cdFx0XHRcdFx0XHRjaGlsZHJlbjogW1xyXG5cdFx0XHRcdFx0XHRcdHtcclxuXHRcdFx0XHRcdFx0XHRcdGNsYXNzZXM6IFwic2lkZWJhci1oZWFkaW5nXCIsXHJcblx0XHRcdFx0XHRcdFx0XHR0ZXh0OiBcIlBhZ2UgYWN0aW9uc1wiXHJcblx0XHRcdFx0XHRcdFx0fVxyXG5cdFx0XHRcdFx0XHRdXHJcblx0XHRcdFx0XHR9LFxyXG5cdFx0XHRcdFx0e1xyXG5cdFx0XHRcdFx0XHRjbGFzc2VzOiBcInNpZGViYXItaGVhZGluZ1wiLFxyXG5cdFx0XHRcdFx0XHR0ZXh0OiBcIk1vcmUgYWN0aW9uc1wiXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XVxyXG5cdFx0XHR9LFxyXG5cdFx0XHR7XHJcblx0XHRcdFx0Y2xhc3NlczogXCJzaGFkZVwiLFxyXG5cdFx0XHRcdG9uOiB7XHJcblx0XHRcdFx0XHQvLyBjbG9zZSB0aGUgc2lkZWJhclxyXG5cdFx0XHRcdFx0Y2xpY2s6ICgpID0+IGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnJlbW92ZShcInNpZGViYXItb3BlblwiKVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0XTtcclxuXHR9LFxyXG5cclxuXHRiaW5kKG9wdHMsIHthY3Rpb25zLCBzaWRlYmFyfSkge1xyXG5cdFx0Ly8gYWRkIGEgY29tbWFuZCB0byB0aGUgc2lkZWJhclxyXG5cdFx0bGlmZUxpbmUuYWRkQ29tbWFuZCA9IGZ1bmN0aW9uKG5hbWUsIGZuKSB7XHJcblx0XHRcdC8vIG1ha2UgdGhlIHNpZGViYXIgaXRlbVxyXG5cdFx0XHR2YXIge2l0ZW19ID0gbGlmZUxpbmUubWFrZURvbSh7XHJcblx0XHRcdFx0cGFyZW50OiBzaWRlYmFyLFxyXG5cdFx0XHRcdHRhZzogXCJkaXZcIixcclxuXHRcdFx0XHRuYW1lOiBcIml0ZW1cIixcclxuXHRcdFx0XHRjbGFzc2VzOiBcInNpZGViYXItaXRlbVwiLFxyXG5cdFx0XHRcdHRleHQ6IG5hbWUsXHJcblx0XHRcdFx0b246IHtcclxuXHRcdFx0XHRcdGNsaWNrOiAoKSA9PiB7XHJcblx0XHRcdFx0XHRcdC8vIGNsb3NlIHRoZSBzaWRlYmFyXHJcblx0XHRcdFx0XHRcdGRvY3VtZW50LmJvZHkuY2xhc3NMaXN0LnJlbW92ZShcInNpZGViYXItb3BlblwiKTtcclxuXHJcblx0XHRcdFx0XHRcdC8vIGNhbGwgdGhlIGxpc3RlbmVyXHJcblx0XHRcdFx0XHRcdGZuKCk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9KTtcclxuXHJcblx0XHRcdHJldHVybiB7XHJcblx0XHRcdFx0dW5zdWJzY3JpYmU6ICgpID0+IGl0ZW0ucmVtb3ZlKClcclxuXHRcdFx0fTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gYWRkIGEgbmF2aWdhdGlvbmFsIGNvbW1hbmRcclxuXHRcdGxpZmVMaW5lLmFkZE5hdkNvbW1hbmQgPSBmdW5jdGlvbihuYW1lLCB0bykge1xyXG5cdFx0XHRsaWZlTGluZS5hZGRDb21tYW5kKG5hbWUsICgpID0+IGxpZmVMaW5lLm5hdi5uYXZpZ2F0ZSh0bykpO1xyXG5cdFx0fTtcclxuXHJcblx0XHQvLyBhZGQgYSBzaWRlYmFyIGFjdGlvblxyXG5cdFx0bGlmZUxpbmUub24oXCJhY3Rpb24tY3JlYXRlXCIsIG5hbWUgPT4ge1xyXG5cdFx0XHQvLyBzaG93IHRoZSBhY3Rpb25zXHJcblx0XHRcdGFjdGlvbnMuY2xhc3NMaXN0LnJlbW92ZShcImhpZGRlblwiKTtcclxuXHJcblx0XHRcdC8vIGNyZWF0ZSB0aGUgYnV0dG9uXHJcblx0XHRcdGxpZmVMaW5lLm1ha2VEb20oe1xyXG5cdFx0XHRcdHBhcmVudDogYWN0aW9ucyxcclxuXHRcdFx0XHR0YWc6IFwiZGl2XCIsXHJcblx0XHRcdFx0bmFtZTogXCJpdGVtXCIsXHJcblx0XHRcdFx0Y2xhc3NlczogXCJzaWRlYmFyLWl0ZW1cIixcclxuXHRcdFx0XHR0ZXh0OiBuYW1lLFxyXG5cdFx0XHRcdGF0dHJzOiB7XHJcblx0XHRcdFx0XHRcImRhdGEtbmFtZVwiOiBuYW1lXHJcblx0XHRcdFx0fSxcclxuXHRcdFx0XHRvbjoge1xyXG5cdFx0XHRcdFx0Y2xpY2s6ICgpID0+IHtcclxuXHRcdFx0XHRcdFx0Ly8gY2xvc2UgdGhlIHNpZGViYXJcclxuXHRcdFx0XHRcdFx0ZG9jdW1lbnQuYm9keS5jbGFzc0xpc3QucmVtb3ZlKFwic2lkZWJhci1vcGVuXCIpO1xyXG5cclxuXHRcdFx0XHRcdFx0Ly8gdHJpZ2dlciB0aGUgYWN0aW9uXHJcblx0XHRcdFx0XHRcdGxpZmVMaW5lLmVtaXQoXCJhY3Rpb24tZXhlYy1cIiArIG5hbWUpO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSk7XHJcblxyXG5cdFx0XHQvLyByZW1vdmUgYSBzaWRlYmFyIGFjdGlvblxyXG5cdFx0XHRsaWZlTGluZS5vbihcImFjdGlvbi1yZW1vdmVcIiwgbmFtZSA9PiB7XHJcblx0XHRcdFx0Ly8gcmVtb3ZlIHRoZSBidXR0b25cclxuXHRcdFx0XHR2YXIgYnRuID0gYWN0aW9ucy5xdWVyeVNlbGVjdG9yKGBbZGF0YS1uYW1lPVwiJHtuYW1lfVwiXWApO1xyXG5cclxuXHRcdFx0XHRpZihidG4pIGJ0bi5yZW1vdmUoKTtcclxuXHJcblx0XHRcdFx0Ly8gaGlkZSB0aGUgcGFnZSBhY3Rpb25zIGlmIHRoZXJlIGFyZSBub25lXHJcblx0XHRcdFx0aWYoYWN0aW9ucy5jaGlsZHJlbi5sZW5ndGggPT0gMSkge1xyXG5cdFx0XHRcdFx0YWN0aW9ucy5jbGFzc0xpc3QuYWRkKFwiaGlkZGVuXCIpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fSk7XHJcblxyXG5cdFx0XHQvLyByZW1vdmUgYWxsIHRoZSBzaWRlYmFyIGFjdGlvbnNcclxuXHRcdFx0bGlmZUxpbmUub24oXCJhY3Rpb24tcmVtb3ZlLWFsbFwiLCAoKSA9PiB7XHJcblx0XHRcdFx0Ly8gcmVtb3ZlIGFsbCB0aGUgYWN0aW9uc1xyXG5cdFx0XHRcdHZhciBfYWN0aW9ucyA9IEFycmF5LmZyb20oYWN0aW9ucy5xdWVyeVNlbGVjdG9yQWxsKFwiLnNpZGViYXItaXRlbVwiKSk7XHJcblxyXG5cdFx0XHRcdF9hY3Rpb25zLmZvckVhY2goYWN0aW9uID0+IGFjdGlvbi5yZW1vdmUoKSk7XHJcblxyXG5cdFx0XHRcdC8vIHNpZGUgdGhlIHBhZ2UgYWN0aW9uc1xyXG5cdFx0XHRcdGFjdGlvbnMuY2xhc3NMaXN0LmFkZChcImhpZGRlblwiKTtcclxuXHRcdFx0fSk7XHJcblx0XHR9KTtcclxuXHR9XHJcbn0pO1xyXG4iLCIvKipcclxuICogQSByb3cgb2YgcmFkaW8gc3R5bGUgYnV0dG9uc1xyXG4gKi9cclxuXHJcbmxpZmVMaW5lLm1ha2VEb20ucmVnaXN0ZXIoXCJ0b2dnbGUtYnRuc1wiLCB7XHJcblx0bWFrZSh7YnRucywgdmFsdWV9KSB7XHJcblx0XHQvLyBhdXRvIHNlbGVjdCB0aGUgZmlyc3QgYnV0dG9uXHJcblx0XHRpZighdmFsdWUpIHtcclxuXHRcdFx0dmFsdWUgPSB0eXBlb2YgYnRuc1swXSA9PSBcInN0cmluZ1wiID8gYnRuc1swXSA6IGJ0bnNbMF0udmFsdWU7XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIHtcclxuXHRcdFx0bmFtZTogXCJ0b2dnbGVCYXJcIixcclxuXHRcdFx0Y2xhc3NlczogXCJ0b2dnbGUtYmFyXCIsXHJcblx0XHRcdGNoaWxkcmVuOiBidG5zLm1hcChidG4gPT4ge1xyXG5cdFx0XHRcdC8vIGNvbnZlcnQgdGhlIHBsYWluIHN0cmluZyB0byBhbiBvYmplY3RcclxuXHRcdFx0XHRpZih0eXBlb2YgYnRuID09IFwic3RyaW5nXCIpIHtcclxuXHRcdFx0XHRcdGJ0biA9IHsgdGV4dDogYnRuLCB2YWx1ZTogYnRuIH07XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHR2YXIgY2xhc3NlcyA9IFtcInRvZ2dsZS1idG5cIl07XHJcblxyXG5cdFx0XHRcdC8vIGFkZCB0aGUgc2VsZWN0ZWQgY2xhc3NcclxuXHRcdFx0XHRpZih2YWx1ZSA9PSBidG4udmFsdWUpIHtcclxuXHRcdFx0XHRcdGNsYXNzZXMucHVzaChcInRvZ2dsZS1idG4tc2VsZWN0ZWRcIik7XHJcblxyXG5cdFx0XHRcdFx0Ly8gZG9uJ3Qgc2VsZWN0IHR3byBidXR0b25zXHJcblx0XHRcdFx0XHR2YWx1ZSA9IHVuZGVmaW5lZDtcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHRcdHJldHVybiB7XHJcblx0XHRcdFx0XHR0YWc6IFwiYnV0dG9uXCIsXHJcblx0XHRcdFx0XHRjbGFzc2VzLFxyXG5cdFx0XHRcdFx0dGV4dDogYnRuLnRleHQsXHJcblx0XHRcdFx0XHRhdHRyczoge1xyXG5cdFx0XHRcdFx0XHRcImRhdGEtdmFsdWVcIjogYnRuLnZhbHVlXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fTtcclxuXHRcdFx0fSlcclxuXHRcdH07XHJcblx0fSxcclxuXHJcblx0YmluZCh7Y2hhbmdlfSwge3RvZ2dsZUJhcn0pIHtcclxuXHRcdC8vIGF0dGFjaCBsaXN0ZW5lcnNcclxuXHRcdGZvcihsZXQgYnRuIG9mIHRvZ2dsZUJhci5xdWVyeVNlbGVjdG9yQWxsKFwiLnRvZ2dsZS1idG5cIikpIHtcclxuXHRcdFx0YnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcblx0XHRcdFx0dmFyIHNlbGVjdGVkID0gdG9nZ2xlQmFyLnF1ZXJ5U2VsZWN0b3IoXCIudG9nZ2xlLWJ0bi1zZWxlY3RlZFwiKTtcclxuXHJcblx0XHRcdFx0Ly8gdGhlIGJ1dHRvbiBoYXMgYWxyZWFkeSBiZWVuIHNlbGVjdGVkXHJcblx0XHRcdFx0aWYoc2VsZWN0ZWQgPT0gYnRuKSB7XHJcblx0XHRcdFx0XHRyZXR1cm47XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHQvLyB1bnRvZ2dsZSB0aGUgb3RoZXIgYnV0dG9uXHJcblx0XHRcdFx0aWYoc2VsZWN0ZWQpIHtcclxuXHRcdFx0XHRcdHNlbGVjdGVkLmNsYXNzTGlzdC5yZW1vdmUoXCJ0b2dnbGUtYnRuLXNlbGVjdGVkXCIpO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdFx0Ly8gc2VsZWN0IHRoaXMgYnV0dG9uXHJcblx0XHRcdFx0YnRuLmNsYXNzTGlzdC5hZGQoXCJ0b2dnbGUtYnRuLXNlbGVjdGVkXCIpO1xyXG5cclxuXHRcdFx0XHQvLyB0cmlnZ2VyIGEgc2VsZWN0aW9uIGNoYW5nZVxyXG5cdFx0XHRcdGNoYW5nZShidG4uZGF0YXNldC52YWx1ZSk7XHJcblx0XHRcdH0pO1xyXG5cdFx0fVxyXG5cdH1cclxufSk7XHJcbiIsIi8qKlxyXG4gKiBOYW1lIGdlbmVyYXRvciBmb3IgYmFja3Vwc1xyXG4gKi9cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBnZW5CYWNrdXBOYW1lKCkge1xyXG5cdHZhciBkYXRlID0gbmV3IERhdGUoKTtcclxuXHJcblx0cmV0dXJuIGBiYWNrdXAtJHtkYXRlLmdldEZ1bGxZZWFyKCl9LSR7ZGF0ZS5nZXRNb250aCgpKzF9LSR7ZGF0ZS5nZXREYXRlKCl9YFxyXG5cdFx0KyBgLSR7ZGF0ZS5nZXRIb3VycygpfS0ke2RhdGUuZ2V0TWludXRlcygpfS56aXBgO1xyXG59XHJcbiIsIi8qKlxyXG4gKiBLZWVwIGEgbGlzdCBvZiBzdWJzY3JpcHRpb25zIHRvIHVuc3Vic2NyaWJlIGZyb20gdG9nZXRoZXJcclxuICovXHJcblxyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBEaXNwb3NhYmxlIHtcclxuXHRjb25zdHJ1Y3RvcigpIHtcclxuXHRcdHRoaXMuX3N1YnNjcmlwdGlvbnMgPSBbXTtcclxuXHR9XHJcblxyXG5cdC8vIFVuc3Vic2NyaWJlIGZyb20gYWxsIHN1YnNjcmlwdGlvbnNcclxuXHRkaXNwb3NlKCkge1xyXG5cdFx0Ly8gcmVtb3ZlIHRoZSBmaXJzdCBzdWJzY3JpcHRpb24gdW50aWwgdGhlcmUgYXJlIG5vbmUgbGVmdFxyXG5cdFx0d2hpbGUodGhpcy5fc3Vic2NyaXB0aW9ucy5sZW5ndGggPiAwKSB7XHJcblx0XHRcdHRoaXMuX3N1YnNjcmlwdGlvbnMuc2hpZnQoKS51bnN1YnNjcmliZSgpO1xyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0Ly8gQWRkIGEgc3Vic2NyaXB0aW9uIHRvIHRoZSBkaXNwb3NhYmxlXHJcblx0YWRkKHN1YnNjcmlwdGlvbikge1xyXG5cdFx0Ly8gY29weSB0aGUgZGlzcG9zYWJsZVxyXG5cdFx0aWYoc3Vic2NyaXB0aW9uIGluc3RhbmNlb2YgRGlzcG9zYWJsZSkge1xyXG5cdFx0XHQvLyBjb3B5IHRoZSBzdWJzY3JpcHRpb25zIGZyb20gdGhlIGRpc3Bvc2FibGVcclxuXHRcdFx0dGhpcy5fc3Vic2NyaXB0aW9ucyA9IHRoaXMuX3N1YnNjcmlwdGlvbnMuY29uY2F0KHN1YnNjcmlwdGlvbi5fc3Vic2NyaXB0aW9ucyk7XHJcblxyXG5cdFx0XHQvLyByZW1vdmUgdGhlIHJlZnJlbmNlcyBmcm9tIHRoZSBkaXNwb3NhYmxlXHJcblx0XHRcdHN1YnNjcmlwdGlvbi5fc3Vic2NyaXB0aW9ucyA9IFtdO1xyXG5cdFx0fVxyXG5cdFx0Ly8gYWRkIGEgc3Vic2NyaXB0aW9uXHJcblx0XHRlbHNlIHtcclxuXHRcdFx0dGhpcy5fc3Vic2NyaXB0aW9ucy5wdXNoKHN1YnNjcmlwdGlvbik7XHJcblx0XHR9XHJcblx0fVxyXG5cclxuXHQvLyBkaXNwb3NlIHdoZW4gYW4gZXZlbnQgaXMgZmlyZWRcclxuXHRkaXNwb3NlT24oZW1pdHRlciwgZXZlbnQpIHtcclxuXHRcdHRoaXMuYWRkKGVtaXR0ZXIub24oZXZlbnQsICgpID0+IHRoaXMuZGlzcG9zZSgpKSk7XHJcblx0fVxyXG59O1xyXG4iLCIvKipcclxuICogQSBiYXNpYyBldmVudCBlbWl0dGVyXHJcbiAqL1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRXZlbnRFbWl0dGVyIHtcclxuXHRjb25zdHJ1Y3RvcigpIHtcclxuXHRcdHRoaXMuX2xpc3RlbmVycyA9IHt9O1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogQWRkIGFuIGV2ZW50IGxpc3RlbmVyXHJcblx0ICovXHJcblx0b24obmFtZSwgbGlzdGVuZXIpIHtcclxuXHRcdC8vIGlmIHdlIGRvbid0IGhhdmUgYW4gZXhpc3RpbmcgbGlzdGVuZXJzIGFycmF5IGNyZWF0ZSBvbmVcclxuXHRcdGlmKCF0aGlzLl9saXN0ZW5lcnNbbmFtZV0pIHtcclxuXHRcdFx0dGhpcy5fbGlzdGVuZXJzW25hbWVdID0gW107XHJcblx0XHR9XHJcblxyXG5cdFx0Ly8gYWRkIHRoZSBsaXN0ZW5lclxyXG5cdFx0dGhpcy5fbGlzdGVuZXJzW25hbWVdLnB1c2gobGlzdGVuZXIpO1xyXG5cclxuXHRcdC8vIGdpdmUgdGhlbSBhIHN1YnNjcmlwdGlvblxyXG5cdFx0cmV0dXJuIHtcclxuXHRcdFx0X2xpc3RlbmVyOiBsaXN0ZW5lcixcclxuXHJcblx0XHRcdHVuc3Vic2NyaWJlOiAoKSA9PiB7XHJcblx0XHRcdFx0Ly8gZmluZCB0aGUgbGlzdGVuZXJcclxuXHRcdFx0XHR2YXIgaW5kZXggPSB0aGlzLl9saXN0ZW5lcnNbbmFtZV0uaW5kZXhPZihsaXN0ZW5lcik7XHJcblxyXG5cdFx0XHRcdGlmKGluZGV4ICE9PSAtMSkge1xyXG5cdFx0XHRcdFx0dGhpcy5fbGlzdGVuZXJzW25hbWVdLnNwbGljZShpbmRleCwgMSk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogRW1pdCBhbiBldmVudFxyXG5cdCAqL1xyXG5cdGVtaXQobmFtZSwgLi4uYXJncykge1xyXG5cdFx0Ly8gY2hlY2sgZm9yIGxpc3RlbmVyc1xyXG5cdFx0aWYodGhpcy5fbGlzdGVuZXJzW25hbWVdKSB7XHJcblx0XHRcdGZvcihsZXQgbGlzdGVuZXIgb2YgdGhpcy5fbGlzdGVuZXJzW25hbWVdKSB7XHJcblx0XHRcdFx0Ly8gY2FsbCB0aGUgbGlzdGVuZXJzXHJcblx0XHRcdFx0bGlzdGVuZXIoLi4uYXJncyk7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIEVtaXQgYW4gZXZlbnQgYW5kIHNraXAgc29tZSBsaXN0ZW5lcnNcclxuXHQgKi9cclxuXHRwYXJ0aWFsRW1pdChuYW1lLCBza2lwcyA9IFtdLCAuLi5hcmdzKSB7XHJcblx0XHQvLyBhbGxvdyBhIHNpbmdsZSBpdGVtXHJcblx0XHRpZighQXJyYXkuaXNBcnJheShza2lwcykpIHtcclxuXHRcdFx0c2tpcHMgPSBbc2tpcHNdO1xyXG5cdFx0fVxyXG5cclxuXHRcdC8vIGNoZWNrIGZvciBsaXN0ZW5lcnNcclxuXHRcdGlmKHRoaXMuX2xpc3RlbmVyc1tuYW1lXSkge1xyXG5cdFx0XHRmb3IobGV0IGxpc3RlbmVyIG9mIHRoaXMuX2xpc3RlbmVyc1tuYW1lXSkge1xyXG5cdFx0XHRcdC8vIHRoaXMgZXZlbnQgbGlzdGVuZXIgaXMgYmVpbmcgc2tpcGVkXHJcblx0XHRcdFx0aWYoc2tpcHMuZmluZChza2lwID0+IHNraXAuX2xpc3RlbmVyID09IGxpc3RlbmVyKSkge1xyXG5cdFx0XHRcdFx0Y29udGludWU7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0XHQvLyBjYWxsIHRoZSBsaXN0ZW5lcnNcclxuXHRcdFx0XHRsaXN0ZW5lciguLi5hcmdzKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH1cclxufVxyXG4iLCIvKipcclxuICogQ3JlYXRlIGEgZ2xvYmFsIG9iamVjdCB3aXRoIGNvbW1vbmx5IHVzZWQgbW9kdWxlcyB0byBhdm9pZCA1MCBtaWxsaW9uIHJlcXVpcmVzXHJcbiAqL1xyXG5cclxuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiLi9ldmVudC1lbWl0dGVyXCI7XHJcblxyXG52YXIgbGlmZUxpbmUgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XHJcblxyXG4vLyBwbGF0Zm9ybSBkZXRlY3Rpb25cclxubGlmZUxpbmUubm9kZSA9IHR5cGVvZiBwcm9jZXNzID09IFwib2JqZWN0XCI7XHJcbmxpZmVMaW5lLmJyb3dzZXIgPSB0eXBlb2Ygd2luZG93ID09IFwib2JqZWN0XCI7XHJcblxyXG4vLyBhdHRhY2ggdXRpbHNcclxubGlmZUxpbmUuRGlzcG9zYWJsZSA9IHJlcXVpcmUoXCIuL2Rpc3Bvc2FibGVcIikuZGVmYXVsdDtcclxubGlmZUxpbmUuRXZlbnRFbWl0dGVyID0gRXZlbnRFbWl0dGVyO1xyXG5cclxuLy8gYXR0YWNoIGxpZmVsaW5lIHRvIHRoZSBnbG9iYWwgb2JqZWN0XHJcbihsaWZlTGluZS5ub2RlID8gZ2xvYmFsIDogYnJvd3NlcikubGlmZUxpbmUgPSBsaWZlTGluZTtcclxuIl19
