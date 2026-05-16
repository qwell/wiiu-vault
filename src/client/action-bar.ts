import {
    DOWNLOAD_ACTION,
    type DownloadActionBarCommand,
    isDownloadActionBarCommand,
    type DownloadQueueItem,
} from '../shared/download.js';
import {
    SOCKET_COMMAND,
    type ValidationStatusEvent,
} from '../shared/socket.js';
import { type TitleKinds } from '../shared/titles.js';
import {
    type StorageDeleteItem,
    type StorageActionBarCommand,
    type StorageCopyItem,
    STORAGE_ACTION,
    isStorageActionBarCommand,
} from '../shared/storage.js';
import {
    formatStorageCopyDetails,
    formatStorageCopyFileCount,
    formatStorageCopyIcon,
    formatStorageCopyProgress,
    formatStorageCopySize,
    formatStorageCopyState,
    formatStorageCopyTitle,
    formatStorageDeleteDetails,
    formatStorageDeleteIcon,
    formatStorageDeleteProgress,
    formatStorageDeleteState,
    formatStorageDeleteTitle,
    renderStorageCopyActionRow,
    renderStorageDeleteActionRow,
    cancelStorageCopy,
    clearStorageCopy,
    clearStorageDelete,
    retryStorageCopy,
    retryStorageDelete,
} from './storage.js';

import {
    cancelDownload,
    formatDownloadIcon,
    formatDownloadProgress,
    formatDownloadState,
    formatDownloadTitle,
    getDownloadDedupeKey,
    clearDownload,
    queueDownloads,
    renderDownloadActionRow,
    retryDownload,
} from './download.js';
import { sendAppSocketCommand } from './app-socket.js';
import { formatTitleKind } from './title-detail.js';

export type ActionBarCommand =
    | DownloadActionBarCommand
    | StorageActionBarCommand
    | typeof SOCKET_COMMAND.libraryValidationCancel
    | 'library.validation.clear'
    | 'library.validation.failure.clear'
    | 'library.validation.failure.download';

type ActionBarOptions = {
    downloads: DownloadQueueItem[];
    storageCopies: StorageCopyItem[];
    storageDeletes: StorageDeleteItem[];
    libraryValidation: ValidationStatusEvent | null;
    libraryValidationFailures: ValidationStatusEvent[];
    onCommand: (action: ActionBarCommand, itemId: string) => void;
};

type ActionCommandOptions = {
    downloads: DownloadQueueItem[];
};

let actionBarRoot: HTMLElement | null = null;
let actionBarSignature = '';
let actionBarOptions: ActionBarOptions | null = null;

function isClearableActionBarItem(options: ActionBarOptions): boolean {
    return (
        options.downloads.some((item) => item.state !== 'downloading') ||
        options.storageCopies.some((item) => item.state !== 'copying') ||
        options.storageDeletes.some((item) => item.state !== 'deleting') ||
        options.libraryValidationFailures.length > 0 ||
        (options.libraryValidation !== null &&
            getLibraryValidationActionState(options.libraryValidation) !==
                'validating')
    );
}

function clearAllActionBarItems(options: ActionBarOptions): void {
    for (const item of options.downloads) {
        if (item.state !== 'downloading') {
            options.onCommand(DOWNLOAD_ACTION.clear, item.id);
        }
    }

    for (const item of options.storageCopies) {
        if (item.state !== 'copying') {
            options.onCommand(STORAGE_ACTION.clearCopy, item.id);
        }
    }

    for (const item of options.storageDeletes) {
        if (item.state !== 'deleting') {
            options.onCommand(STORAGE_ACTION.clearDelete, item.id);
        }
    }

    if (
        options.libraryValidation !== null &&
        getLibraryValidationActionState(options.libraryValidation) !==
            'validating'
    ) {
        setLibraryValidationAction(null);
    }

    options.libraryValidationFailures.splice(
        0,
        options.libraryValidationFailures.length
    );
    updateActionBar();
}

function configureActionButton(
    button: HTMLButtonElement,
    action: ActionBarCommand,
    itemId: string
): void {
    button.dataset.action = action;
    button.dataset.itemId = itemId;
}

