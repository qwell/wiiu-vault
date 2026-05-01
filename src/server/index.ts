import express from 'express';
import path from 'node:path';

import { getAppRoot } from './paths.js';
import { loadConfig } from './config.js';
import {
    downloadNusTitleMetadata,
    getDlcMetadata,
    getUpdateMetadata,
} from './metadata.js';
import { getCachedImage } from './image-cache.js';
import { getTitleIconUrl, scanWiiUTitles } from './wiiu.js';

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

app.get('/api/library', async (req, res) => {
    try {
        const includeAll = req.query.includeAll === 'true';
        const groups = await scanWiiUTitles(romRoot, { includeAll });

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

app.get('/api/title-icon/:family', async (req, res) => {
    try {
        const iconUrl = await getTitleIconUrl(req.params.family);

        if (!iconUrl) {
            res.status(404).json({
                error: 'Missing title icon',
            });
            return;
        }

        const image = await getCachedImage(iconUrl);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(image.body);
    } catch (error) {
        console.error('[server] Failed to load title icon:', error);

        res.status(500).json({
            error: 'Failed to load title icon',
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
            baseVersions:
                metadata.titleVersion === null ? [] : [metadata.titleVersion],
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
            message: error instanceof Error ? error.message : String(error),
            stage:
                typeof error === 'object' &&
                error !== null &&
                'stage' in error &&
                typeof error.stage === 'string'
                    ? error.stage
                    : null,
        });
    }
});

app.get('/api/title-all', async (req, res) => {
    const titleId = req.query.titleId as string;

    if (!titleId) {
        res.status(400).json({
            error: 'Missing titleId query parameter',
        });
        return;
    }

    try {
        const [metadata, updateMetadata, dlcMetadata] = await Promise.all([
            downloadNusTitleMetadata(titleId),
            getUpdateMetadata(titleId),
            getDlcMetadata(titleId),
        ]);

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
            baseVersions:
                metadata.titleVersion === null ? [] : [metadata.titleVersion],
            titleKey: metadata.titleKey
                ? Buffer.from(metadata.titleKey).toString('hex')
                : null,
            titleKeyPassword: metadata.titleKeyPassword,
            updates:
                updateMetadata.exists && updateMetadata.titleVersion !== null
                    ? [updateMetadata.titleVersion]
                    : [],
            dlc:
                dlcMetadata.exists && dlcMetadata.titleVersion !== null
                    ? [dlcMetadata.titleVersion]
                    : [],
        });
    } catch (error) {
        console.error('[server] Failed to load full title metadata:', error);

        res.status(500).json({
            error: 'Failed to load full title metadata',
            message: error instanceof Error ? error.message : String(error),
            stage:
                typeof error === 'object' &&
                error !== null &&
                'stage' in error &&
                typeof error.stage === 'string'
                    ? error.stage
                    : null,
        });
    }
});

app.get('/api/title-update', async (req, res) => {
    const titleId = req.query.titleId as string;

    if (!titleId) {
        res.status(400).json({
            error: 'Missing titleId query parameter',
        });
        return;
    }

    try {
        const metadata = await getUpdateMetadata(titleId);
        res.json({
            titleId: metadata.titleId,
            updateTitleId: metadata.childTitleId,
            exists: metadata.exists,
            titleVersion: metadata.titleVersion,
        });
    } catch (error) {
        console.error('[server] Failed to load title update metadata:', error);

        res.status(500).json({
            error: 'Failed to load title update metadata',
            message: error instanceof Error ? error.message : String(error),
        });
    }
});

app.get('/api/title-dlc', async (req, res) => {
    const titleId = req.query.titleId as string;

    if (!titleId) {
        res.status(400).json({
            error: 'Missing titleId query parameter',
        });
        return;
    }

    try {
        const metadata = await getDlcMetadata(titleId);
        res.json({
            titleId: metadata.titleId,
            dlcTitleId: metadata.childTitleId,
            exists: metadata.exists,
            titleVersion: metadata.titleVersion,
        });
    } catch (error) {
        console.error('[server] Failed to load title DLC metadata:', error);

        res.status(500).json({
            error: 'Failed to load title DLC metadata',
            message: error instanceof Error ? error.message : String(error),
        });
    }
});

app.listen(port, host, () => {
    console.log(`[server] Listening at http://${host}:${port}`);
});
