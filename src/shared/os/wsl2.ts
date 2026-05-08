import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
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
import * as linux from './linux.js';
import * as windows from './windows.js';

const execFileAsync = promisify(execFile);

export type WslPathInspection = {
    path: string | null;
    windowsPath: string | null;
    windowsBacked: boolean;
    mountTarget: string | null;
    fileSystem: string | null;
};

export async function isWsl2(): Promise<boolean> {
    if (os.platform() !== 'linux') {
        return false;
    }

    try {
        const version = await readFile('/proc/version', 'utf8');
        return /microsoft/i.test(version);
    } catch {
        return false;
    }
}

function parseOptions(options: string): Map<string, string> {
    const parsed = new Map<string, string>();
    for (const option of options.split(',')) {
        const [key, ...valueParts] = option.split('=');
        if (!key) {
            continue;
        }
        parsed.set(key, valueParts.join('='));
    }
    return parsed;
}

function isWindowsBackedMount(mount: linux.LinuxMount): boolean {
    return (
        mount.fileSystem === 'drvfs' ||
        (mount.fileSystem === '9p' &&
            parseOptions(mount.options).get('aname') === 'drvfs')
    );
}

function getMountWindowsPath(mount: linux.LinuxMount): string | null {
    return (
        normalizeWindowsDriveRoot(mount.source) ??
        normalizeWindowsDriveRoot(
            parseOptions(mount.options).get('path') ?? null
        )
    );
}

function normalizeWindowsDriveRoot(value: string | null): string | null {
    if (!value) {
        return null;
    }

    const match = /^([A-Z]):[\\/]?$/i.exec(value.trim());
    return match ? `${match[1].toUpperCase()}:\\` : null;
}

function getRelativeWindowsPath(
    sourcePath: string,
    mount: linux.LinuxMount
): string {
    const relative = path.posix.relative(mount.target, sourcePath);
    return relative === '' ? '' : path.win32.join(...relative.split('/'));
}

async function wslpath(args: string[]): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('wslpath', args);
        const converted = stdout.trim();
        return converted.length > 0 ? converted : null;
    } catch {
        return null;
    }
}

function mergeVolumes(
    linuxVolume: Fat32Volume,
    windowsVolume: Fat32Volume
): Fat32Volume {
    return {
        ...linuxVolume,
        label: windowsVolume.label ?? linuxVolume.label,
        sizeBytes: windowsVolume.sizeBytes ?? linuxVolume.sizeBytes,
        freeBytes: windowsVolume.freeBytes ?? linuxVolume.freeBytes,
    };
}

export async function listMountedFat32Volumes(): Promise<Fat32Volume[]> {
    const [linuxVolumes, windowsVolumes, wslMounts] = await Promise.all([
        linux.listFat32Volumes(),
        windows.listFat32Volumes(),
        linux.listMounts(),
    ]);
    const windowsMounts = wslMounts.filter(isWindowsBackedMount);

    const byLinuxSource = new Map<string, Fat32Volume>();
    const byWindowsPath = new Map<string, Fat32Volume>();

    for (const volume of linuxVolumes) {
        byLinuxSource.set(volume.source, volume);
    }

    for (const volume of windowsVolumes) {
        const normalizedWindowsPath = normalizeWindowsDriveRoot(volume.source);
        if (!normalizedWindowsPath) {
            continue;
        }

        const matchedMount =
            windowsMounts.find(
                (mount) => getMountWindowsPath(mount) === normalizedWindowsPath
            ) ?? null;
        const mountedPath = matchedMount?.target ?? null;
        const existing =
            mountedPath !== null
                ? (byLinuxSource.get(mountedPath) ?? null)
                : null;
        const next: Fat32Volume = {
            ...volume,
            source: mountedPath ?? normalizedWindowsPath,
        };

        const merged = existing ? mergeVolumes(existing, next) : next;
        if (mountedPath) {
            byLinuxSource.set(mountedPath, merged);
        }
        byWindowsPath.set(normalizedWindowsPath, merged);
    }

    return [
        ...byLinuxSource.values(),
        ...[...byWindowsPath.values()].filter((volume) =>
            windows.isWindowsPath(volume.source)
        ),
    ];
}

export async function inspectWslPath(
    sourcePath: string
): Promise<WslPathInspection> {
    if (windows.isWindowsPath(sourcePath)) {
        return {
            path: await wslpath(['-u', sourcePath]),
            windowsPath: sourcePath.trim(),
            windowsBacked: true,
            mountTarget: null,
            fileSystem: null,
        };
    }

    const mount = await linux.findMountForPath(sourcePath);
    if (!mount || !isWindowsBackedMount(mount)) {
        return {
            path: sourcePath,
            windowsPath: null,
            windowsBacked: false,
            mountTarget: mount?.target ?? null,
            fileSystem: mount?.fileSystem ?? null,
        };
    }

    const mountWindowsPath = getMountWindowsPath(mount);
    const windowsPath = mountWindowsPath
        ? windows.appendWindowsSubpath(
              mountWindowsPath,
              getRelativeWindowsPath(sourcePath, mount)
          )
        : await wslpath(['-w', sourcePath]);

    return {
        path: sourcePath,
        windowsPath,
        windowsBacked: true,
        mountTarget: mount.target,
        fileSystem: mount.fileSystem,
    };
}

export const listFat32Volumes = listMountedFat32Volumes;

export function cancelCopy({
    pid,
}: CancelCopyOptions): Promise<CancelCopyCommand> {
    return Promise.resolve({
        tool: 'kill',
        command: 'kill',
        args: ['-TERM', '--', `-${pid}`],
        reason: 'terminate WSL copy process group',
        successExitCodes: [0],
    });
}

export async function copyPath({
    sourcePath,
    destination,
    move = false,
}: CopyPathOptions): Promise<CopyPathCommand> {
    const source = await inspectWslPath(sourcePath);
    const destinationIsWindowsPath = windows.isWindowsPath(destination.source);

    if (!destinationIsWindowsPath && source.path) {
        const command = await linux.copyPath({
            sourcePath,
            destination,
            move,
        });

        return {
            ...command,
            detached: true,
            cancelContext: {
                runtime: 'linux',
            },
        };
    }

    const destinationWindowsPath =
        normalizeWindowsDriveRoot(destination.source) ??
        (await wslpath(['-w', destination.source]));
    if (destinationWindowsPath) {
        const sourceWindowsPath =
            source.windowsPath ?? (await wslpath(['-w', sourcePath]));
        if (!sourceWindowsPath) {
            throw new Error(
                `Failed to convert source path for robocopy: ${sourcePath}`
            );
        }

        const command = await windows.copyPath({
            sourcePath: sourceWindowsPath,
            destination: {
                ...destination,
                source: destinationWindowsPath,
            },
            move,
        });

        return {
            ...command,
            detached: true,
            cancelContext: {
                runtime: 'windows',
            },
            reason: destinationIsWindowsPath
                ? 'destination is only visible to Windows'
                : 'source and destination are Windows-backed',
        };
    }

    throw new Error('Destination is not accessible from WSL or Windows tools.');
}

export const wsl2: OsOperations = {
    cancelCopy,
    copyPath,
    listFat32Volumes,
};
