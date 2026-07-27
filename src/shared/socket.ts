import {
    type DownloadQueueItem,
    type DownloadQueueItemDetails,
} from './download.js';
import { type ActionState } from './action.js';

import { type StorageCopyItem, type StorageDeleteItem } from './storage.js';
import { TitleKinds, type TitleGroup, type TitlePlatform } from './titles.js';

export const SOCKET_COMMAND = {
    downloadQueue: 'download.queue',
    downloadRetry: 'download.retry',
    downloadClear: 'download.clear',
    downloadCancel: 'download.cancel',
    storageCopyRetry: 'storage.copy.retry',
    storageCopyClear: 'storage.copy.clear',
    storageCopyCancel: 'storage.copy.cancel',
    storageDeleteRetry: 'storage.delete.retry',
    storageDeleteClear: 'storage.delete.clear',
    storageDeleteCancel: 'storage.delete.cancel',
    libraryVerifyCancel: 'library.verify.cancel',
    libraryVerifyClear: 'library.verify.clear',
    libraryVerifyDownload: 'library.verify.download',
    libraryScanClear: 'library.scan.clear',
    libraryConvertCancel: 'library.convert.cancel',
    libraryConvertClear: 'library.convert.clear',
    libraryConvertRetry: 'library.convert.retry',
    libraryOrganizeCancel: 'library.organize.cancel',
    libraryOrganizeClear: 'library.organize.clear',
    libraryOrganizeRetry: 'library.organize.retry',
    titleValidateQueue: 'title.validate.queue',
} as const;

export const SOCKET_EVENT = {
    appConnected: 'app.connected',
    downloadQueueChanged: 'download.queue.changed',
    storageCopyChanged: 'storage.copy.changed',
    storageDeleteChanged: 'storage.delete.changed',
    libraryVerifyChanged: 'library.verify.changed',
    libraryScanChanged: 'library.scan.changed',
    libraryOrganizeChanged: 'library.organize.changed',
    libraryConvertChanged: 'library.convert.changed',
    titleValidateChanged: 'title.validate.changed',
} as const;

export const DOWNLOAD_SOCKET_COMMAND = {
    queue: SOCKET_COMMAND.downloadQueue,
    retry: SOCKET_COMMAND.downloadRetry,
    clear: SOCKET_COMMAND.downloadClear,
    cancel: SOCKET_COMMAND.downloadCancel,
} as const;

export const STORAGE_COPY_SOCKET_COMMAND = {
    retry: SOCKET_COMMAND.storageCopyRetry,
    clear: SOCKET_COMMAND.storageCopyClear,
    cancel: SOCKET_COMMAND.storageCopyCancel,
} as const;

export const STORAGE_DELETE_SOCKET_COMMAND = {
    retry: SOCKET_COMMAND.storageDeleteRetry,
    clear: SOCKET_COMMAND.storageDeleteClear,
    cancel: SOCKET_COMMAND.storageDeleteCancel,
} as const;

export const LIBRARY_VERIFY_SOCKET_COMMAND = {
    cancel: SOCKET_COMMAND.libraryVerifyCancel,
    clear: SOCKET_COMMAND.libraryVerifyClear,
    download: SOCKET_COMMAND.libraryVerifyDownload,
} as const;

export const LIBRARY_SCAN_SOCKET_COMMAND = {
    clear: SOCKET_COMMAND.libraryScanClear,
} as const;

export const LIBRARY_ORGANIZE_SOCKET_COMMAND = {
    cancel: SOCKET_COMMAND.libraryOrganizeCancel,
    clear: SOCKET_COMMAND.libraryOrganizeClear,
    retry: SOCKET_COMMAND.libraryOrganizeRetry,
} as const;

export const TITLE_VALIDATE_SOCKET_COMMAND = {
    queue: SOCKET_COMMAND.titleValidateQueue,
} as const;

export const APP_SOCKET_EVENT = {
    connected: SOCKET_EVENT.appConnected,
} as const;

export const DOWNLOAD_SOCKET_EVENT = {
    changed: SOCKET_EVENT.downloadQueueChanged,
} as const;

export const STORAGE_COPY_SOCKET_EVENT = {
    changed: SOCKET_EVENT.storageCopyChanged,
} as const;

export const STORAGE_DELETE_SOCKET_EVENT = {
    changed: SOCKET_EVENT.storageDeleteChanged,
} as const;

export const LIBRARY_VERIFY_SOCKET_EVENT = {
    changed: SOCKET_EVENT.libraryVerifyChanged,
} as const;

export const LIBRARY_SCAN_SOCKET_EVENT = {
    changed: SOCKET_EVENT.libraryScanChanged,
} as const;