function getMatchingDownloadIds(
    itemId: string,
    downloads: DownloadQueueItem[]
): string[] {
    const item = downloads.find((candidate) => candidate.id === itemId);

    if (!item) {
        return [itemId];
    }

    const key = getDownloadDedupeKey(item);

    const ids = downloads
        .filter(
            (candidate) =>
                candidate.state !== 'complete' &&
                getDownloadDedupeKey(candidate) === key
        )
        .map((candidate) => candidate.id);

    return ids.length > 0 ? ids : [itemId];
}

function sendDownloadCommandForMatches(
    itemId: string,
    downloads: DownloadQueueItem[],
    send: (id: string) => void
): void {
    for (const id of getMatchingDownloadIds(itemId, downloads)) {
        send(id);
    }
}

export function createActionBarCommandHandler(
    options: ActionCommandOptions
): (action: ActionBarCommand, itemId: string) => void {
    return (action, itemId) => {
        switch (action) {
            case DOWNLOAD_ACTION.cancel:
                sendDownloadCommandForMatches(
                    itemId,
                    options.downloads,
                    cancelDownload
                );
                return;

            case DOWNLOAD_ACTION.clear:
                sendDownloadCommandForMatches(
                    itemId,
                    options.downloads,
                    clearDownload
                );
                return;

            case DOWNLOAD_ACTION.retry:
                sendDownloadCommandForMatches(
                    itemId,
                    options.downloads,
                    retryDownload
                );
                return;

            case STORAGE_ACTION.cancelCopy:
                cancelStorageCopy(itemId);
                return;

            case STORAGE_ACTION.clearCopy:
                clearStorageCopy(itemId);
                return;

            case STORAGE_ACTION.retryCopy:
                retryStorageCopy(itemId);
                return;

            case STORAGE_ACTION.clearDelete:
                clearStorageDelete(itemId);
                return;

            case STORAGE_ACTION.retryDelete:
                retryStorageDelete(itemId);
                return;

            case SOCKET_COMMAND.libraryValidationCancel:
                sendAppSocketCommand({
                    type: SOCKET_COMMAND.libraryValidationCancel,
                });
                return;

            case 'library.validation.clear':
                setLibraryValidationAction(null);
                return;

            case 'library.validation.failure.clear':
                clearLibraryValidationFailure(itemId);
                return;

            case 'library.validation.failure.download':
                queueLibraryValidationFailureDownload(
                    options.downloads,
                    itemId
                );
                return;
        }
    };
}

function isActionBarCommand(value: string | null): value is ActionBarCommand {
    return (
        isDownloadActionBarCommand(value) ||
        isStorageActionBarCommand(value) ||
        value === SOCKET_COMMAND.libraryValidationCancel ||
        value === 'library.validation.clear' ||
        value === 'library.validation.failure.clear' ||
        value === 'library.validation.failure.download'
    );
}

function getActionBarSignature(options: ActionBarOptions): string {
    return JSON.stringify({
        downloads: options.downloads.map((item) => ({
            id: item.id,
            state: item.state,
        })),
        copies: options.storageCopies.map((item) => ({
            id: item.id,
            state: item.state,
        })),
        deletes: options.storageDeletes.map((item) => ({
            id: item.id,
            state: item.state,
        })),
        libraryValidation: options.libraryValidation
            ? {
                  status: getLibraryValidationActionState(
                      options.libraryValidation
                  ),
                  failed: options.libraryValidation.failed ?? null,
                  total: options.libraryValidation.total ?? null,
                  error: options.libraryValidation.error ?? null,
              }
            : null,
        libraryValidationFailures: options.libraryValidationFailures.map(
            (item) => ({
                titleId: item.titleId ?? null,
                titleName: item.titleName ?? null,
                titleKind: item.titleKind ?? null,
            })
        ),
    });
}

export function setLibraryValidationAction(
    event: ValidationStatusEvent | null
): void {
    if (!actionBarOptions) {
        return;
    }

    if (event?.status === 'started') {
        actionBarOptions.libraryValidationFailures.splice(
            0,
            actionBarOptions.libraryValidationFailures.length
        );
    }

    if (event?.status === 'validated' && event.result === 'failed') {
        addLibraryValidationFailure(event);
    }

    actionBarOptions.libraryValidation = event;
    updateActionBar();
}

