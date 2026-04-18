import express from 'express';
import path from 'node:path';

import { loadConfig } from './config.js';
import { scanWiiUTitles } from './wiiu.js';

const config = loadConfig();

const app = express();
const host = config.server.host;
const port = config.server.port;
const romRoot = config.roms.wiiuRoot;

const clientDir = path.resolve(import.meta.dirname, '../client');

app.use((req, _res, next) => {
    console.log(`[server] ${req.method} ${req.url}`);
    next();
});

app.use(express.json());
app.use(express.static(clientDir));

app.get('/api/library', async (_req, res) => {
    try {
        const groups = await scanWiiUTitles(romRoot);

        res.json({
            groups,
        });
    } catch (error) {
        console.error('[server] Failed to scan library:', error);

        res.status(500).json({
            error: 'Failed to scan library',
        });
    }
});

app.listen(port, host, () => {
    console.log(`[server] Listening at http://${host}:${port}`);
});
