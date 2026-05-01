import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getAppRoot } from './paths.js';

const DEFAULT_SERVER_HOST = '127.0.0.1';
const DEFAULT_SERVER_PORT = 3000;

type ServerConfig = {
    server: {
        host: string;
        port: number;
        openBrowser: boolean;
    };
    roms: {
        wiiuRoots: string[];
    };
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function assertConfig(value: unknown): asserts value is ServerConfig {
    if (!isObject(value)) {
        throw new Error('Config must be an object.');
    }

    const server = value.server;
    const roms = value.roms;

    if (!isObject(server)) {
        throw new Error('Config.server must be an object.');
    }

    if (!isObject(roms)) {
        throw new Error('Config.roms must be an object.');
    }

    if (
        'host' in server &&
        (typeof server.host !== 'string' || server.host.length === 0)
    ) {
        throw new Error('Config.server.host must be a non-empty string.');
    }

    if (
        'port' in server &&
        (typeof server.port !== 'number' || !Number.isInteger(server.port))
    ) {
        throw new Error('Config.server.port must be an integer.');
    }

    if ('openBrowser' in server && typeof server.openBrowser !== 'boolean') {
        throw new Error('Config.server.openBrowser must be a boolean.');
    }

    if (
        'wiiuRoot' in roms &&
        (typeof roms.wiiuRoot !== 'string' || roms.wiiuRoot.length === 0)
    ) {
        throw new Error('Config.roms.wiiuRoot must be a non-empty string.');
    }

    if (
        'wiiuRoots' in roms &&
        (!Array.isArray(roms.wiiuRoots) ||
            !roms.wiiuRoots.every(
                (root) => typeof root === 'string' && root.length > 0
            ))
    ) {
        throw new Error(
            'Config.roms.wiiuRoots must be an array of non-empty strings.'
        );
    }

    if (!('wiiuRoot' in roms) && !('wiiuRoots' in roms)) {
        throw new Error('Config.roms.wiiuRoot or wiiuRoots must be set.');
    }
}

function readWiiURoots(roms: Record<string, unknown>): string[] {
    const roots: string[] = [];

    if (typeof roms.wiiuRoot === 'string') {
        roots.push(roms.wiiuRoot);
    }

    if (Array.isArray(roms.wiiuRoots)) {
        roots.push(
            ...roms.wiiuRoots.filter(
                (root): root is string => typeof root === 'string'
            )
        );
    }

    return [...new Set(roots)];
}

export function loadConfig(): ServerConfig {
    const configPath = path.join(getAppRoot(), 'config.json');
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    assertConfig(parsed);

    return {
        ...parsed,
        server: {
            ...parsed.server,
            host: parsed.server.host ?? DEFAULT_SERVER_HOST,
            port: parsed.server.port ?? DEFAULT_SERVER_PORT,
            openBrowser: parsed.server.openBrowser ?? true,
        },
        roms: {
            ...parsed.roms,
            wiiuRoots: readWiiURoots(parsed.roms),
        },
    };
}
