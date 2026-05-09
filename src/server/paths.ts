import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function getUserAppRoot(): string {
    return path.join(os.homedir(), '.wiiu-vault');
}

export function getAppRoot(metaUrl: string): string {
    const appRoot = process.env.APP_ROOT;
    if (appRoot && appRoot.length > 0) {
        return path.resolve(appRoot);
    }

    return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..');
}
