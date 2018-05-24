// (c) 2017 Astrawan -- wastrawan@gmail.com

class StompWebSocket {
    constructor(url, connectCallback, receiptCallback, errorCallback, closeCallback) {
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
    }

    _frame(command, headers, body) {
        return {
            command: command,
            headers: headers,
            body: body,
            toString: () => {
                var out = command + '\n';
                if (headers) {
                    for (var header in headers) {
                        if (headers.hasOwnProperty(header)) {
                            out = out + header + ': ' + headers[header] + '\n';
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

    _trim(str) {
        return str.replace(/^\s+/g, '').replace(/\s+$/g, '');
    }

    _unmarshal(data) {
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
            if (chr === '\0') {
                break;
            }
            body += chr;
        }

        return this._frame(command, headers, body);
    }

    _marshal(command, headers, body) {
        return this._frame(command, headers, body).toString() + '\0';
    }

    _debug(str) {
        console.log('STOMP_WEB_SOCKET_DEBUG: ');
        console.log(str);
    }

    onmessage(evt) {
        var data = evt.data
        if (data instanceof ArrayBuffer) {
            view = new Uint8Array(data);
            data = "";
            var i, len;
            for (i = 0, len = view.length; i < len; i++) {
                data += String.fromCharCode(view[i]);
            }
        }
        this._debug('<<< ' + data);
        var frame = this._unmarshal(data);
        if (frame.command === "CONNECTED" && this._connectCallback) {
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

    _transmit(command, headers, body) {
        var out = this._marshal(command, headers, body);
        this._debug(">>> " + out);
        this._ws.send(out);
    }

    connect(login_, passcode_, headers) {
        var that = this;

        that._login = login_;
        that._passcode = passcode_;

        that._debug("Opening Web Socket...");
        var Socket = "MozWebSocket" in window ? MozWebSocket : WebSocket;

        that._ws = new Socket(that._url, ['stomp']);
        that._ws.binaryType = "arraybuffer";

        that._ws.onmessage = that.onmessage;

        that._ws.onmessage = (evt) => {
            that.onmessage(evt);
        };

        that._ws.onclose = function () {
            var msg = "Whoops! Lost connection to " + that._url;
            that._debug(msg);
            that._closeCallback(msg);
        };

        that._ws.onopen = function () {
			that._debug('Web Socket Opened...');
			headers['login'] = that._login;
			headers['passcode'] = that._passcode;
            that._transmit("CONNECT", { login: that._login, passcode: that._passcode });
            // connectCallback handler will be called from onmessage when a CONNECTED frame is received
        };
    }

    disconnect(disconnectCallback) {
        this._transmit("DISCONNECT");
        this._ws.close();
        if (disconnectCallback) {
            disconnectCallback();
        }
    }

    send(destination, headers, body) {
        var headers = headers || {};
        headers.destination = destination;
        this._transmit("SEND", headers, body);
    }

    subscribe(destination, callback, headers) {
        var headers = headers || {};
        var id = "sub-" + this._counter++;
        headers.destination = destination;
        headers.id = id;
        this._subscriptions[id] = callback;
        this._transmit("SUBSCRIBE", headers);
        return id;
    }

    unsubscribe(id, headers) {
        var headers = headers || {};
        headers.id = id;
        delete this._subscriptions[id];
        this._transmit("UNSUBSCRIBE", headers);
    }

    begin(transaction, headers) {
        var headers = headers || {};
        headers.transaction = transaction;
        this._transmit("BEGIN", headers);
    }

    commit(transaction, headers) {
        var headers = headers || {};
        headers.transaction = transaction;
        this._transmit("COMMIT", headers);
    }

    abort(transaction, headers) {
        var headers = headers || {};
        headers.transaction = transaction;
        this._transmit("ABORT", headers);
    }

    ack(message_id, headers) {
        var headers = headers || {};
        headers["message-id"] = message_id;
        this._transmit("ACK", headers);
    }

    getState() {
        if (this._ws) {
            return this._ws.readyState;
        }

        return this.STATE.CLOSED;
    }
};

export default StompWebSocket;