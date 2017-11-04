
declare module "react-stomp-websocket" {
    export class StompWebSocket {
        constructor(connectCallback?: () => void, receiptCallback?: () => void, errorCallback?: () => void, closeCallback?: () => void);
        connect(login: string, passcode: string): void;
        diconnect(disconnectCallback?: () => void): void;
        send(destinaction: string, headers: Array<any>, body: any): void;
        subscribe(destination: string, callback?: () => void, headers: Array<any>): string;
        unsubscribe(id: string, headers: Array<any>): void;
        begin(transaction: any, headers: Array<string>): void;
        commit(transaction: any, headers: Array<string>): void;
        abort(transaction: any, headers: Array<any>): void;
        ack(message_id: string, headers: Array<any>): void;
    }
}