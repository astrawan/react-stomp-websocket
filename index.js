// (c) 2017 Astrawan -- wastrawan@gmail.com

class StompWebSocket {
    _counter = 0;
    _subscriptions = {};
    _ws = undefined;
    _connectCallback = undefined;
    _receiptCallback = undefined;
    _errorCallback = undefined;
    _closeCallback = undefined;

    constructor(connectCallback, receiptCallback, errorCallback, closeCallback) {
        this._connectCallback = connectCallback;
        this._receiptCallback = receiptCallback;
        this._errorCallback = errorCallback;
        this._closeCallback = closeCallback;
    }

    _frame(command, headers, body) {
        return {
            command: command,
            headers: headers,
            body: body,
            toString: () => {
                var out = command + '\n';
                if (headers) {
                    for (header in headers) {
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
        var line = idx = null;
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

    transmit(command, headers, body) {
        var out = this._marshal(command, headers, body);
        this._debug(">>> " + out);
        this._ws.send(out);
    }

    connect(login_, passcode_) {
        this._debug("Opening Web Socket...");
        var Socket = "MozWebSocket" in window ? MozWebSocket : WebSocket;
        this._ws = new Socket(url);
        this._ws.binaryType = "arraybuffer";
        this._ws.onmessage = this.onmessage;
        this._ws.onclose = function () {
            var msg = "Whoops! Lost connection to " + url;
            this._debug(msg);
            this._closeCallback(msg);
        };
        this._ws.onopen = function () {
            this._debug('Web Socket Opened...');
            this.transmit("CONNECT", { login: login, passcode: passcode });
            // connectCallback handler will be called from onmessage when a CONNECTED frame is received
        };
        login = login_;
        passcode = passcode_;
    }

    diconnect(disconnectCallback) {
        this.transmit("DISCONNECT");
        this._ws.close();
        if (disconnectCallback) {
            disconnectCallback();
        }
    }

    send(destination, headers, body) {
        var headers = headers || {};
        headers.destination = destination;
        this.transmit("SEND", headers, body);
    }

    subscribe(destination, callback, headers) {
        var headers = headers || {};
        var id = "sub-" + this._counter++;
        headers.destination = destination;
        headers.id = id;
        this._subscriptions[id] = callback;
        this.transmit("SUBSCRIBE", headers);
        return id;
    }

    unsubscribe(id, headers) {
        var headers = headers || {};
        headers.id = id;
        delete this._subscriptions[id];
        this.transmit("UNSUBSCRIBE", headers);
    }

    begin(transaction, headers) {
        var headers = headers || {};
        headers.transaction = transaction;
        this.transmit("BEGIN", headers);
    }

    commit(transaction, headers) {
        var headers = headers || {};
        headers.transaction = transaction;
        this.transmit("COMMIT", headers);
    }

    abort(transaction, headers) {
        var headers = headers || {};
        headers.transaction = transaction;
        this.transmit("ABORT", headers);
    }

    ack(message_id, headers) {
        var headers = headers || {};
        headers["message-id"] = message_id;
        this.transmit("ACK", headers);
    }
};

export default StompWebSocket;