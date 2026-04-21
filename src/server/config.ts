import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getAppRoot } from './paths.js';

type ServerConfig = {
    server: {
        host: string;
        port: number;
    };
    roms: {
        wiiuRoot: string;
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

    if (typeof server.host !== 'string' || server.host.length === 0) {
        throw new Error('Config.server.host must be a non-empty string.');
    }

    if (typeof server.port !== 'number' || !Number.isInteger(server.port)) {
        throw new Error('Config.server.port must be an integer.');
    }

    if (typeof roms.wiiuRoot !== 'string' || roms.wiiuRoot.length === 0) {
        throw new Error('Config.roms.wiiuRoot must be a non-empty string.');
    }
}

export function loadConfig(): ServerConfig {
    const configPath = path.join(getAppRoot(), 'config.json');
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    assertConfig(parsed);

    return parsed;
}
