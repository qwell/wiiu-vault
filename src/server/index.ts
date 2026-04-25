import express from 'express';
import path from 'node:path';

import { getAppRoot } from './paths.js';
import { loadConfig } from './config.js';
import { downloadNusTitleMetadata } from './metadata.js';
import { scanWiiUTitles } from './wiiu.js';

const config = loadConfig();

const app = express();
const host = config.server.host;
const port = config.server.port;
const romRoot = config.roms.wiiuRoot;

const clientDir = path.join(getAppRoot(), 'client');

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

app.get('/api/title-metadata', async (req, res) => {
    const titleId = req.query.titleId as string;

    if (!titleId) {
        res.status(400).json({
            error: 'Missing titleId query parameter',
        });
        return;
    }

    try {
        const metadata = await downloadNusTitleMetadata(titleId);

        if (!metadata) {
            res.status(404).json({
                error: 'Failed to parse title metadata',
            });
            return;
        }

        res.json({
            titleId: metadata.titleId,
            name: metadata.name,
            region: metadata.region,
            productCode: metadata.productCode,
            companyCode: metadata.companyCode,
            metaJson: metadata.metaJson,
            titleKey: metadata.titleKey
                ? Buffer.from(metadata.titleKey).toString('hex')
                : null,
            titleKeyPassword: metadata.titleKeyPassword,
        });
    } catch (error) {
        console.error('[server] Failed to download title metadata:', error);

        res.status(500).json({
            error: 'Failed to download title metadata',
        });
    }
});

app.listen(port, host, () => {
    console.log(`[server] Listening at http://${host}:${port}`);
});