function addLibraryValidationFailure(event: ValidationStatusEvent): void {
    const key = getLibraryValidationFailureKey(event);
    const existingIndex = actionBarOptions?.libraryValidationFailures.findIndex(
        (item) => getLibraryValidationFailureKey(item) === key
    );
    if (existingIndex === undefined) {
        return;
    }

    if (existingIndex >= 0) {
        actionBarOptions?.libraryValidationFailures.splice(
            existingIndex,
            1,
            event
        );
        return;
    }

    actionBarOptions?.libraryValidationFailures.push(event);
}

function clearLibraryValidationFailure(itemId: string): void {
    if (!actionBarOptions) {
        return;
    }

    const nextFailures = actionBarOptions.libraryValidationFailures.filter(
        (item) => getLibraryValidationFailureKey(item) !== itemId
    );
    actionBarOptions.libraryValidationFailures.splice(
        0,
        actionBarOptions.libraryValidationFailures.length,
        ...nextFailures
    );
    updateActionBar();
}

function queueLibraryValidationFailureDownload(
    downloads: DownloadQueueItem[],
    itemId: string
): void {
    const item =
        actionBarOptions?.libraryValidationFailures.find(
            (candidate) => getLibraryValidationFailureKey(candidate) === itemId
        ) ?? null;

    if (!item?.titleId || !item.titleKind) {
        return;
    }

    queueDownloads(downloads, [
        {
            id: crypto.randomUUID(),
            family: item.titleId.toLowerCase().slice(8),
            groupName: item.titleName ?? item.titleId,
            kind: item.titleKind as TitleKinds,
            label: formatTitleKind(item.titleKind),
            titleId: item.titleId,
            sizeText: null,
            totalBytes: null,
            state: 'queued',
            error: null,
            progress: 0,
            downloadedBytes: null,
            speedText: null,
            completedFiles: null,
            totalFiles: null,
            currentFileName: null,
            installedSizeBytes: null,
            installedVersion: null,
            installedTitleName: null,
            installedSourcePath: null,
        },
    ]);
}

