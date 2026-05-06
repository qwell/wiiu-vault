import fs from 'node:fs';
import path from 'node:path';

import { getAppRoot, getUserAppRoot } from './paths.js';
import { type AppConfig, type AppConfigUpdate } from '../shared/config.js';
import logger from '../shared/logger.js';

const DEFAULT_SERVER_HOST = '127.0.0.1';
const DEFAULT_SERVER_PORT = 3000;
const DEFAULT_BROWSER_OPEN = true;
const DEFAULT_ROM_DIR = getUserAppRoot();

let currentConfig: AppConfig | null = null;
let currentConfigPath: string | null = null;

type WiiURootInspection = {
    normalizedRoot: string;
    exists: boolean;
    isDirectory: boolean;
    readable: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeWiiURoot(root: string): string {
    const resolvedRoot = path.resolve(root.trim());

    try {
        return fs.realpathSync.native(resolvedRoot);
    } catch {
        return resolvedRoot;
    }
}

async function inspectWiiURoot(root: string): Promise<WiiURootInspection> {
    const normalizedRoot = normalizeWiiURoot(root);

    try {
        const stats = await fs.promises.stat(normalizedRoot);
        if (!stats.isDirectory()) {
            return {
                normalizedRoot,
                exists: true,
                isDirectory: false,
                readable: false,
            };
        }

        try {
            await fs.promises.access(normalizedRoot, fs.constants.R_OK);
            return {
                normalizedRoot,
                exists: true,
                isDirectory: true,
                readable: true,
            };
        } catch {
            return {
                normalizedRoot,
                exists: true,
                isDirectory: true,
                readable: false,
            };
        }
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
        ) {
            return {
                normalizedRoot,
                exists: false,
                isDirectory: false,
                readable: false,
            };
        }

        throw error;
    }
}

function assertConfig(value: unknown): asserts value is AppConfig {
    if (!isObject(value)) {
        throw new Error('Config must be an object.');
    }

    if (
        'host' in value &&
        (typeof value.host !== 'string' || value.host.length === 0)
    ) {
        throw new Error('Config.host must be a non-empty string.');
    }

    if (
        'port' in value &&
        (typeof value.port !== 'number' || !Number.isInteger(value.port))
    ) {
        throw new Error('Config.port must be an integer.');
    }

    if ('openBrowser' in value && typeof value.openBrowser !== 'boolean') {
        throw new Error('Config.openBrowser must be a boolean.');
    }

    if (
        'wiiuRoots' in value &&
        (!Array.isArray(value.wiiuRoots) ||
            !value.wiiuRoots.every(
                (root) => typeof root === 'string' && root.length > 0
            ))
    ) {
        throw new Error(
            'Config.wiiuRoots must be an array of non-empty strings.'
        );
    }
}

function readWiiURoots(config: Record<string, unknown>): string[] {
    const roots: string[] = [];

    if (Array.isArray(config.wiiuRoots)) {
        for (const root of config.wiiuRoots) {
            if (typeof root !== 'string') {
                continue;
            }

            const trimmedRoot = root.trim();
            if (trimmedRoot.length === 0) {
                continue;
            }

            roots.push(normalizeWiiURoot(trimmedRoot));
        }
    }

    if (roots.length === 0) {
        roots.push(DEFAULT_ROM_DIR);
    }

    return [...new Set(roots)];
}

function getDefaultConfig(): AppConfig {
    return {
        host: DEFAULT_SERVER_HOST,
        port: DEFAULT_SERVER_PORT,
        openBrowser: DEFAULT_BROWSER_OPEN,
        wiiuRoots: [DEFAULT_ROM_DIR],
    };
}

function getConfigPathCandidates(): string[] {
    return [
        path.join(process.cwd(), 'config.json'),
        path.join(getAppRoot(), 'config.json'),
        path.join(getUserAppRoot(), 'config.json'),
    ].filter((candidate, index, candidates) => {
        return candidates.indexOf(candidate) === index;
    });
}

function resolveConfigPath(): string {
    if (currentConfigPath) {
        return currentConfigPath;
    }

    const existingPath = getConfigPathCandidates().find((candidate) =>
        fs.existsSync(candidate)
    );

    currentConfigPath =
        existingPath ?? path.join(getUserAppRoot(), 'config.json');

    return currentConfigPath;
}

function writeDefaultConfig(): void {
    const configPath = resolveConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
        configPath,
        `${JSON.stringify(getDefaultConfig(), null, 4)}\n`
    );
    logger.log('server', `Created config at ${configPath}`);
}

function writeConfig(config: AppConfig): void {
    const configPath = resolveConfigPath();
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`);
    logger.log('server', `Saved config to ${configPath}`);
}

export function loadConfig(): AppConfig {
    if (currentConfig) {
        return currentConfig;
    }

    const configPath = resolveConfigPath();

    if (!fs.existsSync(configPath)) {
        writeDefaultConfig();
    }

    logger.log('server', `Loaded config from ${configPath}`);

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    assertConfig(parsed);

    currentConfig = {
        ...parsed,
        host: parsed.host ?? DEFAULT_SERVER_HOST,
        port: parsed.port ?? DEFAULT_SERVER_PORT,
        openBrowser: parsed.openBrowser ?? DEFAULT_BROWSER_OPEN,
        wiiuRoots: readWiiURoots(parsed),
    };

    return currentConfig;
}

export function getConfig(): AppConfig {
    return currentConfig ?? loadConfig();
}

export async function validateWiiURoot(root: string): Promise<{
    exists: boolean;
    isDirectory: boolean;
    readable: boolean;
    message: string;
}> {
    const normalizedRoot = root.trim();

    if (normalizedRoot.length === 0) {
        return {
            exists: false,
            isDirectory: false,
            readable: false,
            message: 'Path is empty.',
        };
    }

    const inspection = await inspectWiiURoot(normalizedRoot);

    if (!inspection.exists) {
        return {
            exists: false,
            isDirectory: false,
            readable: false,
            message: 'Path does not exist.',
        };
    }

    if (!inspection.isDirectory) {
        return {
            exists: true,
            isDirectory: false,
            readable: false,
            message: 'Path exists but is not a directory.',
        };
    }

    return {
        exists: true,
        isDirectory: true,
        readable: inspection.readable,
        message: inspection.readable
            ? 'Path exists and is readable.'
            : 'Directory exists but is not readable.',
    };
}

export function saveConfig(update: AppConfigUpdate): {
    config: AppConfig;
    restartRequired: boolean;
} {
    const previous = getConfig();
    const next: AppConfig = {
        ...previous,
        ...update,
        wiiuRoots:
            update.wiiuRoots === undefined
                ? previous.wiiuRoots
                : readWiiURoots(update),
    };

    assertConfig(next);
    writeConfig(next);
    currentConfig = next;

    return {
        config: next,
        restartRequired:
            previous.host !== next.host || previous.port !== next.port,
    };
}
