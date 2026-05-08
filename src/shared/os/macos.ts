import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
    CancelCopyCommand,
    CancelCopyOptions,
    CopyPathCommand,
    CopyPathOptions,
    Fat32Volume,
    OsOperations,
} from './types.js';

const execFileAsync = promisify(execFile);

type MacMount = {
    source: string;
    path: string;
    fileSystem: string;
};

type DfMount = {
    path: string;
    sizeBytes: number | null;
    freeBytes: number | null;
};

function parseMacMountLine(line: string): MacMount | null {
    const match = /^(?<source>\S+) on (?<path>.+) \((?<options>[^)]*)\)$/.exec(
        line
    );
    const groups = match?.groups;
    if (!groups) {
        return null;
    }

    const fileSystem = groups.options.split(',')[0]?.trim() ?? '';
    if (!fileSystem) {
        return null;
    }

    return {
        source: groups.source,
        path: groups.path,
        fileSystem,
    };
}

function parseDf(stdout: string): Map<string, DfMount> {
    const mounts = new Map<string, DfMount>();

    for (const line of stdout.trim().split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) {
            continue;
        }

        const blocks = parts[1];
        const available = parts[3];
        const pathParts = parts.slice(5);
        const path = pathParts.join(' ');
        const blockCount = Number(blocks);
        const availableKiB = Number(available);

        mounts.set(path, {
            path,
            sizeBytes: Number.isFinite(blockCount) ? blockCount * 1024 : null,
            freeBytes: Number.isFinite(availableKiB)
                ? availableKiB * 1024
                : null,
        });
    }

    return mounts;
}

export async function listMountedFat32Volumes(): Promise<Fat32Volume[]> {
    const [{ stdout: mountStdout }, { stdout: dfStdout }] = await Promise.all([
        execFileAsync('mount'),
        execFileAsync('df', ['-kP']),
    ]);

    const sizes = parseDf(dfStdout);
    return mountStdout
        .split('\n')
        .map(parseMacMountLine)
        .filter(
            (mount): mount is MacMount =>
                mount !== null && mount.fileSystem === 'msdos'
        )
        .map((mount) => {
            const size = sizes.get(mount.path);
            return {
                label: mount.path.split('/').pop() ?? null,
                fileSystem: 'FAT32',
                source: mount.path,
                sizeBytes: size?.sizeBytes ?? null,
                freeBytes: size?.freeBytes ?? null,
            };
        });
}

export const listFat32Volumes = listMountedFat32Volumes;

function getSourceDirectoryName(sourcePath: string): string {
    return path.posix.basename(sourcePath.replace(/\/+$/, ''));
}

export function cancelCopy({
    pid,
}: CancelCopyOptions): Promise<CancelCopyCommand> {
    return Promise.resolve({
        tool: 'kill',
        command: 'kill',
        args: ['-TERM', '--', `-${pid}`],
        reason: 'terminate rsync process group',
        successExitCodes: [0],
    });
}

export function copyPath({
    sourcePath,
    destination,
    move = false,
}: CopyPathOptions): Promise<CopyPathCommand> {
    if (!destination.source) {
        throw new Error('Destination does not have a macOS path.');
    }

    const destinationPath = path.posix.join(
        destination.source,
        getSourceDirectoryName(sourcePath)
    );

    return Promise.resolve({
        tool: 'rsync',
        command: 'rsync',
        args: [
            '-a',
            '--progress',
            '--stats',
            ...(move ? ['--remove-source-files'] : []),
            `${sourcePath.replace(/\/+$/, '')}/`,
            `${destinationPath.replace(/\/+$/, '')}/`,
        ],
        reason: 'destination is a macOS FAT32 mount',
        detached: true,
    });
}

export const macos: OsOperations = {
    copyPath,
    cancelCopy,
    listFat32Volumes: listFat32Volumes,
};
