import type { ChildProcess } from 'node:child_process';

export type Fat32Volume = {
    label: string | null;
    fileSystem: 'FAT32';
    source: string;
    sizeBytes: number | null;
    freeBytes: number | null;
};

export type CopyProgressUpdate = {
    progress: number | null;
    message: string | null;
    currentSizeBytes: number | null;
    currentFilePath: string | null;
    completedFile: boolean;
};

export type CopyOutputParseContext = {
    sourcePath: string;
    destinationPath: string;
};

export type CopyOutputParser = (
    text: string,
    context: CopyOutputParseContext
) => CopyProgressUpdate | null;

export type CopyCancelContext = Record<string, unknown>;

export type CancelCopyOptions = {
    pid: number;
    context?: CopyCancelContext;
};

export type CancelCopyCommand = {
    tool: string;
    command: string;
    args: string[];
    reason: string;
    successExitCodes?: number[];
};

export type CopyProcessHandle = {
    child: ChildProcess;
    pid: number;
};

export type CopyPathOptions = {
    sourcePath: string;
    destination: Fat32Volume;
    move?: boolean;
};

export type CopyPathCommand = {
    command: string;
    args: string[];
    reason: string;
    successExitCodes?: number[];
    detached?: boolean;
    cancelContext?: CopyCancelContext;
    parseOutput?: CopyOutputParser;
};

export type OsOperations = {
    listFat32Volumes: () => Promise<Fat32Volume[]>;
    copyPath: (options: CopyPathOptions) => Promise<CopyPathCommand>;
    cancelCopy: (options: CancelCopyOptions) => Promise<CancelCopyCommand>;
};
