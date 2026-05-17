import { type DownloadQueueItem } from '../shared/download.js';
import {
    type StorageCopyItem,
    type StorageDeleteItem,
} from '../shared/storage.js';
import {
    type SocketCommand,
    type SocketEvent,
    type TitleVerifySocketEvent,
    type LibraryValidateStatusEvent,
    APP_SOCKET_EVENT,
    DOWNLOAD_SOCKET_EVENT,
    STORAGE_COPY_SOCKET_EVENT,
    LIBRARY_VALIDATE_SOCKET_EVENT,
    TITLE_VERIFY_SOCKET_EVENT,
} from '../shared/socket.js';
import { type TitleGroup } from '../shared/titles.js';
import { syncDownloadQueue } from './download.js';
import {
    markStorageCopiesComplete,
    markStorageDeletesComplete,
} from './library.js';
import { syncStorageCopies, syncStorageDeletes } from './storage.js';

type AppSocketOptions = {
    reconnectMs: number;
    onAvailable: () => void;
    onGone: () => void;
    onEvent: (event: SocketEvent) => void;
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
    onLibraryValidateChanged: (event: LibraryValidateStatusEvent) => void;
    onTitleVerificationChanged: (event: TitleVerifySocketEvent) => void;
};

let appSocket: WebSocket | null = null;
let reconnectSocketTimer: number | null = null;
let appSocketOptions: AppSocketOptions | null = null;

export function sendAppSocketCommand(command: SocketCommand): void {
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
            const data = JSON.parse(String(event.data)) as SocketEvent;
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
): (event: SocketEvent) => void {
    const getStorageCompletionOptions = () => ({
        groups: options.getGroups(),
        haystacks: options.haystacks,
        onGroupChanged: options.onGroupChanged,
    });

    const handle = (event: SocketEvent): void => {
        switch (event.type) {
            case APP_SOCKET_EVENT.connected:
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

                if (event.libraryValidateStatus) {
                    handle(event.libraryValidateStatus);
                }
                return;

            case DOWNLOAD_SOCKET_EVENT.changed:
                options.onServerAvailable();
                syncDownloadQueue(
                    options.downloads,
                    event.items,
                    options.haystacks,
                    options.getGroups()
                );
                return;

            case STORAGE_COPY_SOCKET_EVENT.changed:
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

            case LIBRARY_VALIDATE_SOCKET_EVENT.status: {
                options.onServerAvailable();
                options.onValidationStateChanged(
                    event.status !== 'complete' && event.status !== 'failed'
                );

                options.onLibraryValidateChanged(event);
                return;
            }

            case TITLE_VERIFY_SOCKET_EVENT.changed:
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