function updateActionBarRowsInPlace(options: ActionBarOptions): void {
    if (!actionBarRoot) {
        return;
    }

    for (const item of options.downloads) {
        const row = actionBarRoot.querySelector<HTMLElement>(
            `[data-download-item-id="${CSS.escape(item.id)}"]`
        );

        if (!row) {
            continue;
        }

        row.className = `action-bar-row action-bar-row-${item.state}`;
        row.dataset.itemState = item.state;
        row.dataset.state = item.state;

        const progress = row.querySelector<HTMLElement>(
            '[data-download-progress]'
        );
        const files = row.querySelector<HTMLElement>('[data-download-files]');
        const icon = row.querySelector<HTMLElement>('[data-download-icon]');
        const state = row.querySelector<HTMLElement>('[data-download-state]');
        const title = row.querySelector<HTMLElement>('[data-download-title]');
        const detail = row.querySelector<HTMLElement>('[data-download-detail]');

        if (progress) {
            progress.textContent = formatDownloadProgress(item);
        }

        if (files) {
            files.textContent =
                item.completedFiles !== null && item.totalFiles !== null
                    ? `${item.completedFiles}/${item.totalFiles} files`
                    : '';
        }

        if (icon) {
            icon.textContent = formatDownloadIcon(item.state) || '↓';
        }

        if (state) {
            state.textContent = formatDownloadState(item);
        }

        if (title) {
            const downloadTitle = formatDownloadTitle(item);
            title.textContent = downloadTitle;
            title.title = downloadTitle;
        }

        if (detail) {
            const detailText =
                item.error ?? item.currentFileName ?? item.speedText ?? '';
            detail.textContent = detailText;
            detail.title = detailText;
        }
    }

    for (const item of options.storageCopies) {
        const row = actionBarRoot.querySelector<HTMLElement>(
            `[data-storage-copy-item-id="${CSS.escape(item.id)}"]`
        );

        if (!row) {
            continue;
        }

        row.className = `action-bar-row action-bar-row-${item.state}`;
        row.dataset.itemState = item.state;
        row.dataset.state = item.state;

        const progress = row.querySelector<HTMLElement>(
            '[data-storage-copy-progress]'
        );
        const files = row.querySelector<HTMLElement>(
            '[data-storage-copy-files]'
        );
        const icon = row.querySelector<HTMLElement>('[data-storage-copy-icon]');
        const state = row.querySelector<HTMLElement>(
            '[data-storage-copy-state]'
        );
        const size = row.querySelector<HTMLElement>('[data-storage-copy-size]');
        const title = row.querySelector<HTMLElement>(
            '[data-storage-copy-title]'
        );
        const detail = row.querySelector<HTMLElement>(
            '[data-storage-copy-detail]'
        );

        if (progress) {
            progress.textContent = formatStorageCopyProgress(item);
        }

        if (files) {
            files.textContent = formatStorageCopyFileCount(item);
        }

        if (icon) {
            icon.textContent = formatStorageCopyIcon(item);
        }

        if (state) {
            state.textContent = formatStorageCopyState(item);
        }

        if (size) {
            size.textContent = formatStorageCopySize(item);
        }

        if (title) {
            title.textContent = formatStorageCopyTitle(item);
            title.title = formatStorageCopyTitle(item);
        }

        if (detail) {
            const detailText = formatStorageCopyDetails(item);
            detail.textContent = detailText;
            detail.title = detailText;
        }
    }

    for (const item of options.storageDeletes) {
        const row = actionBarRoot.querySelector<HTMLElement>(
            `[data-storage-delete-item-id="${CSS.escape(item.id)}"]`
        );

        if (!row) {
            continue;
        }

        row.className = `action-bar-row action-bar-row-${item.state}`;
        row.dataset.itemState = item.state;
        row.dataset.state = item.state;

        const progress = row.querySelector<HTMLElement>(
            '[data-storage-delete-progress]'
        );
        const icon = row.querySelector<HTMLElement>(
            '[data-storage-delete-icon]'
        );
        const state = row.querySelector<HTMLElement>(
            '[data-storage-delete-state]'
        );
        const title = row.querySelector<HTMLElement>(
            '[data-storage-delete-title]'
        );
        const detail = row.querySelector<HTMLElement>(
            '[data-storage-delete-detail]'
        );

        if (progress) {
            progress.textContent = formatStorageDeleteProgress(item);
        }

        if (icon) {
            icon.textContent = formatStorageDeleteIcon(item);
        }

        if (state) {
            state.textContent = formatStorageDeleteState(item);
        }

        if (title) {
            title.textContent = formatStorageDeleteTitle(item);
            title.title = formatStorageDeleteTitle(item);
        }

        if (detail) {
            const detailText = formatStorageDeleteDetails(item);
            detail.textContent = detailText;
            detail.title = detailText;
        }
    }

    const validationRow = actionBarRoot.querySelector<HTMLElement>(
        '[data-library-validation]'
    );
    if (validationRow && options.libraryValidation) {
        const event = options.libraryValidation;
        const stateName = getLibraryValidationActionState(event);
        validationRow.className = `action-bar-row action-bar-row-validation action-bar-row-${stateName}`;
        validationRow.dataset.itemState = stateName;
        validationRow.dataset.state = stateName;

        const progress = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-progress]'
        );
        const icon = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-icon]'
        );
        const state = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-state]'
        );
        const title = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-title]'
        );
        const detail = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-detail]'
        );

        if (progress) {
            progress.textContent = formatLibraryValidationProgress(event);
        }

        const files = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-files]'
        );
        const size = validationRow.querySelector<HTMLElement>(
            '[data-library-validation-size]'
        );

        if (files) {
            files.textContent = formatLibraryValidationFileCount(event);
        }

        if (icon) {
            icon.textContent = formatLibraryValidationIcon(event);
        }

        if (state) {
            state.textContent = formatLibraryValidationState(event);
        }

        if (title) {
            const titleText = formatLibraryValidationTitle(event);
            title.textContent = titleText;
            title.title = titleText;
        }

        if (size) {
            size.textContent = formatLibraryValidationSize(event);
        }

        if (detail) {
            const detailText = formatLibraryValidationDetails(event);
            detail.title = detailText;
            const detailTextElement = detail.querySelector<HTMLElement>(
                '[data-library-validation-detail-text]'
            );
            if (detailTextElement) {
                detailTextElement.textContent = detailText;
                detailTextElement.title = detailText;
            } else {
                detail.textContent = detailText;
            }
        }
    }
}

