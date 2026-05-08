import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import path from 'node:path';

import type { CopyOutputParseContext, CopyProgressUpdate } from './types.js';

import type {
    CancelCopyCommand,
    CancelCopyOptions,
    CopyPathCommand,
    CopyPathOptions,
    Fat32Volume,
    OsOperations,
} from './types.js';
import { normalizePath } from './path.js';
import { toArray } from '../shared.js';
import { nullableNumber, nullableString } from '../value.js';

const execFileAsync = promisify(execFile);

type WindowsVolume = {
    DriveLetter?: unknown;
    FileSystemLabel?: unknown;
    FileSystem?: unknown;
    DriveType?: unknown;
    HealthStatus?: unknown;
    Size?: unknown;
    SizeRemaining?: unknown;
};

function getDriveRoot(driveLetter: string | null): string | null {
    return driveLetter ? `${driveLetter}:\\` : null;
}

export function normalizeWindowsPath(value: string): string {
    return path.win32.normalize(value.trim());
}

export function isWindowsPath(value: string): boolean {
    return /^[A-Z]:[\\/]/i.test(value) || /^\\\\/.test(value);
}

function parseWindowsVolume(value: unknown): Fat32Volume | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const volume = value as WindowsVolume;
    if (volume.FileSystem !== 'FAT32') {
        return null;
    }

    const driveLetter = nullableString(volume.DriveLetter);
    const path = getDriveRoot(driveLetter);
    if (!path) {
        return null;
    }

    return {
        label: nullableString(volume.FileSystemLabel),
        fileSystem: 'FAT32',
        source: path,
        sizeBytes: nullableNumber(volume.Size),
        freeBytes: nullableNumber(volume.SizeRemaining),
    };
}

export function parseWindowsFat32Volumes(stdout: string): Fat32Volume[] {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return [];
    }

    const parsed = JSON.parse(trimmed) as unknown;
    return toArray(parsed)
        .map(parseWindowsVolume)
        .filter((volume): volume is Fat32Volume => volume !== null);
}

export async function listMountedFat32Volumes(): Promise<Fat32Volume[]> {
    const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
            'Get-Volume',
            "Where-Object FileSystem -eq 'FAT32'",
            'Select-Object DriveLetter,FileSystemLabel,FileSystem,DriveType,HealthStatus,Size,SizeRemaining',
            'ConvertTo-Json -Compress',
        ].join(' | '),
    ]);

    return parseWindowsFat32Volumes(stdout);
}

export const listFat32Volumes = listMountedFat32Volumes;

export function appendWindowsSubpath(root: string, subpath: string): string {
    return path.win32.join(
        normalizeWindowsPath(normalizePath(root) ?? root),
        normalizeWindowsPath(normalizePath(subpath) ?? subpath)
    );
}

function getCopyDestinationPath(root: string, sourcePath: string): string {
    return appendWindowsSubpath(
        root,
        path.win32.basename(
            normalizeWindowsPath(sourcePath).replace(/\\+$/, '')
        )
    );
}

function parseRobocopyProgressPercent(text: string): number | null {
    const match = /(?<!\d)(\d{1,3})%(?!\d)/.exec(text);

    if (!match) {
        return null;
    }

    const value = Number(match[1]);

    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function parseRobocopySizeBytes(
    value: string,
    unit: string | undefined
): number | null {
    const normalizedValue = value.replaceAll(',', '');
    const amount = Number(normalizedValue);

    if (!Number.isFinite(amount)) {
        return null;
    }

    switch (unit?.toLowerCase()) {
        case 'k':
            return Math.round(amount * 1024);
        case 'm':
            return Math.round(amount * 1024 * 1024);
        case 'g':
            return Math.round(amount * 1024 * 1024 * 1024);
        case 't':
            return Math.round(amount * 1024 * 1024 * 1024 * 1024);
        default:
            return Math.round(amount);
    }
}

function getRobocopyRelativePath(
    filePath: string,
    sourcePath: string,
    destinationPath: string
): string {
    const normalizedFilePath = normalizeWindowsPath(filePath);
    const roots = [
        normalizeWindowsPath(sourcePath),
        normalizeWindowsPath(destinationPath),
    ];

    for (const root of roots) {
        const relative = path.win32.relative(root, normalizedFilePath);

        if (
            relative &&
            !relative.startsWith('..') &&
            !path.win32.isAbsolute(relative)
        ) {
            return relative;
        }
    }

    return filePath;
}

export function parseRobocopyOutput(
    text: string,
    context: CopyOutputParseContext
): CopyProgressUpdate | null {
    const progress = parseRobocopyProgressPercent(text);

    const lines = text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of [...lines].reverse()) {
        const fileMatch =
            /\b(New File|Newer|Changed|Older|Extra File)\s+([\d,]+(?:\.\d+)?)(?:\s*([kmgt])b?)?\s+(.+)$/i.exec(
                line
            );

        if (!fileMatch) {
            continue;
        }

        const [, status, size, unit, filePath] = fileMatch;
        const normalizedStatus = status.toLowerCase();

        if (normalizedStatus === 'older' || normalizedStatus === 'extra file') {
            continue;
        }

        const currentSizeBytes = parseRobocopySizeBytes(size, unit);
        const currentFilePath = getRobocopyRelativePath(
            filePath.trim(),
            context.sourcePath,
            context.destinationPath
        );

        return {
            progress,
            message: `${status} ${currentFilePath}`,
            currentSizeBytes,
            currentFilePath,
            completedFile: true,
        };
    }

    if (progress !== null) {
        return {
            progress,
            message: null,
            currentSizeBytes: null,
            currentFilePath: null,
            completedFile: false,
        };
    }

    return null;
}

export function cancelCopy({
    pid,
}: CancelCopyOptions): Promise<CancelCopyCommand> {
    return Promise.resolve({
        tool: 'taskkill.exe',
        command: 'taskkill.exe',
        args: ['/PID', String(pid), '/T', '/F'],
        reason: 'terminate robocopy process tree',
        successExitCodes: [0],
    });
}

export function copyPath({
    sourcePath,
    destination,
    move = false,
}: CopyPathOptions): Promise<CopyPathCommand> {
    if (!destination.source) {
        throw new Error('Destination does not have a Windows path.');
    }

    return Promise.resolve({
        tool: 'robocopy.exe',
        command: 'robocopy.exe',
        args: [
            normalizeWindowsPath(sourcePath),
            getCopyDestinationPath(destination.source, sourcePath),
            '/E',
            '/COPY:DAT',
            '/DCOPY:DAT',
            '/ETA',
            '/MT:16',
            '/BYTES',
            ...(move ? ['/MOVE'] : []),
        ],
        reason: 'source and destination are Windows paths',
        successExitCodes: [0, 1, 2, 3, 4, 5, 6, 7],
        parseOutput: parseRobocopyOutput,
    });
}

export const windows: OsOperations = {
    copyPath,
    cancelCopy,
    listFat32Volumes,
};
