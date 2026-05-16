import { Router } from 'express';

import { sendServerError } from '../routes.js';
import { broadcastAppSocketEvent } from '../socket.js';
import { scanWiiUTitleRoots, validateWiiUTitleRoots } from '../wiiu.js';
import {
    type LibraryResponse,
    type LibraryValidationResponse,
} from '../../shared/api.js';
import { getConfig } from '../../shared/config.js';
import logger from '../../shared/logger.js';
import { formatLogError } from '../../shared/shared.js';
import {
    SOCKET_COMMAND,
    type LibraryValidationSocketCommand,
    type ValidationStatusEvent,
} from '../../shared/socket.js';
import { setLibraryCacheGroups } from '../../shared/wiiu.js';

let latestLibraryValidationStatus: ValidationStatusEvent | null = null;
let activeLibraryValidationAbortController: AbortController | null = null;

export function getLatestLibraryValidationStatus(): ValidationStatusEvent | null {
    return latestLibraryValidationStatus;
}

function broadcastLibraryValidationStatus(event: ValidationStatusEvent): void {
    latestLibraryValidationStatus = event;
    broadcastAppSocketEvent(event);
}

export function createLibraryRouter(): Router {
    const router = Router();

    router.get('/', async (req, res) => {
        try {
            const includeAll = req.query.includeAll === 'true';
            const groups = await scanWiiUTitleRoots(getConfig().wiiuRoots, {
                includeAll,
            });

            setLibraryCacheGroups(groups);
            const response: LibraryResponse = {
                groups,
            };
            res.json(response);
        } catch (error) {
            logger.warn(
                'server',
                `Failed to scan library: ${formatLogError(error)}`
            );
            sendServerError(res, 'Failed to scan library', error);
        }
    });

    router.get('/validate', async (_req, res) => {
        const abortController = new AbortController();
        activeLibraryValidationAbortController = abortController;

        try {
            broadcastLibraryValidationStatus({
                type: 'library.validationStatus',
                status: 'started',
            });

            const titles = await validateWiiUTitleRoots(
                getConfig().wiiuRoots,
                (progress) => {
                    broadcastLibraryValidationStatus({
                        type: 'library.validationStatus',
                        ...progress,
                    });
                },
                abortController.signal
            );
            const failed = titles.filter(
                (title) => title.status !== 'ok'
            ).length;

            broadcastLibraryValidationStatus({
                type: 'library.validationStatus',
                status: 'complete',
                total: titles.length,
                failed,
            });

            const response: LibraryValidationResponse = {
                status: failed === 0 ? 'ok' : 'failed',
                total: titles.length,
                failed,
                titles,
            };
            res.json(response);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            broadcastLibraryValidationStatus({
                type: 'library.validationStatus',
                status: 'failed',
                error: message,
            });

            logger.warn(
                'server',
                `Failed to validate library: ${formatLogError(error)}`
            );
            sendServerError(res, 'Failed to validate library', error, {
                includeDetails: true,
            });
        } finally {
            if (activeLibraryValidationAbortController === abortController) {
                activeLibraryValidationAbortController = null;
            }
        }
    });

    return router;
}

export function handleLibraryValidationSocketCommand(
    command: LibraryValidationSocketCommand
): void {
    switch (command.type) {
        case SOCKET_COMMAND.libraryValidationCancel:
            activeLibraryValidationAbortController?.abort();
            return;
    }
}