export const LIBRARY_ORGANIZE_SOCKET_EVENT = {
    changed: SOCKET_EVENT.libraryOrganizeChanged,
} as const;

export const LIBRARY_CONVERT_SOCKET_EVENT = {
    changed: SOCKET_EVENT.libraryConvertChanged,
} as const;

export const LIBRARY_CONVERT_SOCKET_COMMAND = {
    cancel: SOCKET_COMMAND.libraryConvertCancel,
    clear: SOCKET_COMMAND.libraryConvertClear,
    retry: SOCKET_COMMAND.libraryConvertRetry,
} as const;

export const TITLE_VALIDATE_SOCKET_EVENT = {
    changed: SOCKET_EVENT.titleValidateChanged,
} as const;

export type DownloadSocketCommand =
    | {
          type: typeof DOWNLOAD_SOCKET_COMMAND.queue;
          items: DownloadQueueItemDetails[];
      }
    | {
          type: typeof DOWNLOAD_SOCKET_COMMAND.retry;
          id: string;
      }
    | {
          type: typeof DOWNLOAD_SOCKET_COMMAND.clear;
          id: string;
      }
    | {
          type: typeof DOWNLOAD_SOCKET_COMMAND.cancel;
          id: string;
      };

export type StorageCopySocketCommand =
    | {
          type: typeof STORAGE_COPY_SOCKET_COMMAND.retry;
          id: string;
      }
    | {
          type: typeof STORAGE_COPY_SOCKET_COMMAND.clear;
          id: string;
      }
    | {
          type: typeof STORAGE_COPY_SOCKET_COMMAND.cancel;
          id: string;
      };

export type StorageDeleteSocketCommand =
    | {
          type: typeof STORAGE_DELETE_SOCKET_COMMAND.retry;
          id: string;
      }
    | {
          type: typeof STORAGE_DELETE_SOCKET_COMMAND.clear;
          id: string;
      }
    | {
          type: typeof STORAGE_DELETE_SOCKET_COMMAND.cancel;
          id: string;
      };

export type LibraryVerifySocketCommand =
    | {
          type: typeof LIBRARY_VERIFY_SOCKET_COMMAND.cancel;
      }
    | {
          type: typeof LIBRARY_VERIFY_SOCKET_COMMAND.clear;
          id: string;
      }
    | {
          type: typeof LIBRARY_VERIFY_SOCKET_COMMAND.download;
      };

export type LibraryConvertSocketCommand =
    | {
          type: typeof LIBRARY_CONVERT_SOCKET_COMMAND.cancel;
          id: string;
      }
    | {
          type: typeof LIBRARY_CONVERT_SOCKET_COMMAND.clear;
          id: string;
      }
    | {
          type: typeof LIBRARY_CONVERT_SOCKET_COMMAND.retry;
          id: string;
      };

export type LibraryOrganizeSocketCommand =
    | {
          type: typeof LIBRARY_ORGANIZE_SOCKET_COMMAND.cancel;
          id: string;
      }
    | {
          type: typeof LIBRARY_ORGANIZE_SOCKET_COMMAND.clear;
          id: string;
      }
    | {
          type: typeof LIBRARY_ORGANIZE_SOCKET_COMMAND.retry;
          id: string;
      };

export type TitleValidationSocketCommand = {
    type: typeof TITLE_VALIDATE_SOCKET_COMMAND.queue;
    id: string;
    name: string;
    platform: TitlePlatform;
};

export type SocketCommand =
    | DownloadSocketCommand
    | StorageCopySocketCommand
    | StorageDeleteSocketCommand
    | LibraryVerifySocketCommand
    | LibraryScanSocketCommand
    | LibraryOrganizeSocketCommand
    | LibraryConvertSocketCommand
    | TitleValidationSocketCommand;

export type AppConnectedEvent = {
    type: typeof APP_SOCKET_EVENT.connected;
    serverId: string;
    downloads: DownloadQueueItem[];
    storageCopies: StorageCopyItem[];
    storageDeletes: StorageDeleteItem[];
    libraryVerifyEvents: LibraryVerifyEvent[];
    libraryScans: LibraryScanItem[];
    libraryOrganizeItems: LibraryOrganizeItem[];
    libraryConversions: LibraryConvertItem[];
    titleValidations: TitleValidationSocketEvent[];
};

export type LibraryScanSocketCommand = {
    type: typeof LIBRARY_SCAN_SOCKET_COMMAND.clear;
    id: string;
};

export type LibraryScanItem = {
    id: string;
    state: Extract<
        ActionState,
        'queued' | 'in-progress' | 'complete' | 'failed'
    >;
    current: number;
    total: number;
    titleCount: number | null;
    groups: TitleGroup[] | null;
    error: string | null;
};

