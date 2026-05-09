import { createServer, Server } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';

export type RunningServer = {
    host: string;
    port: number;
    app: express.Express;
    server: Server;
    websocket: WebSocketServer;
};

export type StartOptions = {
    host: string;
    port: number;
    openBrowser: boolean;

    onListening?: () => void;
    onError?: (error: NodeJS.ErrnoException) => void;
};

let webServer: Server;
let websocketServer: WebSocketServer;

export function startServer(
    app: express.Express,
    options: StartOptions
): RunningServer {
    const { host, port, onListening, onError } = options;

    webServer = createServer(app);

    websocketServer = new WebSocketServer({
        server: webServer,
        path: '/api/socket',
    });

    if (onError) {
        webServer.on('error', onError);
    }

    if (onListening) {
        webServer.on('listening', onListening);
    }

    webServer.listen(port, host);

    return {
        host,
        port,
        app,
        server: webServer,
        websocket: websocketServer,
    };
}

export function stopServer(): void {
    for (const client of websocketServer.clients) {
        client.close();
    }
    websocketServer.close();

    webServer.close();
}

export const server = {
    start: startServer,
    stop: stopServer,
};
