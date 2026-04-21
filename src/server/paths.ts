import path from 'node:path';
import process from 'node:process';

export function getAppRoot(): string {
    const appRoot = process.env.APP_ROOT;
    if (appRoot && appRoot.length > 0) {
        return path.resolve(appRoot);
    }

    return path.dirname(process.execPath);
}
