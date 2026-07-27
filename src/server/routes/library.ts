import { Router } from 'express';

import { getLibraryCacheEntry } from '../library.js';
import { requireWiiUTitleQuery, sendServerError } from '../request.js';
import {
    queueLibraryScan,
    queueLibraryOrganize,
    queueLibraryConversion,
    previewLibraryOrganization,
    verifyLibrary,
} from '../actions/library.js';
import logger from '../../shared/logger.js';
import { formatLogError } from '../../shared/utils.js';

export function createLibraryRouter(): Router {
    const router = Router();

    router.get('/', (req, res) => {
        const item = queueLibraryScan(req.query.clearScanCache === '1');
        res.json({
            scanId: item.id,
            item,
        });
    });

    router.get('/verify', async (_req, res) => {
        try {
            res.json(await verifyLibrary());
        } catch (error) {
            const message = formatLogError(error);
            if (message === 'Library verification already in progress') {
                res.status(409).json({ error: message });
                return;
            }
            logger.warn(
                'server',
                `Failed to verify library: ${formatLogError(error)}`
            );
            sendServerError(res, 'Failed to verify library', error, {
                includeDetails: true,
            });
        }
    });

    router.post('/organize', (_req, res) => {
        const item = queueLibraryOrganize();
        res.json({ organizeId: item.id, item });
    });

    router.get('/organize', async (_req, res) => {
        try {
            res.json(await previewLibraryOrganization());
        } catch (error) {
            logger.warn(
                'server',
                `Failed to preview library organization: ${formatLogError(error)}`
            );
            sendServerError(
                res,
                'Failed to preview library organization',
                error,
                {
                    includeDetails: true,
                }
            );
        }
    });

    router.get('/convert', (req, res) => {
        const title = requireWiiUTitleQuery(req, res);
        if (title === null) {
            return;
        }
        const cached = getLibraryCacheEntry(title.titleId);
        const item = queueLibraryConversion({
            titleId: title.titleId,
            name: cached?.name ?? null,
            kind: title.kind,
            version: cached?.version ?? null,
        });
        res.status(202).json({ conversionId: item.id, item });
    });

    return router;
}
