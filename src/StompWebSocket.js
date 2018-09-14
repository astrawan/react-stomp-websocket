// (c) 2017 Astrawan -- wastrawan@gmail.com

const Byte = {
	// LINEFEED byte (octet 10)
	LF: '\x0A',
	// NULL byte (octet 0)
	NULL: '\x00'
};

function StompWebSocket(url, connectCallback, receiptCallback, errorCallback, closeCallback) {
	this._counter = 0;
	this._subscriptions = {};
	this._url = url;
	this._login = '';
	this._passcode = '';
	this._ws = undefined;

	this._connectCallback = connectCallback;
	this._receiptCallback = receiptCallback;
	this._errorCallback = errorCallback;
	this._closeCallback = closeCallback;

	this.STATE = {
		CONNECTING: 0,
		OPEN: 1,
		CLOSING: 2,
		CLOSED: 3
	};
};

StompWebSocket.prototype._serverActivity = -1;

StompWebSocket.prototype.VERSIONS = {
	V1_0: '1.0',
	V1_1: '1.1',
	V1_2: '1.2',

	// Versions of STOMP specifications supported
	supportedVersions() {
		return '1.2,1.1,1.0';
	}
};

StompWebSocket.prototype.heartbeat = {
	outgoing: 0,
	incoming: 0
};

StompWebSocket.prototype.setInterval = function(timeout, handler) {
	return window.setInterval(handler, timeout);
}

StompWebSocket.prototype.clearInterval = function(handle) {
	window.clearInterval(handle);
}

StompWebSocket.prototype._setupHeartbeat = function(headers) {
	if (![this.VERSIONS.V1_1, this.VERSIONS.V1_2].includes(headers.version)) return;

	const heartBeats = headers['heart-beat'].split(',');
	const serverOutgoing = heartBeats[0];
	const serverIncoming = heartBeats[1];

	var ttl;
	if (this.heartbeat.outgoing != 0 && serverIncoming != 0) {
		ttl = Math.max(this.heartbeat.outgoing, serverIncoming);
		this._debug('send PING every ' + ttl + 'ms');
		var that = this;
		this._pinger = that.setInterval(ttl, function() {
			that._ws.send(Byte.LF);
			that._debug('>>> PING');
		});
	}

	if (this.heartbeat.incoming != 0 && serverOutgoing != 0) {
		ttl = Math.max(this.heartbeat.incoming, serverOutgoing);
		this._debug('check PONG every ' + ttl + 'ms');
		var that = this;
		this._ponger = that.setInterval(ttl, function() {
			const delta = Date.now() - that._serverActivity;
			if (delta > (ttl * 2)) {
				that._debug('did not receive server activity for the last ' + delta + 'ms');
				that._ws.close();
			}
		});
	}
}

StompWebSocket.prototype._frame = function (command, headers, body) {
	return {
		command: command,
		headers: headers,
		body: body,
		toString: function () {
			var out = command + '\n';
			if (headers) {
				for (var header in headers) {
					if (headers.hasOwnProperty(header)) {
						out = out + header + ':' + headers[header] + '\n';
					}
				}
			}
			out = out + '\n';
			if (body) {
				out = out + body;
			}
			return out;
		}
	};
}

StompWebSocket.prototype._trim = function (str) {
	return str.replace(/^\s+/g, '').replace(/\s+$/g, '');
}

StompWebSocket.prototype._unmarshal = function (data) {
	var divider = data.search(/\n\n/),
		headerLines = data.substring(0, divider).split('\n'),
		command = headerLines.shift(),
		headers = {},
		body = '';

	// Parse headers
	var line = null,
		idx = null;

	for (var i = 0; i < headerLines.length; i++) {
		line = headerLines[i];
		idx = line.indexOf(':');
		headers[this._trim(line.substring(0, idx))] = this._trim(line.substring(idx + 1));
	}

	// Parse body, stopping at the first \0 found.
	// TODO: Add support for content-length header.
	var chr = null;
	for (var i = divider + 2; i < data.length; i++) {
		chr = data.charAt(i);
		if (chr === Byte.NULL) {
			break;
		}
		body += chr;
	}

	return this._frame(command, headers, body);
}

StompWebSocket.prototype._marshal = function (command, headers, body) {
	return this._frame(command, headers, body).toString() + Byte.NULL;
}

StompWebSocket.prototype._debug = function (str) {
	console.log('STOMP_WEB_SOCKET_DEBUG: ');
	console.log(str);
}