function formatLibraryValidationProgress(event: ValidationStatusEvent): string {
    if (event.status === 'complete') {
        return '100%';
    }

    if (event.status === 'failed') {
        return event.current !== undefined && event.total
            ? `${Math.round((event.current / event.total) * 100)}%`
            : '0%';
    }

    if (event.current !== undefined && event.total) {
        return `${Math.round((event.current / event.total) * 100)}%`;
    }

    return '0%';
}

function formatLibraryValidationFileCount(
    event: ValidationStatusEvent
): string {
    if (event.current !== undefined && event.total !== undefined) {
        return `${event.current}/${event.total} titles`;
    }

    return '';
}

function formatLibraryValidationIcon(event: ValidationStatusEvent): string {
    const state = getLibraryValidationActionState(event);
    return state === 'complete' ? '✓' : state === 'failed' ? '!' : '...';
}

function formatLibraryValidationState(event: ValidationStatusEvent): string {
    const state = getLibraryValidationActionState(event);
    return state === 'complete'
        ? 'Complete'
        : state === 'failed'
          ? 'Failed'
          : 'Validating';
}

function formatLibraryValidationTitle(event: ValidationStatusEvent): string {
    if (
        (event.status === 'validating' || event.status === 'validated') &&
        event.titleName &&
        event.titleKind &&
        event.titleId
    ) {
        return `${event.titleName} [${formatTitleKind(event.titleKind)}] ${event.titleId}`;
    }

    return 'Library validation';
}

function formatLibraryValidationSize(event: ValidationStatusEvent): string {
    return event.status === 'validating' && event.sizeText
        ? event.sizeText
        : '-';
}

function formatLibraryValidationDetails(event: ValidationStatusEvent): string {
    const state = getLibraryValidationActionState(event);
    if (state === 'validating') {
        return 'Checking files...';
    }

    if (state === 'complete') {
        return `${event.total ?? 0} titles`;
    }

    if (event.status === 'complete') {
        return `${event.failed ?? 0}/${event.total ?? 0} failed`;
    }

    return event.error
        ? `Failed to validate library. ${event.error}`
        : 'Failed to validate library.';
}

function getLibraryValidationFailureKey(event: ValidationStatusEvent): string {
    return event.titleId ?? event.titleName ?? 'unknown';
}

function renderLibraryValidationDetails(
    event: ValidationStatusEvent
): HTMLElement {
    const detailsText = formatLibraryValidationDetails(event);
    const details = createActionBarCell('action-bar-details-cell', '');
    details.title = detailsText;
    details.dataset.libraryValidationDetail = 'true';

    if (getLibraryValidationActionState(event) === 'validating') {
        details.classList.add('action-bar-controls');

        const detailsTextElement = document.createElement('span');
        detailsTextElement.className = 'action-bar-control-text';
        detailsTextElement.title = detailsText;
        detailsTextElement.textContent = detailsText;
        detailsTextElement.dataset.libraryValidationDetailText = 'true';

        details.append(
            detailsTextElement,
            createActionButton(
                'Cancel',
                SOCKET_COMMAND.libraryValidationCancel,
                'library-validation'
            )
        );
        return details;
    }

    details.classList.add('action-bar-controls');

    const detailsTextElement = document.createElement('span');
    detailsTextElement.className = 'action-bar-control-text';
    detailsTextElement.title = detailsText;
    detailsTextElement.textContent = detailsText;

    details.append(
        detailsTextElement,
        createActionButton(
            'Clear',
            'library.validation.clear',
            'library-validation'
        )
    );
    return details;
}

function renderLibraryValidationFailureDetails(
    event: ValidationStatusEvent
): HTMLElement {
    const detailsText = event.error ?? 'Validation failed';
    const details = createActionBarCell('action-bar-details-cell', '');
    details.classList.add('action-bar-controls');
    details.title = detailsText;

    const detailsTextElement = document.createElement('span');
    detailsTextElement.className = 'action-bar-control-text';
    detailsTextElement.title = detailsText;
    detailsTextElement.textContent = detailsText;

    details.append(
        detailsTextElement,
        ...(event.titleId
            ? [
                  createActionButton(
                      'Download',
                      'library.validation.failure.download',
                      getLibraryValidationFailureKey(event)
                  ),
              ]
            : []),
        createActionButton(
            'Clear',
            'library.validation.failure.clear',
            getLibraryValidationFailureKey(event)
        )
    );
    return details;
}

