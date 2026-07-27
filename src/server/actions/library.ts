import { randomUUID } from 'node:crypto';
import { mkdir, rename, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { broadcastAppSocketEvent } from '../socket.js';
import {
    clearTitleScanCache,
    getAllTitleScanCacheEntries,
    logTitleVerificationCompleted,
    logTitleVerificationStarted,
    replaceTitleScanCacheSourcePath,
    setLibraryCacheGroups,
    type PreparedTitleVerification,
    type LibraryCacheTitleEntry,
} from '../library.js';
import {
    findMissingExpectedWiiUVerifications,
    findWudImagePaths,
    prepareWiiUTitleVerifications,
    scanWiiUTitleRoots,
    verifyPreparedWiiUTitle,
} from '../platforms/wiiu.js';
import {
    prepareGameCubeTitleVerifications,
    scanGameCubeTitleRoots,
    verifyPreparedGameCubeTitle,
} from '../platforms/gamecube.js';
import {
    prepareWiiTitleVerifications,
    scanWiiTitleRoots,
    verifyPreparedWiiTitle,
} from '../platforms/wii.js';
import {
    prepareThreeDSTitleVerifications,
    scanThreeDSTitleRoots,
    verifyPreparedThreeDSTitle,
} from '../platforms/3ds.js';
import { convertWudImages } from '../platforms/wiiu.js';
import {
    abortAndClearTitleValidations,
    markTitleCopiesValidating,
    revalidateTitleCopies,
} from './titles.js';
import { cacheGameTdbMediaForGroups } from '../gametdb.js';
import {
    type LibraryVerifyProgress,
    type LibraryVerifyResponse,
    type LibraryOrganizePreviewResponse,
} from '../../shared/api.js';
import { getConfig } from '../routes/config.js';
import logger from '../../shared/logger.js';
import { isTerminalActionState } from '../../shared/action.js';
import { formatLogError, safeDirectoryName } from '../../shared/utils.js';
import { isFileNotFoundError } from '../../shared/file.js';
import {
    getTitlePlatformKey,
    TITLE_PLATFORM_IDS,
    TitleKinds,
    type TitleGroup,
    type TitleIdentity,
} from '../../shared/titles.js';
import {
    LIBRARY_CONVERT_SOCKET_COMMAND,
    LIBRARY_CONVERT_SOCKET_EVENT,
    LIBRARY_SCAN_SOCKET_COMMAND,
    LIBRARY_SCAN_SOCKET_EVENT,
    LIBRARY_ORGANIZE_SOCKET_COMMAND,
    LIBRARY_ORGANIZE_SOCKET_EVENT,
    LIBRARY_VERIFY_SOCKET_COMMAND,
    LIBRARY_VERIFY_SOCKET_EVENT,
    type LibraryConvertSocketCommand,
    type LibraryConvertItem,
    type LibraryScanItem,
    type LibraryScanSocketCommand,
    type LibraryOrganizeItem,
    type LibraryOrganizeSocketCommand,
    type LibraryVerifySocketCommand,
    type LibraryVerifyEvent,
} from '../../shared/socket.js';

type LibraryOrganizePlan = {
    root: string;
    source: string;
    destination: string;
    platform: TitleIdentity['platform'];
    titleKey: string;
};
type PreparedLibraryOrganization = {
    pending: LibraryOrganizePlan[];
    pendingTitleKeys: Set<string>;
    unchangedTitles: number;
    conflicts: string[];
};

function planLibraryEntryOrganize(
    root: string,
    entry: LibraryCacheTitleEntry
): LibraryOrganizePlan[] {
    const name = safeDirectoryName(entry.name);
    const extension = path.extname(entry.sourcePath).toLowerCase();
    const titleKey = `${entry.platform}\0${entry.sourcePath}`;
    const plan = (
        source: string,
        destination: string
    ): LibraryOrganizePlan => ({
        root,
        source,
        destination,
        platform: entry.platform,
        titleKey,
    });

    switch (entry.platform) {
        case '3ds': {
            const id = safeDirectoryName(entry.titleId);
            const label = `${name} [${id}]`;
            return [
                plan(
                    entry.sourcePath,
                    path.join(root, label, `${label}${extension}`)
                ),
            ];
        }
        case 'gamecube':
            return [
                plan(
                    entry.sourcePath,
                    path.join(
                        root,
                        `${name} [${entry.titleId}]`,
                        `game${extension}`
                    )
                ),
            ];
        case 'wii': {
            const sources = [
                entry.sourcePath,
                ...(entry.extraSourcePaths ?? []),
            ];
            return sources.map((source, index) =>
                plan(
                    source,
                    path.join(
                        root,
                        `${name} [${entry.titleId}]`,
                        `${entry.titleId}${index === 0 ? extension : path.extname(source).toLowerCase()}`
                    )
                )
            );
        }
        case 'wiiu':
            return [
                plan(
                    entry.sourcePath,
                    path.join(
                        root,
                        `${name}${entry.kind === TitleKinds.Base ? '' : ` [${entry.kind}]`} [${entry.titleId}]`
                    )
                ),
            ];
    }
}

function formatLibraryOrganizePath(plan: LibraryOrganizePlan): string {
    const relative = path.relative(plan.root, plan.destination);
    return path.posix.join('<romroot>', ...relative.split(path.sep));
}

async function removeEmptyLibrarySourceParents(
    plans: LibraryOrganizePlan[]
): Promise<void> {
    const roots = getAllTitleScanCacheEntries().map(({ root }) =>
        path.resolve(root)
    );
    const parents = new Set(
        plans.map((plan) => path.resolve(path.dirname(plan.source)))
    );

    for (const initialParent of parents) {
        let parent = initialParent;
        while (!roots.includes(parent)) {
            try {
                await rmdir(parent);
            } catch {
                break;
            }
            parent = path.dirname(parent);
        }
    }
}

async function prepareLibraryOrganization(): Promise<PreparedLibraryOrganization> {
    const plans = getAllTitleScanCacheEntries().flatMap(({ root, entry }) =>
        planLibraryEntryOrganize(root, entry)
    );
    const pending = plans.filter(
        (plan) => path.resolve(plan.source) !== path.resolve(plan.destination)
    );
    const allTitleKeys = new Set(plans.map((plan) => plan.titleKey));
    const pendingTitleKeys = new Set(pending.map((plan) => plan.titleKey));
    const unchangedTitles = allTitleKeys.size - pendingTitleKeys.size;
    const destinations = new Set<string>();
    const conflicts: string[] = [];

    for (const plan of pending) {
        const destination = path.resolve(plan.destination);
        let destinationExists = false;
        try {
            await stat(destination);
            destinationExists = true;
        } catch (error) {
            if (!isFileNotFoundError(error)) {
                throw error;
            }
        }
        if (destinations.has(destination) || destinationExists) {
            conflicts.push(formatLibraryOrganizePath(plan));
        }
        destinations.add(destination);
    }
    if (conflicts.length > 0) {
        return { pending, pendingTitleKeys, unchangedTitles, conflicts };
    }

    return { pending, pendingTitleKeys, unchangedTitles, conflicts: [] };
}

export async function previewLibraryOrganization(): Promise<LibraryOrganizePreviewResponse> {
    const prepared = await prepareLibraryOrganization();
    return {
        titlesToOrganize: prepared.pendingTitleKeys.size,
        unchangedTitles: prepared.unchangedTitles,
        conflicts: prepared.conflicts,
    };
}

export async function organizeLibraryTitles(
    signal?: AbortSignal,
    onProgress?: (progress: {
        totalPlatforms: number;
        completedPlatforms: number;
        totalTitles: number;
        organizedTitles: number;
        unchangedTitles: number;
    }) => void
): Promise<{
    organizedTitles: number;
    unchangedTitles: number;
    conflicts: string[];
}> {
    const { pending, pendingTitleKeys, unchangedTitles, conflicts } =
        await prepareLibraryOrganization();
    const remainingByPlatform = new Map(
        TITLE_PLATFORM_IDS.map((platform) => [
            platform,
            pending.filter((plan) => plan.platform === platform).length,
        ])
    );
    const remainingByTitle = new Map(
        [...pendingTitleKeys].map((titleKey) => [
            titleKey,
            pending.filter((plan) => plan.titleKey === titleKey).length,
        ])
    );
    let completedPlatforms = [...remainingByPlatform.values()].filter(
        (remaining) => remaining === 0
    ).length;
    let organizedTitles = 0;
    const reportProgress = () =>
        onProgress?.({
            totalPlatforms: TITLE_PLATFORM_IDS.length,
            completedPlatforms,
            totalTitles: pendingTitleKeys.size,
            organizedTitles,
            unchangedTitles,
        });
    reportProgress();
    if (conflicts.length > 0) {
        return { organizedTitles: 0, unchangedTitles, conflicts };
    }

    for (const plan of pending) {
        signal?.throwIfAborted();

        await mkdir(path.dirname(plan.destination), { recursive: true });
        await rename(plan.source, plan.destination);
        replaceTitleScanCacheSourcePath(plan.source, plan.destination);

        const remainingTitle = (remainingByTitle.get(plan.titleKey) ?? 1) - 1;
        remainingByTitle.set(plan.titleKey, remainingTitle);
        if (remainingTitle === 0) {
            organizedTitles += 1;
        }
        const remainingPlatform =
            (remainingByPlatform.get(plan.platform) ?? 1) - 1;
        remainingByPlatform.set(plan.platform, remainingPlatform);
        if (remainingPlatform === 0) {
            completedPlatforms += 1;
        }
        reportProgress();
    }
    await removeEmptyLibrarySourceParents(pending);

    return { organizedTitles, unchangedTitles, conflicts: [] };
}

let latestLibraryVerifyEvent: LibraryVerifyEvent | null = null;
const libraryVerifyFailures = new Map<string, LibraryVerifyEvent>();
let activeLibraryVerifyAbortController: AbortController | null = null;
type PendingLibraryTitleVerification = {
    platform: TitleIdentity['platform'];
    titleId: string;
    resolve: () => void;
};
const pendingLibraryTitleVerifications: PendingLibraryTitleVerification[] = [];
let libraryVerifyEventTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLibraryVerifyEvent: LibraryVerifyEvent | null = null;
let libraryVerifyProgressPlatform: LibraryVerifyProgress['platform'] | null =
    null;
let libraryConversions: LibraryConvertItem[] = [];
let activeLibraryConvertId: string | null = null;
let activeLibraryConvertAbortController: AbortController | null = null;
let activeLibraryConvertSourcePaths = new Map<string, Set<string>>();
let libraryScans: LibraryScanItem[] = [];
let libraryOrganizeItems: LibraryOrganizeItem[] = [];
let activeLibraryOrganizeAbortController: AbortController | null = null;

export function getLibraryVerifyEvents(): LibraryVerifyEvent[] {
    return [
        ...(latestLibraryVerifyEvent ? [latestLibraryVerifyEvent] : []),
        ...libraryVerifyFailures.values(),
    ];
}

export function getLibraryConversions(): LibraryConvertItem[] {
    return libraryConversions;
}

export function getLibraryScans(): LibraryScanItem[] {
    return libraryScans;
}

export function getLibraryOrganizeItems(): LibraryOrganizeItem[] {
    return libraryOrganizeItems;
}

function broadcastLibraryOrganizeItems(): void {
    broadcastAppSocketEvent({
        type: LIBRARY_ORGANIZE_SOCKET_EVENT.changed,
        items: libraryOrganizeItems,
    });
}

export function queueLibraryOrganize(): LibraryOrganizeItem {
    const active = libraryOrganizeItems.find(
        (item) => item.state === 'queued' || item.state === 'in-progress'
    );
    if (active) {
        return active;
    }

    const item: LibraryOrganizeItem = {
        id: randomUUID(),
        state: 'queued',
        totalPlatforms: TITLE_PLATFORM_IDS.length,
        completedPlatforms: 0,
        totalTitles: 0,
        organizedTitles: 0,
        unchangedTitles: 0,
        message: 'Organize queued.',
        error: null,
    };
    libraryOrganizeItems = [item];
    broadcastLibraryOrganizeItems();
    void processLibraryOrganize(item);
    return item;
}

async function processLibraryOrganize(
    item: LibraryOrganizeItem
): Promise<void> {
    if (activeLibraryOrganizeAbortController) {
        return;
    }
    const abortController = new AbortController();
    activeLibraryOrganizeAbortController = abortController;
    item.state = 'in-progress';
    item.message = 'Preparing library organization...';
    item.error = null;
    broadcastLibraryOrganizeItems();

    try {
        const result = await organizeLibraryTitles(
            abortController.signal,
            (progress) => {
                item.totalPlatforms = progress.totalPlatforms;
                item.completedPlatforms = progress.completedPlatforms;
                item.totalTitles = progress.totalTitles;
                item.organizedTitles = progress.organizedTitles;
                item.unchangedTitles = progress.unchangedTitles;
                item.message = 'Organizing library...';
                broadcastLibraryOrganizeItems();
            }
        );
        if (result.conflicts.length > 0) {
            item.state = 'failed';
            item.error = `Organize blocked by ${result.conflicts.length} existing destination(s):\n${result.conflicts.join('\n')}`;
            item.message = 'Organize blocked.';
        } else {
            item.state = 'complete';
            item.completedPlatforms = item.totalPlatforms;
            item.organizedTitles = result.organizedTitles;
            item.unchangedTitles = result.unchangedTitles;
            item.message = `${result.organizedTitles} organized; ${result.unchangedTitles} already matched.`;
        }
    } catch (error) {
        if (abortController.signal.aborted) {
            item.state = 'cancelled';
            item.message = 'Organize cancelled.';
            item.error = null;
        } else {
            item.state = 'failed';
            item.error = formatLogError(error);
        }
    } finally {
        activeLibraryOrganizeAbortController = null;
        broadcastLibraryOrganizeItems();
    }
}

export function handleLibraryOrganizeSocketCommand(
    command: LibraryOrganizeSocketCommand
): void {
    const item = libraryOrganizeItems.find(
        (candidate) => candidate.id === command.id
    );
    if (!item) {
        return;
    }

    switch (command.type) {
        case LIBRARY_ORGANIZE_SOCKET_COMMAND.cancel:
            if (item.state === 'queued' || item.state === 'in-progress') {
                activeLibraryOrganizeAbortController?.abort();
            }
            return;
        case LIBRARY_ORGANIZE_SOCKET_COMMAND.clear:
            if (isTerminalActionState(item.state)) {
                libraryOrganizeItems = libraryOrganizeItems.filter(
                    (candidate) => candidate.id !== item.id
                );
                broadcastLibraryOrganizeItems();
            }
            return;
        case LIBRARY_ORGANIZE_SOCKET_COMMAND.retry:
            if (item.state === 'failed' || item.state === 'cancelled') {
                item.state = 'queued';
                item.totalPlatforms = TITLE_PLATFORM_IDS.length;
                item.completedPlatforms = 0;
                item.totalTitles = 0;
                item.organizedTitles = 0;
                item.unchangedTitles = 0;
                item.message = 'Organize queued.';
                item.error = null;
                broadcastLibraryOrganizeItems();
                void processLibraryOrganize(item);
            }
    }
}

function broadcastLibraryScans(): void {
    broadcastAppSocketEvent({
        type: LIBRARY_SCAN_SOCKET_EVENT.changed,
        items: libraryScans,
    });
}

export function queueLibraryScan(clearScanCache = false): LibraryScanItem {
    const active = libraryScans.find(
        (item) => item.state === 'queued' || item.state === 'in-progress'
    );
    if (active) {
        return active;
    }

    const item: LibraryScanItem = {
        id: randomUUID(),
        state: 'queued',
        current: 0,
        total: 4,
        titleCount: null,
        groups: null,
        error: null,
    };
    libraryScans = [item];
    broadcastLibraryScans();
    void processLibraryScan(item, clearScanCache);
    return item;
}

async function processLibraryScan(
    item: LibraryScanItem,
    clearScanCache: boolean
): Promise<void> {
    item.state = 'in-progress';
    broadcastLibraryScans();

    try {
        if (clearScanCache) {
            clearTitleScanCache();
            logger.log('server', 'library scan cache cleared');
        }
        try {
            abortAndClearTitleValidations();
        } catch (error) {
            logger.warn(
                'server',
                `Failed to clear title verification cache: ${formatLogError(error)}`
            );
        }
        const config = getConfig();
        const scan = async (operation: Promise<TitleGroup[]>) => {
            const groups = await operation;
            item.current += 1;
            broadcastLibraryScans();
            return groups;
        };
        const [threeDSGroups, gameCubeGroups, wiiuGroups, wiiGroups] =
            await Promise.all([
                scan(scanThreeDSTitleRoots(config['3dsRoots'])),
                scan(scanGameCubeTitleRoots(config.gamecubeRoots)),
                scan(scanWiiUTitleRoots(config.wiiuRoots)),
                scan(scanWiiTitleRoots(config.wiiRoots)),
            ]);
        const groups = [
            ...threeDSGroups,
            ...gameCubeGroups,
            ...wiiuGroups,
            ...wiiGroups,
        ].sort((a, b) => a.name.localeCompare(b.name));
        setLibraryCacheGroups(groups);
        item.state = 'complete';
        item.titleCount = groups.length;
        item.groups = groups;
        broadcastLibraryScans();
        cacheGameTdbMediaForGroups(groups);
        logger.log(
            'server',
            `library scan complete: ${groups.length} title group(s)`
        );
    } catch (error) {
        item.state = 'failed';
        item.error = formatLogError(error);
        broadcastLibraryScans();
        logger.warn('server', `Failed to scan library: ${item.error}`);
    }
}

export function handleLibraryScanSocketCommand(
    command: LibraryScanSocketCommand
): void {
    if (command.type !== LIBRARY_SCAN_SOCKET_COMMAND.clear) {
        return;
    }
    libraryScans = libraryScans.filter(
        (item) =>
            item.id !== command.id ||
            item.state === 'queued' ||
            item.state === 'in-progress'
    );
    broadcastLibraryScans();
}

function broadcastLibraryVerifyEvent(event: LibraryVerifyEvent): void {
    clearScheduledLibraryVerifyEvent();
    latestLibraryVerifyEvent = event;
    broadcastAppSocketEvent(event);
}

function scheduleLibraryVerifyEvent(event: LibraryVerifyEvent): void {
    pendingLibraryVerifyEvent = event;
    if (libraryVerifyEventTimer !== null) {
        return;
    }
    libraryVerifyEventTimer = setTimeout(() => {
        libraryVerifyEventTimer = null;
        if (!pendingLibraryVerifyEvent) {
            return;
        }
        const nextEvent = pendingLibraryVerifyEvent;
        pendingLibraryVerifyEvent = null;
        latestLibraryVerifyEvent = nextEvent;
        broadcastAppSocketEvent(nextEvent);
    }, 200);
}

function clearScheduledLibraryVerifyEvent(): void {
    if (libraryVerifyEventTimer !== null) {
        clearTimeout(libraryVerifyEventTimer);
        libraryVerifyEventTimer = null;
    }
    pendingLibraryVerifyEvent = null;
}

function getLibraryVerifyProgressCounts(): {
    current: number;
    total: number;
} {
    const event = pendingLibraryVerifyEvent ?? latestLibraryVerifyEvent;
    return event?.state === 'in-progress' && 'titleId' in event
        ? { current: event.current, total: event.total }
        : { current: 0, total: 0 };
}

function handleLibraryVerifyProgress(progress: LibraryVerifyProgress): void {
    const platformChanged = libraryVerifyProgressPlatform !== progress.platform;
    if (platformChanged) {
        libraryVerifyProgressPlatform = progress.platform;
    }
    const event: LibraryVerifyEvent = {
        type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
        state: 'in-progress',
        ...progress,
    };
    if (progress.result === 'failed') {
        clearScheduledLibraryVerifyEvent();
        libraryVerifyFailures.set(
            getTitlePlatformKey(progress.platform, progress.titleId),
            event
        );
        broadcastAppSocketEvent(event);
    } else if (platformChanged) {
        broadcastLibraryVerifyEvent(event);
    } else {
        scheduleLibraryVerifyEvent(event);
    }
}

function broadcastLibraryConversions(): void {
    broadcastAppSocketEvent({
        type: LIBRARY_CONVERT_SOCKET_EVENT.changed,
        items: libraryConversions,
    });
}

export async function verifyLibrary(): Promise<LibraryVerifyResponse> {
    if (activeLibraryVerifyAbortController) {
        throw new Error('Library verification already in progress');
    }
    const abortController = new AbortController();
    activeLibraryVerifyAbortController = abortController;
    try {
        broadcastLibraryVerifyEvent({
            type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
            state: 'in-progress',
            reset: true,
        });
        libraryVerifyFailures.clear();
        libraryVerifyProgressPlatform = null;
        const config = getConfig();
        const prepared = (
            await Promise.all([
                prepareThreeDSTitleVerifications(
                    config['3dsRoots'],
                    abortController.signal
                ),
                prepareGameCubeTitleVerifications(
                    config.gamecubeRoots,
                    abortController.signal
                ),
                prepareWiiTitleVerifications(
                    config.wiiRoots,
                    abortController.signal
                ),
                prepareWiiUTitleVerifications(
                    config.wiiuRoots,
                    abortController.signal
                ),
            ])
        )
            .flat()
            .sort((a, b) => {
                const options: Intl.CollatorOptions = {
                    sensitivity: 'base',
                };
                return (
                    a.name.localeCompare(b.name, undefined, options) ||
                    (a.region ?? '').localeCompare(
                        b.region ?? '',
                        undefined,
                        options
                    ) ||
                    a.directory.localeCompare(b.directory, undefined, options)
                );
            });
        const titles = await verifyPreparedLibraryTitles(
            prepared,
            abortController.signal,
            runPendingLibraryTitleVerifications
        );
        titles.push(
            ...(await findMissingExpectedWiiUVerifications(
                config.wiiuRoots,
                titles
            ))
        );
        const failed = titles.filter((title) => title.status !== 'ok').length;
        clearTitleScanCache();
        broadcastLibraryVerifyEvent({
            type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
            state: 'complete',
            total: titles.length,
            failed,
        });
        return {
            status: failed === 0 ? 'ok' : 'failed',
            total: titles.length,
            failed,
            titles,
        };
    } catch (error) {
        if (abortController.signal.aborted) {
            const progress = getLibraryVerifyProgressCounts();
            broadcastLibraryVerifyEvent({
                type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
                state: 'cancelled',
                ...progress,
            });
            return { status: 'cancelled', total: 0, failed: 0, titles: [] };
        }
        broadcastLibraryVerifyEvent({
            type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
            state: 'failed',
            error: formatLogError(error),
        });
        throw error;
    } finally {
        if (activeLibraryVerifyAbortController === abortController) {
            activeLibraryVerifyAbortController = null;
        }
        void processPendingLibraryTitleVerifications();
    }
}

export async function verifyLibraryTitle(
    platform: TitleIdentity['platform'],
    titleId: string
): Promise<void> {
    if (activeLibraryVerifyAbortController) {
        return new Promise((resolve) => {
            pendingLibraryTitleVerifications.push({
                platform,
                titleId,
                resolve,
            });
        });
    }

    await runStandaloneLibraryTitleVerification(platform, titleId);
}

async function runStandaloneLibraryTitleVerification(
    platform: TitleIdentity['platform'],
    titleId: string
): Promise<void> {
    const abortController = new AbortController();
    activeLibraryVerifyAbortController = abortController;
    try {
        broadcastLibraryVerifyEvent({
            type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
            state: 'in-progress',
            reset: true,
        });
        libraryVerifyProgressPlatform = null;

        await runLibraryTitleVerification(
            platform,
            titleId,
            abortController.signal,
            true
        );
    } catch (error) {
        if (abortController.signal.aborted) {
            const progress = getLibraryVerifyProgressCounts();
            broadcastLibraryVerifyEvent({
                type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
                state: 'cancelled',
                ...progress,
            });
            return;
        }
        broadcastLibraryVerifyEvent({
            type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
            state: 'failed',
            error: formatLogError(error),
        });
        logger.warn(
            'server',
            `Copied title verification failed: ${formatLogError(error)}`
        );
    } finally {
        if (activeLibraryVerifyAbortController === abortController) {
            activeLibraryVerifyAbortController = null;
        }
        void processPendingLibraryTitleVerifications();
    }
}

async function runLibraryTitleVerification(
    platform: TitleIdentity['platform'],
    titleId: string,
    signal: AbortSignal,
    broadcastCompletion: boolean
): Promise<void> {
    const prepared = (
        await preparePlatformTitleVerifications(platform, signal)
    ).filter((item) => item.titleId === titleId);
    const titles = await verifyPreparedLibraryTitles(prepared, signal);

    if (broadcastCompletion) {
        broadcastLibraryVerifyEvent({
            type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
            state: 'complete',
            total: prepared.length,
            failed: titles.filter((title) => title.status !== 'ok').length,
        });
    }
}

async function runPendingLibraryTitleVerifications(): Promise<void> {
    while (pendingLibraryTitleVerifications.length > 0) {
        const pending = pendingLibraryTitleVerifications.shift();
        if (!pending) {
            return;
        }
        try {
            await runLibraryTitleVerification(
                pending.platform,
                pending.titleId,
                new AbortController().signal,
                false
            );
        } catch (error) {
            logger.warn(
                'server',
                `Priority title verification failed: ${formatLogError(error)}`
            );
        } finally {
            pending.resolve();
        }
    }
}

async function processPendingLibraryTitleVerifications(): Promise<void> {
    if (
        activeLibraryVerifyAbortController ||
        pendingLibraryTitleVerifications.length === 0
    ) {
        return;
    }

    const pending = pendingLibraryTitleVerifications.shift();
    if (!pending) {
        return;
    }
    try {
        await runStandaloneLibraryTitleVerification(
            pending.platform,
            pending.titleId
        );
    } finally {
        pending.resolve();
    }
}

async function preparePlatformTitleVerifications(
    platform: TitleIdentity['platform'],
    signal: AbortSignal
) {
    const config = getConfig();
    switch (platform) {
        case '3ds':
            return prepareThreeDSTitleVerifications(config['3dsRoots'], signal);
        case 'gamecube':
            return prepareGameCubeTitleVerifications(
                config.gamecubeRoots,
                signal
            );
        case 'wii':
            return prepareWiiTitleVerifications(config.wiiRoots, signal);
        case 'wiiu':
            return prepareWiiUTitleVerifications(config.wiiuRoots, signal);
    }
}

async function verifyPreparedPlatformTitle(
    item: PreparedTitleVerification,
    index: number,
    total: number,
    signal: AbortSignal
) {
    const args = [
        item,
        index,
        total,
        handleLibraryVerifyProgress,
        signal,
    ] as const;
    switch (item.platform) {
        case '3ds':
            return verifyPreparedThreeDSTitle(...args);
        case 'gamecube':
            return verifyPreparedGameCubeTitle(...args);
        case 'wii':
            return verifyPreparedWiiTitle(...args);
        case 'wiiu':
            return verifyPreparedWiiUTitle(...args);
    }
}

async function verifyPreparedLibraryTitles(
    prepared: PreparedTitleVerification[],
    signal: AbortSignal,
    afterEach?: () => Promise<void>
) {
    const titles = [];
    for (const [index, item] of prepared.entries()) {
        signal.throwIfAborted();
        logTitleVerificationStarted({
            logNamespace: item.platform,
            platform: item.platform,
            name: item.name,
            titleId: item.titleId,
            version: item.version,
            sizeText: item.sizeText,
        });
        const verifiedTitles = await verifyPreparedPlatformTitle(
            item,
            index,
            prepared.length,
            signal
        );
        titles.push(...verifiedTitles);
        for (const verifiedTitle of verifiedTitles) {
            logTitleVerificationCompleted({
                logNamespace: item.platform,
                platform: item.platform,
                name: item.name,
                titleId: item.titleId,
                version: item.version,
                status: verifiedTitle.status,
            });
        }
        await afterEach?.();
    }
    return titles;
}

export function queueLibraryConversion(
    input: Pick<LibraryConvertItem, 'titleId' | 'name' | 'kind' | 'version'>
): LibraryConvertItem {
    const item: LibraryConvertItem = {
        id: randomUUID(),
        ...input,
        state: 'queued',
        currentFileName: null,
        current: null,
        total: null,
        currentFileSizeBytes: null,
        converted: null,
        convertedTitles: null,
        error: null,
    };
    libraryConversions = [...libraryConversions, item];
    broadcastLibraryConversions();
    void processLibraryConvertQueue();
    return item;
}

export function handleLibraryConvertSocketCommand(
    command: LibraryConvertSocketCommand
): void {
    switch (command.type) {
        case LIBRARY_CONVERT_SOCKET_COMMAND.cancel:
            cancelLibraryConversion(command.id);
            return;
        case LIBRARY_CONVERT_SOCKET_COMMAND.clear:
            if (
                !libraryConversions.some(
                    (item) =>
                        item.id === command.id &&
                        isTerminalActionState(item.state)
                )
            ) {
                return;
            }
            libraryConversions = libraryConversions.filter(
                (item) => item.id !== command.id
            );
            broadcastLibraryConversions();
            void processLibraryConvertQueue();
            return;
        case LIBRARY_CONVERT_SOCKET_COMMAND.retry: {
            const item = libraryConversions.find(
                (candidate) => candidate.id === command.id
            );
            if (!item || item.state !== 'failed') {
                return;
            }
            const update: Partial<LibraryConvertItem> = {
                state: 'queued',
                currentFileName: null,
                current: null,
                total: null,
                currentFileSizeBytes: null,
                converted: null,
                convertedTitles: null,
                error: null,
            };
            Object.assign(item, update);
            broadcastLibraryConversions();
            void processLibraryConvertQueue();
            return;
        }
    }
}

function cancelLibraryConversion(id: string): void {
    const item = libraryConversions.find((candidate) => candidate.id === id);
    if (!item || (item.state !== 'queued' && item.state !== 'in-progress')) {
        return;
    }

    const isActive = activeLibraryConvertId === id;
    item.state = 'cancelled';
    item.currentFileName = null;
    item.currentFileSizeBytes = null;
    if (isActive) {
        activeLibraryConvertAbortController?.abort();
        clearTitleScanCache();
        markTitleCopiesValidating(
            [...activeLibraryConvertSourcePaths.keys()].map((titleId) => ({
                platform: 'wiiu',
                titleId,
            }))
        );
    }
    broadcastLibraryConversions();
    void processLibraryConvertQueue();
}

async function processLibraryConvertQueue(): Promise<void> {
    if (activeLibraryConvertId) {
        return;
    }

    const item = libraryConversions.find(
        (candidate) => candidate.state === 'queued'
    );
    if (!item) {
        broadcastLibraryConversions();
        return;
    }

    activeLibraryConvertId = item.id;
    const abortController = new AbortController();
    activeLibraryConvertAbortController = abortController;
    activeLibraryConvertSourcePaths = new Map();
    item.state = 'in-progress';
    broadcastLibraryConversions();

    try {
        const result = await convertWudImages(
            await findWudImagePaths(getConfig().wiiuRoots),
            item.titleId,
            {
                onProgress: (progress) => {
                    const sourcePaths =
                        activeLibraryConvertSourcePaths.get(progress.titleId) ??
                        new Set<string>();
                    sourcePaths.add(progress.outputDir);
                    activeLibraryConvertSourcePaths.set(
                        progress.titleId,
                        sourcePaths
                    );
                    if (
                        activeLibraryConvertId !== item.id ||
                        item.state !== 'in-progress'
                    ) {
                        return;
                    }
                    item.currentFileName = progress.currentFileName;
                    item.current = progress.completedFiles;
                    item.total = progress.totalFiles;
                    item.currentFileSizeBytes = progress.currentFileSizeBytes;
                    broadcastLibraryConversions();
                },
                signal: abortController.signal,
            }
        );
        if (
            activeLibraryConvertId !== item.id ||
            abortController.signal.aborted
        ) {
            return;
        }
        clearTitleScanCache();
        item.state = 'complete';
        item.currentFileName = null;
        item.currentFileSizeBytes = null;
        item.current = item.total;
        item.converted = result.converted.reduce(
            (total, image) => total + image.titles.length,
            0
        );
        item.convertedTitles = result.converted.flatMap((image) =>
            image.titles.map((title) => ({
                titleId: title.titleId,
                name: title.name,
                kind: title.kind,
                version: title.titleVersion,
                sizeBytes: title.sizeBytes,
            }))
        );
        broadcastLibraryConversions();
        revalidateTitleCopies(
            result.converted.flatMap((image) =>
                image.titles.map((title) => ({
                    platform: 'wiiu' as const,
                    titleId: title.titleId,
                    sourcePaths: [title.outputDir],
                }))
            )
        );
    } catch (error) {
        if (
            activeLibraryConvertId !== item.id ||
            abortController.signal.aborted
        ) {
            return;
        }
        item.state = 'failed';
        item.error = formatLogError(error);
        logger.warn(
            'server',
            `Failed to convert WUD/WUX library entries: ${formatLogError(error)}`
        );
        broadcastLibraryConversions();
        clearTitleScanCache();
        revalidateTitleCopies(
            [...activeLibraryConvertSourcePaths].map(
                ([titleId, sourcePaths]) => ({
                    platform: 'wiiu' as const,
                    titleId,
                    sourcePaths: [...sourcePaths],
                })
            )
        );
    } finally {
        if (abortController.signal.aborted) {
            clearTitleScanCache();
            revalidateTitleCopies(
                [...activeLibraryConvertSourcePaths].map(
                    ([titleId, sourcePaths]) => ({
                        platform: 'wiiu' as const,
                        titleId,
                        sourcePaths: [...sourcePaths],
                    })
                )
            );
        }
        if (activeLibraryConvertId === item.id) {
            activeLibraryConvertId = null;
            activeLibraryConvertAbortController = null;
            activeLibraryConvertSourcePaths = new Map();
        }
        void processLibraryConvertQueue();
    }
}

export function handleLibraryVerifySocketCommand(
    command: LibraryVerifySocketCommand
): void {
    switch (command.type) {
        case LIBRARY_VERIFY_SOCKET_COMMAND.cancel:
            activeLibraryVerifyAbortController?.abort();
            return;
        case LIBRARY_VERIFY_SOCKET_COMMAND.clear:
            if (command.id === 'main') {
                if (
                    latestLibraryVerifyEvent?.state !== 'in-progress' &&
                    latestLibraryVerifyEvent?.state !== undefined
                ) {
                    latestLibraryVerifyEvent = null;
                }
            } else {
                libraryVerifyFailures.delete(command.id);
            }
            broadcastAppSocketEvent({
                type: LIBRARY_VERIFY_SOCKET_EVENT.changed,
                state: 'cleared',
                id: command.id,
            });
            return;
    }
}