export type LibraryScanSocketEvent = {
    type: typeof LIBRARY_SCAN_SOCKET_EVENT.changed;
    items: LibraryScanItem[];
};

export type LibraryOrganizeItem = {
    id: string;
    state: ActionState;
    totalPlatforms: number;
    completedPlatforms: number;
    totalTitles: number;
    organizedTitles: number;
    unchangedTitles: number;
    message: string;
    error: string | null;
};

export type LibraryOrganizeSocketEvent = {
    type: typeof LIBRARY_ORGANIZE_SOCKET_EVENT.changed;
    items: LibraryOrganizeItem[];
};

export type DownloadSocketEvent = {
    type: typeof DOWNLOAD_SOCKET_EVENT.changed;
    items: DownloadQueueItem[];
};

export type StorageCopySocketEvent = {
    type: typeof STORAGE_COPY_SOCKET_EVENT.changed;
    items: StorageCopyItem[];
};

export type StorageDeleteSocketEvent = {
    type: typeof STORAGE_DELETE_SOCKET_EVENT.changed;
    items: StorageDeleteItem[];
};

export type LibraryVerifyProgress = {
    type: typeof SOCKET_EVENT.libraryVerifyChanged;
    state: 'in-progress';
    titleId: string;
    platform: TitlePlatform;
    name: string;
    kind: TitleKinds;
    version: number | null;
    currentFileName?: string | null;
    currentFileSizeBytes?: number | null;
    result?: 'ok' | 'failed';
    error?: string | null;
    current: number;
    total: number;
};

export type LibraryVerifyFailure = Omit<
    LibraryVerifyProgress,
    'state' | 'result'
> & {
    state: 'failed';
    result: 'failed';
};

export type LibraryVerifyEvent =
    | {
          type: typeof SOCKET_EVENT.libraryVerifyChanged;
          state: 'in-progress';
          reset: true;
      }
    | LibraryVerifyProgress
    | LibraryVerifyFailure
    | {
          type: typeof SOCKET_EVENT.libraryVerifyChanged;
          state: 'complete';
          total: number;
          failed: number;
      }
    | {
          type: typeof SOCKET_EVENT.libraryVerifyChanged;
          state: 'failed';
          error: string;
      }
    | {
          type: typeof SOCKET_EVENT.libraryVerifyChanged;
          state: 'cancelled';
          current: number;
          total: number;
      }
    | {
          type: typeof SOCKET_EVENT.libraryVerifyChanged;
          state: 'cleared';
          id: string;
      };

export type LibraryConvertItem = {
    id: string;
    titleId: string;
    name: string | null;
    kind: TitleKinds;
    version: number | null;
    state: ActionState;
    currentFileName: string | null;
    current: number | null;
    total: number | null;
    currentFileSizeBytes: number | null;
    converted: number | null;
    convertedTitles: Array<{
        titleId: string;
        name: string;
        kind: TitleKinds;
        version: number;
        sizeBytes: number;
    }> | null;
    error: string | null;
};

export type LibraryConvertSocketEvent = {
    type: typeof SOCKET_EVENT.libraryConvertChanged;
    items: LibraryConvertItem[];
};

export type TitleValidationCopyResult = {
    sourcePath: string;
    titleId: string | null;
    titleKind: TitleKinds | null;
    titleVersion: number | null;
    status: 'ok' | 'failed';
    failedCount: number;
    totalCount: number;
    error: string | null;
};

export type TitleValidationSocketEvent = {
    type: typeof SOCKET_EVENT.titleValidateChanged;
    platform: TitlePlatform;
    titleId: string;
    status: 'validating' | 'complete' | 'failed';
    copies: TitleValidationCopyResult[];
    error?: string | null;
};

export type SocketEvent =
    | AppConnectedEvent
    | DownloadSocketEvent
    | StorageCopySocketEvent
    | StorageDeleteSocketEvent
    | LibraryVerifyEvent
    | LibraryScanSocketEvent
    | LibraryOrganizeSocketEvent
    | LibraryConvertSocketEvent
    | TitleValidationSocketEvent;

export function isSocketCommand<T extends SocketCommand['type']>(
    command: SocketCommand,
    type?: T | readonly T[] | Record<string, T>
): command is Extract<SocketCommand, { type: T }> {
    if (!type) {
        return Object.values(SOCKET_COMMAND).includes(command.type);
    }
    if (typeof type === 'object' && !Array.isArray(type)) {
        return Object.values(type).includes(command.type as T);
    }
    if (Array.isArray(type)) {
        return type.includes(command.type);
    }
    return type === command.type;
}