function renderLibraryValidationFailureRow(
    event: ValidationStatusEvent
): HTMLElement {
    const row = document.createElement('div');
    row.className =
        'action-bar-row action-bar-row-validation-failure action-bar-row-failed';
    row.dataset.libraryValidationFailure = 'true';
    row.dataset.itemState = 'failed';
    row.dataset.state = 'failed';

    const progress = createActionBarCell('action-bar-progress', '-');
    const files = createActionBarCell('action-bar-files', '');
    const icon = createActionBarCell('action-bar-icon', '!');
    const state = createActionBarCell('action-bar-state', 'Failed');
    const size = createActionBarCell('action-bar-size', '-');
    const titleText = formatLibraryValidationTitle(event);
    const title = createActionBarCell('action-bar-title', titleText);
    title.title = titleText;
    const details = renderLibraryValidationFailureDetails(event);

    row.append(progress, files, icon, state, size, title, details);
    return row;
}

function getLibraryValidationActionState(
    event: ValidationStatusEvent
): 'validating' | 'complete' | 'failed' {
    if (event.status === 'failed') {
        return 'failed';
    }

    if (event.status === 'complete') {
        return event.failed === 0 ? 'complete' : 'failed';
    }

    return 'validating';
}

function renderLibraryValidationActionRow(
    event: ValidationStatusEvent
): HTMLElement {
    const row = document.createElement('div');
    const stateName = getLibraryValidationActionState(event);
    row.className = `action-bar-row action-bar-row-validation action-bar-row-${stateName}`;
    row.dataset.libraryValidation = 'true';
    row.dataset.itemState = stateName;
    row.dataset.state = stateName;

    const progress = createActionBarCell(
        'action-bar-progress',
        formatLibraryValidationProgress(event)
    );
    progress.dataset.libraryValidationProgress = 'true';

    const files = createActionBarCell(
        'action-bar-files',
        formatLibraryValidationFileCount(event)
    );
    files.dataset.libraryValidationFiles = 'true';

    const icon = createActionBarCell(
        'action-bar-icon',
        formatLibraryValidationIcon(event)
    );
    icon.dataset.libraryValidationIcon = 'true';

    const state = createActionBarCell(
        'action-bar-state',
        formatLibraryValidationState(event)
    );
    state.dataset.libraryValidationState = 'true';

    const size = createActionBarCell(
        'action-bar-size',
        formatLibraryValidationSize(event)
    );
    size.dataset.libraryValidationSize = 'true';

    const titleText = formatLibraryValidationTitle(event);
    const title = createActionBarCell('action-bar-title', titleText);
    title.title = titleText;
    title.dataset.libraryValidationTitle = 'true';

    const details = renderLibraryValidationDetails(event);

    row.append(progress, files, icon, state, size, title, details);
    return row;
}

export function updateActionBar(): void {
    if (!actionBarRoot || !actionBarOptions) {
        return;
    }

    const isEmpty =
        actionBarOptions.downloads.length === 0 &&
        actionBarOptions.storageCopies.length === 0 &&
        actionBarOptions.storageDeletes.length === 0 &&
        actionBarOptions.libraryValidation === null &&
        actionBarOptions.libraryValidationFailures.length === 0;
    actionBarRoot.hidden = isEmpty;

    if (isEmpty) {
        if (actionBarSignature !== '') {
            actionBarSignature = '';
            actionBarRoot.replaceChildren();
        }

        return;
    }

    const nextSignature = getActionBarSignature(actionBarOptions);

    if (nextSignature === actionBarSignature) {
        updateActionBarRowsInPlace(actionBarOptions);

        return;
    }

    actionBarSignature = nextSignature;
    rebuildActionBar(actionBarOptions);
}

export function createActionBarCell(
    className: string,
    textContent = ''
): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = className;
    cell.textContent = textContent;
    return cell;
}

export function createActionButton(
    text: string,
    action: ActionBarCommand,
    itemId: string
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-bar-button';
    button.textContent = text;
    configureActionButton(button, action, itemId);
    return button;
}

