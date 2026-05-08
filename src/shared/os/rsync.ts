import path from 'node:path';

import type { CopyOutputParseContext, CopyProgressUpdate } from './types.js';

function parseRsyncProgressPercent(text: string): number | null {
    const match = /(?<!\d)(\d{1,3})%(?!\d)/.exec(text);
    if (!match) {
        return null;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function getRsyncRelativePath(
    filePath: string,
    sourcePath: string,
    destinationPath: string
): string {
    const normalizedFilePath = path.posix.normalize(filePath);
    const roots = [
        path.posix.normalize(sourcePath),
        path.posix.normalize(destinationPath),
    ];

    for (const root of roots) {
        const relative = path.posix.relative(root, normalizedFilePath);
        if (
            relative &&
            !relative.startsWith('..') &&
            !path.posix.isAbsolute(relative)
        ) {
            return relative;
        }
    }

    return filePath;
}

export function parseRsyncOutput(
    text: string,
    context: CopyOutputParseContext
): CopyProgressUpdate | null {
    const progress = parseRsyncProgressPercent(text);

    const lines = text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines.toReversed()) {
        if (
            /^\d/.test(line) ||
            /^sent\s+/i.test(line) ||
            /^total size is/i.test(line) ||
            /^speedup is/i.test(line)
        ) {
            continue;
        }

        return {
            progress,
            message: getRsyncRelativePath(
                line,
                context.sourcePath,
                context.destinationPath
            ),
            currentSizeBytes: null,
            currentFilePath: line,
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
