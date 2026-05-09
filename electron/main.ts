import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    startServer,
    loadConfig,
    getBrowserUrl,
    type RunningServer,
    stopServer,
} from '#server';

let mainWindow: BrowserWindow | null = null;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let server: RunningServer | null = null;

async function createWindow(): Promise<void> {
    console.log('createWindow entered');

    const config = loadConfig();

    const url = getBrowserUrl(config.host, config.port);

    console.log(`Starting server on ${url}`);
    server = startServer({
        host: config.host,
        port: config.port,
        openBrowser: false,
    });

    console.log('Creating BrowserWindow');
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 640,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (!server || !mainWindow) {
        throw new Error('Server could not be started.');
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    await mainWindow.loadURL(url);
}

app.whenReady()
    .then(async () => {
        await createWindow();
    })
    .catch((error) => {
        console.error('Failed to create main window:', error);

        stopServer();
        app.quit();
    });

app.on('window-all-closed', () => {
    stopServer();

    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
    }
});
