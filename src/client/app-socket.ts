import { type DownloadQueueItem } from '../shared/download.js';
import {
    type StorageCopyItem,
    type StorageDeleteItem,
} from '../shared/storage.js';
import {
    type AppSocketCommand,
    type AppSocketEvent,
    type TitleVerifySocketEvent,
    type ValidationStatusEvent,
} from '../shared/socket.js';
import { type TitleGroup } from '../shared/titles.js';
import { syncDownloadQueue } from './download.js';
import {
    markStorageCopiesComplete,
    markStorageDeletesComplete,
} from './library-state.js';
import { syncStorageCopies, syncStorageDeletes } from './storage.js';

type AppSocketOptions = {
    reconnectMs: number;
    onAvailable: () => void;
    onGone: () => void;
    onEvent: (event: AppSocketEvent) => void;
};

type AppEventOptions = {
    downloads: DownloadQueueItem[];
    storageCopies: StorageCopyItem[];
    storageDeletes: StorageDeleteItem[];
    haystacks: WeakMap<TitleGroup, string>;
    getGroups: () => TitleGroup[];
    onServerAvailable: () => void;
    onGroupChanged: (group: TitleGroup) => void;
    onValidationStateChanged: (validating: boolean) => void;
    onLibraryValidationChanged: (event: ValidationStatusEvent) => void;
    onTitleVerificationChanged: (event: TitleVerifySocketEvent) => void;
};

let appSocket: WebSocket | null = null;
let reconnectSocketTimer: number | null = null;
let appSocketOptions: AppSocketOptions | null = null;

export function sendAppSocketCommand(command: AppSocketCommand): void {
    if (!appSocket || appSocket.readyState !== WebSocket.OPEN) {
        appSocketOptions?.onGone();
        return;
    }

    appSocket.send(JSON.stringify(command));
}

function scheduleAppSocketReconnect(): void {
    const options = appSocketOptions;

    if (!options || reconnectSocketTimer !== null) {
        return;
    }

    reconnectSocketTimer = window.setTimeout(() => {
        reconnectSocketTimer = null;

        if (
            appSocket &&
            (appSocket.readyState === WebSocket.OPEN ||
                appSocket.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }

        connectAppSocket(options);
    }, options.reconnectMs);
}

export function connectAppSocket(options: AppSocketOptions): void {
    appSocketOptions = options;

    if (
        appSocket &&
        (appSocket.readyState === WebSocket.OPEN ||
            appSocket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    appSocket = new WebSocket(getSocketUrl());

    appSocket.addEventListener('open', () => {
        options.onAvailable();
    });

    appSocket.addEventListener('message', (event: MessageEvent) => {
        try {
            const data = JSON.parse(String(event.data)) as AppSocketEvent;
            options.onEvent(data);
        } catch (error) {
            console.error(error);
        }
    });

    appSocket.addEventListener('close', () => {
        options.onGone();
        scheduleAppSocketReconnect();
    });

    appSocket.addEventListener('error', () => {
        options.onGone();
        scheduleAppSocketReconnect();
    });
}

export function createAppEventHandler(
    options: AppEventOptions
): (event: AppSocketEvent) => void {
    const getStorageCompletionOptions = () => ({
        groups: options.getGroups(),
        haystacks: options.haystacks,
        onGroupChanged: options.onGroupChanged,
    });

    const handle = (event: AppSocketEvent): void => {
        switch (event.type) {
            case 'app.connected':
                options.onServerAvailable();

                syncDownloadQueue(
                    options.downloads,
                    event.downloads,
                    options.haystacks,
                    options.getGroups()
                );

                markStorageCopiesComplete(
                    syncStorageCopies(
                        options.storageCopies,
                        event.storageCopies
                    ),
                    getStorageCompletionOptions()
                );
                markStorageDeletesComplete(
                    syncStorageDeletes(
                        options.storageDeletes,
                        event.storageDeletes
                    ),
                    getStorageCompletionOptions()
                );

                if (event.libraryValidationStatus) {
                    handle(event.libraryValidationStatus);
                }
                return;

            case 'download.queueChanged':
                options.onServerAvailable();
                syncDownloadQueue(
                    options.downloads,
                    event.items,
                    options.haystacks,
                    options.getGroups()
                );
                return;

            case 'storage.copyChanged':
                options.onServerAvailable();
                markStorageCopiesComplete(
                    syncStorageCopies(options.storageCopies, event.items),
                    getStorageCompletionOptions()
                );
                return;

            case 'storage.deleteChanged':
                options.onServerAvailable();
                markStorageDeletesComplete(
                    syncStorageDeletes(options.storageDeletes, event.items),
                    getStorageCompletionOptions()
                );
                return;

            case 'library.validationStatus': {
                options.onServerAvailable();
                options.onValidationStateChanged(
                    event.status !== 'complete' && event.status !== 'failed'
                );

                options.onLibraryValidationChanged(event);
                return;
            }

            case 'title.verify.changed':
                options.onServerAvailable();
                options.onTitleVerificationChanged(event);
                return;
        }
    };

    return handle;
}

export function getSocketUrl(): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/api/socket`;
}
