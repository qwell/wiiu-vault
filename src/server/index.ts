import express, { type Request, type Response } from 'express';
import open from 'open';
import { createServer } from 'node:http';
import path from 'node:path';

import { getAppRoot } from './paths.js';
import { loadConfig } from './config.js';
import {
    downloadNusTitleMetadata,
    generateTitleInstallFiles,
    getDlcMetadata,
    getUpdateMetadata,
} from './metadata.js';
import { getCachedImage } from './image-cache.js';
import {
    findFirstReadableWiiURoot,
    getTitleIconUrl,
    scanWiiUTitleRoots,
    validateWiiUTitleRoots,
} from './wiiu.js';

const config = loadConfig();

const app = express();
const host = config.host;
const port = config.port;
const romRoots = config.wiiuRoots;

const clientDir = path.join(getAppRoot(), 'client');

type TitleIdQueryResult =
    | {
          ok: true;
          titleId: string;
      }
    | {
          ok: false;
          error: string;
      };

function getTitleIdQuery(req: Request): TitleIdQueryResult {
    const { titleId } = req.query;

    if (typeof titleId !== 'string' || titleId.length === 0) {
        return {
            ok: false,
            error: 'Missing titleId query parameter',
        };
    }

    if (!/^[0-9a-f]{16}$/i.test(titleId)) {
        return {
            ok: false,
            error: 'titleId query parameter must be 16 hexadecimal characters',
        };
    }

    return {
        ok: true,
        titleId: titleId.toLowerCase(),
    };
}

function requireTitleIdQuery(req: Request, res: Response): string | null {
    const result = getTitleIdQuery(req);
    if (result.ok) {
        return result.titleId;
    }

    res.status(400).json({
        error: result.error,
    });
    return null;
}

function getErrorStage(error: unknown): string | null {
    return typeof error === 'object' &&
        error !== null &&
        'stage' in error &&
        typeof error.stage === 'string'
        ? error.stage
        : null;
}

function sendServerError(
    res: Response,
    publicError: string,
    error: unknown,
    options: { includeDetails?: boolean } = {}
): void {
    const body: {
        error: string;
        message?: string;
        stage?: string | null;
    } = {
        error: publicError,
    };

    if (options.includeDetails) {
        body.message = error instanceof Error ? error.message : String(error);
        body.stage = getErrorStage(error);
    }

    res.status(500).json(body);
}

function formatLogError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function logServerError(message: string, error: unknown): void {
    console.error(`${message} ${formatLogError(error)}`);
}

function formatUrlHost(host: string): string {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function getBrowserUrl(host: string, port: number): string {
    const browserHost =
        host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    return `http://${formatUrlHost(browserHost)}:${port}`;
}

function getListenUrl(host: string, port: number): string {
    return `http://${formatUrlHost(host)}:${port}`;
}

app.use((req, _res, next) => {
    console.log(`[server] ${req.method} ${req.url}`);
    next();
});

app.use(express.json());
app.use(express.static(clientDir));

app.get('/api/library', async (req, res) => {
    try {
        const includeAll = req.query.includeAll === 'true';
        const groups = await scanWiiUTitleRoots(romRoots, { includeAll });

        res.json({
            groups,
        });
    } catch (error) {
        logServerError('[server] Failed to scan library:', error);
        sendServerError(res, 'Failed to scan library', error);
    }
});

app.get('/api/library/validate', async (_req, res) => {
    try {
        const titles = await validateWiiUTitleRoots(romRoots);
        const failed = titles.filter((title) => title.status !== 'ok').length;

        res.json({
            status: failed === 0 ? 'ok' : 'failed',
            total: titles.length,
            failed,
            titles,
        });
    } catch (error) {
        logServerError('[server] Failed to validate library:', error);
        sendServerError(res, 'Failed to validate library', error, {
            includeDetails: true,
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
        logServerError('[server] Failed to load title icon:', error);
        sendServerError(res, 'Failed to load title icon', error);
    }
});

app.get('/api/title-metadata', async (req, res) => {
    const titleId = requireTitleIdQuery(req, res);
    if (!titleId) {
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
        logServerError('[server] Failed to download title metadata:', error);
        sendServerError(res, 'Failed to download title metadata', error, {
            includeDetails: true,
        });
    }
});

app.get('/api/title-all', async (req, res) => {
    const titleId = requireTitleIdQuery(req, res);
    if (!titleId) {
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
        logServerError('[server] Failed to load full title metadata:', error);
        sendServerError(res, 'Failed to load full title metadata', error, {
            includeDetails: true,
        });
    }
});

app.get('/api/title-download', async (req, res) => {
    const titleId = requireTitleIdQuery(req, res);
    if (!titleId) {
        return;
    }

    try {
        const romRoot = await findFirstReadableWiiURoot(romRoots);
        res.json(await generateTitleInstallFiles(titleId, romRoot));
    } catch (error) {
        logServerError('[server] Failed to download title:', error);
        sendServerError(res, 'Failed to download title', error, {
            includeDetails: true,
        });
    }
});

app.get('/api/title-update', async (req, res) => {
    const titleId = requireTitleIdQuery(req, res);
    if (!titleId) {
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
        logServerError('[server] Failed to load title update metadata:', error);
        sendServerError(res, 'Failed to load title update metadata', error, {
            includeDetails: true,
        });
    }
});

app.get('/api/title-dlc', async (req, res) => {
    const titleId = requireTitleIdQuery(req, res);
    if (!titleId) {
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
        logServerError('[server] Failed to load title DLC metadata:', error);
        sendServerError(res, 'Failed to load title DLC metadata', error, {
            includeDetails: true,
        });
    }
});

const server = createServer(app);

server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
        `[server] Failed to listen at ${getListenUrl(host, port)}: ${error.message}`
    );
    process.exit(1);
});

server.on('listening', () => {
    console.log(`[server] Listening at ${getListenUrl(host, port)}`);

    if (config.openBrowser) {
        const url = getBrowserUrl(host, port);
        console.log(`[server] Opening browser at ${url}`);
        void open(url).catch((error: unknown) => {
            console.warn('[server] Failed to open browser:', error);
        });
    }
});

server.listen(port, host);
