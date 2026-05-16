import { Router } from 'express';

import {
    downloadNusTitleMetadata,
    generateTitleInstallFiles,
    getDlcMetadata,
    getUpdateMetadata,
    TitleDownloadProgress,
    validateTitleInstallFileSizes,
} from '../metadata.js';
import { sendServerError } from '../routes.js';
import { broadcastAppSocketEvent } from '../socket.js';
import { requireTitleIdQuery } from '../request.js';
import {
    classifyTitleId,
    findFirstReadableWiiURoot,
    findWiiUTitleSourcePaths,
} from '../wiiu.js';
import {
    type TitleDownloadResponse,
    type TitleResponse,
} from '../../shared/api.js';
import { getConfig } from '../../shared/config.js';
import logger from '../../shared/logger.js';
import { resolveReadablePath } from '../../shared/os.js';
import { formatLogError } from '../../shared/shared.js';
import {
    SOCKET_COMMAND,
    type TitleVerifyCopyResult,
    type TitleVerifySocketCommand,
} from '../../shared/socket.js';

const activeTitleVerifications = new Set<string>();

export async function downloadTitle(
    titleId: string,
    onProgress?: (progress: TitleDownloadProgress) => void,
    signal?: AbortSignal
): Promise<TitleDownloadResponse> {
    const romRoot = await findFirstReadableWiiURoot(getConfig().wiiuRoots);

    return generateTitleInstallFiles(titleId, romRoot, {
        onProgress,
        signal,
    });
}

export function createTitleRouter(): Router {
    const router = Router();

    router.get('/', async (req, res) => {
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

            const response: TitleResponse = {
                titleId: metadata.titleId,
                name: metadata.name,
                region: metadata.region,
                productCode: metadata.productCode,
                companyCode: metadata.companyCode,
                baseVersions:
                    metadata.titleVersion === null
                        ? []
                        : [metadata.titleVersion],
                titleKey: metadata.titleKey
                    ? Buffer.from(metadata.titleKey).toString('hex')
                    : null,
                titleKeyPassword: metadata.titleKeyPassword,
                updates:
                    updateMetadata.exists &&
                    updateMetadata.titleVersion !== null
                        ? [updateMetadata.titleVersion]
                        : [],
                dlc:
                    dlcMetadata.exists && dlcMetadata.titleVersion !== null
                        ? [dlcMetadata.titleVersion]
                        : [],
            };
            res.json(response);
        } catch (error) {
            logger.warn(
                'server',
                `Failed to load full title metadata: ${formatLogError(error)}`
            );
            sendServerError(res, 'Failed to load full title metadata', error, {
                includeDetails: true,
            });
        }
    });

    router.get('/download', async (req, res) => {
        const titleId = requireTitleIdQuery(req, res);
        if (!titleId) {
            return;
        }

        try {
            const response: TitleDownloadResponse =
                await downloadTitle(titleId);
            res.json(response);
        } catch (error) {
            logger.warn(
                'server',
                `Failed to download title: ${formatLogError(error)}`
            );
            sendServerError(res, 'Failed to download title', error, {
                includeDetails: true,
            });
        }
    });

    return router;
}

export function handleTitleVerifySocketCommand(
    command: TitleVerifySocketCommand
): void {
    switch (command.type) {
        case SOCKET_COMMAND.titleVerifyQueue:
            void verifyTitleCopies(command.titleId);
            return;
    }
}

async function verifyTitleCopies(titleId: string): Promise<void> {
    const normalizedTitleId = titleId.toLowerCase();
    if (activeTitleVerifications.has(normalizedTitleId)) {
        return;
    }

    activeTitleVerifications.add(normalizedTitleId);
    broadcastAppSocketEvent({
        type: 'title.verify.changed',
        titleId: normalizedTitleId,
        status: 'verifying',
        copies: [],
    });

    try {
        const sourcePaths = await findWiiUTitleSourcePaths(
            getConfig().wiiuRoots,
            normalizedTitleId
        );
        const copies: TitleVerifyCopyResult[] = [];

        for (const sourcePath of sourcePaths) {
            const readableSourcePath = await resolveReadablePath(sourcePath);
            const validation =
                await validateTitleInstallFileSizes(readableSourcePath);
            const verifiedTitleId =
                validation.titleId?.toLowerCase() ?? normalizedTitleId;
            const failedCount = validation.verification.filter(
                (result) => result.status !== 'ok'
            ).length;

            copies.push({
                sourcePath: readableSourcePath,
                titleId: validation.titleId,
                titleKind: classifyTitleId(verifiedTitleId).kind,
                titleVersion: validation.titleVersion,
                status: validation.status,
                failedCount,
                totalCount: validation.verification.length,
                error: validation.error,
            });
        }

        broadcastAppSocketEvent({
            type: 'title.verify.changed',
            titleId: normalizedTitleId,
            status: 'complete',
            copies,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
            'server',
            `Failed to verify title ${normalizedTitleId}: ${formatLogError(error)}`
        );
        broadcastAppSocketEvent({
            type: 'title.verify.changed',
            titleId: normalizedTitleId,
            status: 'failed',
            copies: [],
            error: message,
        });
    } finally {
        activeTitleVerifications.delete(normalizedTitleId);
    }
}
