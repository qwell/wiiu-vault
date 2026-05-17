import { DOWNLOAD_SOCKET_COMMAND } from './socket.js';
import { TitleKinds } from './titles.js';

export type DownloadActionBarCommand =
    (typeof DOWNLOAD_SOCKET_COMMAND)[keyof typeof DOWNLOAD_SOCKET_COMMAND];

export type DownloadQueueState =
    | 'queued'
    | 'downloading'
    | 'failed'
    | 'complete';

export type DownloadQueueItem = {
    id: string;
    family: string;
    groupName: string;
    kind: TitleKinds;
    label: string;
    titleId: string;
    sizeText: string | null;
    totalBytes: number | null;
    state: DownloadQueueState;
    error: string | null;

    progress: number;
    downloadedBytes: number | null;
    speedText: string | null;
    completedFiles: number | null;
    totalFiles: number | null;
    currentFileName: string | null;
    installedSizeBytes: number | null;
    installedVersion: number | null;
    installedTitleName: string | null;
    installedSourcePath: string | null;
};
