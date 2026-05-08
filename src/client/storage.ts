import { formatSize, StorageCopyItem } from '../shared/shared.js';
import {
    createActionBarCell,
    createActionButton,
    getPathDisplayName,
    sendAppSocketCommand,
    updateActionBar,
} from './main.js';

export type StorageCopyActionBarCommand =
    | 'storage.copy.cancel'
    | 'storage.copy.remove'
    | 'storage.copy.retry';

export function syncStorageCopies(
    copies: StorageCopyItem[],
    nextCopies: StorageCopyItem[]
): void {
    copies.splice(0, copies.length, ...nextCopies);
    updateActionBar();
}

function formatStorageCopyProgress(item: StorageCopyItem): string {
    if (item.state === 'queued') {
        return '0%';
    }

    if (item.state === 'failed') {
        return item.progress !== null ? `${Math.round(item.progress)}%` : '0%';
    }

    if (item.state === 'complete') {
        return 'Done';
    }

    return item.progress !== null ? `${Math.round(item.progress)}%` : '0%';
}

function formatStorageCopyFileCount(item: StorageCopyItem): string {
    return item.completedFiles !== null && item.totalFiles !== null
        ? `${item.completedFiles}/${item.totalFiles} files`
        : '';
}

function formatStorageCopySize(item: StorageCopyItem): string {
    return item.sourceSizeBytes !== null
        ? formatSize(item.sourceSizeBytes)
        : '';
}

function formatStorageCopyState(item: StorageCopyItem): string {
    switch (item.state) {
        case 'copying':
            return item.operation === 'move' ? 'Moving' : 'Copying';
        case 'queued':
            return 'Queued';
        case 'failed':
            return 'Failed';
        case 'complete':
            return 'Complete';
    }
}

function formatStorageCopyIcon(item: StorageCopyItem): string {
    switch (item.state) {
        case 'copying':
            return item.operation === 'move' ? '→' : '⇄';
        case 'queued':
            return '○';
        case 'complete':
            return '✓';
        case 'failed':
            return '!';
        default:
            return '';
    }
}

function formatStorageCopyDetails(item: StorageCopyItem): string {
    if (item.error) {
        return item.error;
    }

    if (!item.currentFilePath) {
        return item.message ?? formatStorageCopyState(item);
    }

    return item.currentSizeBytes !== null
        ? `${item.currentFilePath} (${formatSize(item.currentSizeBytes)})`
        : item.currentFilePath;
}

export function renderStorageCopyActionRow(item: StorageCopyItem): HTMLElement {
    const row = document.createElement('div');
    row.className = `action-bar-row action-bar-row-${item.state}`;
    row.dataset.itemId = item.id;
    row.dataset.itemState = item.state;

    const progress = createActionBarCell(
        'action-bar-progress',
        formatStorageCopyProgress(item)
    );
    const files = createActionBarCell(
        'action-bar-files',
        formatStorageCopyFileCount(item)
    );
    const icon = createActionBarCell(
        'action-bar-icon',
        formatStorageCopyIcon(item)
    );
    const state = createActionBarCell(
        'action-bar-state',
        formatStorageCopyState(item)
    );
    const size = createActionBarCell(
        'action-bar-size',
        formatStorageCopySize(item)
    );

    const title = createActionBarCell(
        'action-bar-title',
        getPathDisplayName(item.sourcePath)
    );
    title.title = item.sourcePath;

    const detailsCell = renderStorageCopyControls(item);

    row.append(progress, files, icon, state, size, title, detailsCell);
    return row;
}

function renderStorageCopyControls(item: StorageCopyItem): HTMLDivElement {
    const detailsCell = document.createElement('div');
    detailsCell.className = 'action-bar-details-cell';
    detailsCell.title = item.destinationPath;

    if (item.state === 'failed') {
        detailsCell.classList.add('action-bar-controls');
        detailsCell.title = item.error ?? '';
        detailsCell.append(
            createActionButton('Retry', 'storage.copy.retry', item.id),
            createActionButton('Remove', 'storage.copy.remove', item.id)
        );
        return detailsCell;
    }

    if (item.state === 'queued') {
        detailsCell.classList.add('action-bar-controls');
        detailsCell.append(
            createActionButton('Remove', 'storage.copy.remove', item.id)
        );
        return detailsCell;
    }

    if (item.state === 'copying') {
        detailsCell.classList.add('action-bar-controls');

        const detailsText = formatStorageCopyDetails(item);
        const detailsTextElement = document.createElement('span');
        detailsTextElement.className = 'action-bar-control-text';
        detailsTextElement.title = detailsText;
        detailsTextElement.textContent = detailsText;

        detailsCell.append(
            detailsTextElement,
            createActionButton('Cancel', 'storage.copy.cancel', item.id)
        );
        return detailsCell;
    }

    detailsCell.textContent = formatStorageCopyDetails(item);
    return detailsCell;
}

export function retryStorageCopy(itemId: string): void {
    sendAppSocketCommand({
        type: 'storage.copy.retry',
        id: itemId,
    });
}

export function removeStorageCopy(itemId: string): void {
    sendAppSocketCommand({
        type: 'storage.copy.remove',
        id: itemId,
    });
}

export function cancelStorageCopy(itemId: string): void {
    sendAppSocketCommand({
        type: 'storage.copy.cancel',
        id: itemId,
    });
}