StompWebSocket.prototype.onmessage = function (evt) {
	var data = evt.data
	if (data instanceof ArrayBuffer) {
		view = new Uint8Array(data);
		data = "";
		var i, len;
		for (i = 0, len = view.length; i < len; i++) {
			data += String.fromCharCode(view[i]);
		}
	}
	this._serverActivity = Date.now();
	if (data === Byte.LF) { // heartbeat
		this._debug("<<< PONG");
		return;
	}
	this._debug('<<< ' + data);
	var frame = this._unmarshal(data);
	if (frame.command === "CONNECTED" && this._connectCallback) {
		this._setupHeartbeat(frame.headers);
		this._connectCallback(frame);
	} else if (frame.command === "MESSAGE") {
		var onreceive = this._subscriptions[frame.headers.subscription];
		if (onreceive) {
			onreceive(frame);
		}
	} else if (frame.command === "RECEIPT" && this._receiptCallback) {
		this._receiptCallback(frame);
	} else if (frame.command === "ERROR" && this._errorCallback) {
		this._errorCallback(frame);
	}
}

StompWebSocket.prototype._transmit = function (command, headers, body) {
	var out = this._marshal(command, headers, body);
	this._debug(">>> " + out);
	this._ws.send(out);
}

StompWebSocket.prototype._cleanUp = function() {
	if (this._pinger) this.clearInterval(this._pinger);
	if (this._ponger) this.clearInterval(this._ponger);
}

StompWebSocket.prototype.connect = function (login_, passcode_, headers) {
	var that = this;

	if (!headers) headers = {};

	that._login = login_;
	that._passcode = passcode_;

	that._debug("Opening Web Socket...");
	var Socket = "MozWebSocket" in window ? MozWebSocket : WebSocket;

	that._ws = new Socket(that._url, ['stomp']);
	that._ws.binaryType = "arraybuffer";

	that._ws.onmessage = that.onmessage;

	that._ws.onmessage = function (evt) {
		that.onmessage(evt);
	};

	that._ws.onclose = function () {
		var msg = "Whoops! Lost connection to " + that._url;
		that._debug(msg);
		that._cleanUp();
		that._closeCallback(msg);
	};

	that._ws.onopen = function () {
		that._debug('Web Socket Opened...');
		headers['login'] = that._login;
		headers['passcode'] = that._passcode;
		headers["accept-version"] = that.VERSIONS.supportedVersions();
		headers["heart-beat"] = [that.heartbeat.outgoing, that.heartbeat.incoming].join(',');		
		that._transmit("CONNECT", headers);
		// connectCallback handler will be called from onmessage when a CONNECTED frame is received
	};
}

StompWebSocket.prototype.disconnect = function (disconnectCallback) {
	this._transmit("DISCONNECT");
	this._ws.close();
	if (disconnectCallback) {
		disconnectCallback();
	}
}

StompWebSocket.prototype.send = function (destination, headers, body) {
	var headers = headers || {};
	headers.destination = destination;
	this._transmit("SEND", headers, body);
}

StompWebSocket.prototype.subscribe = function (destination, callback, headers) {
	var headers = headers || {};
	var id = "sub-" + this._counter++;
	headers.destination = destination;
	headers.id = id;
	this._subscriptions[id] = callback;
	this._transmit("SUBSCRIBE", headers);
	return id;
}

StompWebSocket.prototype.unsubscribe = function (id, headers) {
	var headers = headers || {};
	headers.id = id;
	delete this._subscriptions[id];
	this._transmit("UNSUBSCRIBE", headers);
}

StompWebSocket.prototype.begin = function (transaction, headers) {
	var headers = headers || {};
	headers.transaction = transaction;
	this._transmit("BEGIN", headers);
}

StompWebSocket.prototype.commit = function (transaction, headers) {
	var headers = headers || {};
	headers.transaction = transaction;
	this._transmit("COMMIT", headers);
}

StompWebSocket.prototype.abort = function (transaction, headers) {
	var headers = headers || {};
	headers.transaction = transaction;
	this._transmit("ABORT", headers);
}

StompWebSocket.prototype.ack = function (message_id, headers) {
	var headers = headers || {};
	headers["message-id"] = message_id;
	this._transmit("ACK", headers);
}

StompWebSocket.prototype.getState = function () {
	if (this._ws) {
		return this._ws.readyState;
	}

	return this.STATE.CLOSED;
}

export default StompWebSocket;