function rebuildActionBar(options: ActionBarOptions): void {
    if (!actionBarRoot) {
        return;
    }

    const validationState = options.libraryValidation
        ? getLibraryValidationActionState(options.libraryValidation)
        : null;
    const activeCount =
        options.downloads.filter((item) => item.state === 'downloading')
            .length +
        options.storageCopies.filter((item) => item.state === 'copying')
            .length +
        options.storageDeletes.filter((item) => item.state === 'deleting')
            .length +
        (validationState === 'validating' ? 1 : 0);
    const queuedCount =
        options.downloads.filter((item) => item.state === 'queued').length +
        options.storageCopies.filter((item) => item.state === 'queued').length +
        options.storageDeletes.filter((item) => item.state === 'queued').length;
    const failedCount =
        options.downloads.filter((item) => item.state === 'failed').length +
        options.storageCopies.filter((item) => item.state === 'failed').length +
        options.storageDeletes.filter((item) => item.state === 'failed')
            .length +
        options.libraryValidationFailures.length +
        (validationState === 'failed' ? 1 : 0);
    const finishedCount =
        options.downloads.filter((item) => item.state === 'complete').length +
        options.storageCopies.filter((item) => item.state === 'complete')
            .length +
        options.storageDeletes.filter((item) => item.state === 'complete')
            .length +
        (validationState === 'complete' ? 1 : 0);

    actionBarRoot.replaceChildren();

    if (
        options.downloads.length === 0 &&
        options.storageCopies.length === 0 &&
        options.storageDeletes.length === 0 &&
        options.libraryValidation === null &&
        options.libraryValidationFailures.length === 0
    ) {
        return;
    }

    const summary = document.createElement('div');
    summary.className = 'action-bar-summary';

    const counts = document.createElement('div');
    counts.textContent = `Actions: ${activeCount} active, ${queuedCount} queued, ${failedCount} failed, ${finishedCount} finished`;

    const controls = document.createElement('div');
    controls.className = 'action-bar-summary-controls';

    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'action-bar-button action-bar-clear-all-button';
    clearAll.textContent = 'Clear All';
    clearAll.dataset.actionBarClearAll = 'true';
    clearAll.disabled = !isClearableActionBarItem(options);

    controls.append(clearAll);
    summary.append(counts, controls);
    actionBarRoot.append(summary);

    const details = document.createElement('div');
    details.className = 'action-bar-details';

    for (const item of options.downloads) {
        details.append(renderDownloadActionRow(item));
    }

    for (const item of options.storageCopies) {
        details.append(renderStorageCopyActionRow(item));
    }

    for (const item of options.storageDeletes) {
        details.append(renderStorageDeleteActionRow(item));
    }

    if (options.libraryValidation) {
        details.append(
            renderLibraryValidationActionRow(options.libraryValidation)
        );
    }

    for (const item of options.libraryValidationFailures) {
        details.append(renderLibraryValidationFailureRow(item));
    }

    actionBarRoot.append(details);
}

function buildActionBar(): HTMLElement {
    const strip = document.createElement('section');
    strip.className = 'action-bar';
    strip.hidden = true;
    strip.setAttribute('aria-label', 'Action bar');
    return strip;
}

export function mountActionBar(options: ActionBarOptions): void {
    actionBarOptions = options;

    if (actionBarRoot) {
        updateActionBar();
        return;
    }

    actionBarRoot = buildActionBar();

    actionBarRoot.addEventListener('click', (event) => {
        const target = event.target;

        if (!(target instanceof Element)) {
            return;
        }

        const clearAllButton = target.closest(
            'button[data-action-bar-clear-all]'
        );

        if (
            clearAllButton instanceof HTMLButtonElement &&
            actionBarRoot?.contains(clearAllButton)
        ) {
            event.preventDefault();
            event.stopPropagation();

            if (!clearAllButton.disabled && actionBarOptions) {
                clearAllActionBarItems(actionBarOptions);
            }

            return;
        }

        const closestButton = target.closest(
            'button[data-action][data-item-id]'
        );

        if (
            !(closestButton instanceof HTMLButtonElement) ||
            !actionBarRoot?.contains(closestButton)
        ) {
            return;
        }

        const actionValue = closestButton.getAttribute('data-action');
        const itemId = closestButton.getAttribute('data-item-id');

        if (!isActionBarCommand(actionValue) || !itemId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        actionBarOptions?.onCommand(actionValue, itemId);
    });

    document.body.append(actionBarRoot);
    updateActionBar();
}
