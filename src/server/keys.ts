import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readOptionalFile } from '../shared/file.js';
import logger from '../shared/logger.js';
import { TitlePlatform } from '../shared/titles.js';
import { formatLogError } from '../shared/utils.js';
import { readP12ClientCertificate } from './decryption.js';
import { downloadBytes, type DownloadOptions } from './download.js';
import { getUserAppRoot } from './paths.js';

export type ThreeDSKeys = {
    generatorConstant: string;
    slot0x18KeyX: string | null;
    slot0x1bKeyX: string | null;
    slot0x25KeyX: string | null;
    slot0x2cKeyX: string | null;
    slot0x3dKeyX: string | null;
    commonKeyYs: Array<string | null>;
};

export type WiiUCommonKey = string;
export type WudKey = string;
export type ThreeDSClientCertificateOptions = DownloadOptions & {
    cert: string;
    key: string;
};

type CachedKeysOptions<Keys> = {
    platform: '3ds' | 'wiiu';
    cacheFilename: keyof typeof DOWNLOAD_URLS;
    parse: (raw: Buffer, source: string) => Keys;
};

const KEYS_DOWNLOAD_TIMEOUT_MS = 30_000;
const KEYS_MAX_SIZE = 1024 * 1024;
const THREE_DS_CLIENT_CERT_CACHE_FILENAME = 'ctr-common-1.p12';
const THREE_DS_CLIENT_CERT_PASSWORD = 'alpine';
const THREE_DS_KEYS_CACHE_FILENAME = 'aes_keys.txt';
const WII_U_KEYS_CACHE_FILENAME = 'common.key';
const COMMON_KEYS = {
    wii: ['6+QqIl6Fk+RI2cVFc4Gq9w=='],
    'wii-korea': ['Y7grtPRhTi4T8v77ukybfg=='],
} as const;
const DOWNLOAD_URLS = {
    [THREE_DS_CLIENT_CERT_CACHE_FILENAME]: [
        'aHR0cHM6Ly9naXRodWIuY29tL2xhcnNlbnYvTmludGVuZG9DZXJ0cy9yYXcvcmVmcy9oZWFkcy9tYXN0ZXIvY3RyLWNvbW1vbi0xLnAxMg==',
        'aHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vcXdlbGwvNDViYTdkMmYzMDVkZTcyYTgxZGI5ZDc1MTkwODExN2EvcmF3L2I5NjY4ZTE0ZDY3YzQ3YTQzOTNiZmQ0NjRmMjE5YzExYTRlZDE3YjEvY3RyLWNvbW1vbi0xLnAxMg==',
        'aHR0cHM6Ly93ZWIuYXJjaGl2ZS5vcmcvd2ViLzIwMjYwNzA3MjA0MTM5aWZfL2h0dHBzOi8vcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbS9sYXJzZW52L05pbnRlbmRvQ2VydHMvcmVmcy9oZWFkcy9tYXN0ZXIvY3RyLWNvbW1vbi0xLnAxMg==',
        'aHR0cHM6Ly93ZWIuYXJjaGl2ZS5vcmcvd2ViLzIwMjYwNzMxMjAxNzM0aWZfL2h0dHBzOi8vZ2lzdC5naXRodWJ1c2VyY29udGVudC5jb20vcXdlbGwvNDViYTdkMmYzMDVkZTcyYTgxZGI5ZDc1MTkwODExN2EvcmF3L2I5NjY4ZTE0ZDY3YzQ3YTQzOTNiZmQ0NjRmMjE5YzExYTRlZDE3YjEvY3RyLWNvbW1vbi0xLnAxMg==',
    ],
    [THREE_DS_KEYS_CACHE_FILENAME]: [
        'aHR0cHM6Ly9naXRodWIuY29tL0FiZGVzcy9yZXRyb2Jpb3MvcmF3L3JlZnMvaGVhZHMvbWFpbi9iaW9zL05pbnRlbmRvLzNEUy9hZXNfa2V5cy50eHQ=',
        'aHR0cHM6Ly93ZWIuYXJjaGl2ZS5vcmcvd2ViLzIwMjYwNzA3MjEwNjA3aWZfL2h0dHBzOi8vZ2l0aHViLmNvbS9BYmRlc3MvcmV0cm9iaW9zL3JlZnMvaGVhZHMvbWFpbi9iaW9zL05pbnRlbmRvLzNEUy9hZXNfa2V5cy50eHQ=',
        'aHR0cHM6Ly9wYXN0ZWJpbi5jb20vcmF3L3ZSeThjNkpQ',
        'aHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vcXdlbGwvNDViYTdkMmYzMDVkZTcyYTgxZGI5ZDc1MTkwODExN2EvcmF3L2I5NjY4ZTE0ZDY3YzQ3YTQzOTNiZmQ0NjRmMjE5YzExYTRlZDE3YjEvYWVzX2tleXMudHh0',
        'aHR0cHM6Ly93ZWIuYXJjaGl2ZS5vcmcvd2ViLzIwMjYwNzMxMTg0MTAyaWZfL2h0dHBzOi8vZ2lzdC5naXRodWJ1c2VyY29udGVudC5jb20vcXdlbGwvNDViYTdkMmYzMDVkZTcyYTgxZGI5ZDc1MTkwODExN2EvcmF3L2I5NjY4ZTE0ZDY3YzQ3YTQzOTNiZmQ0NjRmMjE5YzExYTRlZDE3YjEvYWVzX2tleXMudHh0',
    ],
    [WII_U_KEYS_CACHE_FILENAME]: [
        'aHR0cHM6Ly9naXN0LmdpdGh1YnVzZXJjb250ZW50LmNvbS9FbXJhbkFobTNkL2JkN2E3OTFkMDI5NzVkNzE4NmQwYzA1NTRmM2NmNmVhL3Jhdy8xYzM4MzM1ZjJhNzFhYjQyNDVkMjM3NjE4YzRmYWZlNjcwZWUzZTgyL3dpaXVjb21tb29ua2V5LnR4dA==',
        'aHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vcXdlbGwvNDViYTdkMmYzMDVkZTcyYTgxZGI5ZDc1MTkwODExN2EvcmF3L2I5NjY4ZTE0ZDY3YzQ3YTQzOTNiZmQ0NjRmMjE5YzExYTRlZDE3YjEvY29tbW9uLmtleQ==',
        'aHR0cHM6Ly93ZWIuYXJjaGl2ZS5vcmcvd2ViLzIwMjYwNzMxMjAxMTEzaWZfL2h0dHBzOi8vZ2lzdC5naXRodWJ1c2VyY29udGVudC5jb20vcXdlbGwvNDViYTdkMmYzMDVkZTcyYTgxZGI5ZDc1MTkwODExN2EvcmF3L2I5NjY4ZTE0ZDY3YzQ3YTQzOTNiZmQ0NjRmMjE5YzExYTRlZDE3YjEvY29tbW9uLmtleQ==',
    ],
} as const;
const THREE_DS_AES_KEY_NAMES = {
    generatorConstant: ['generatorConstant', 'generator'],
    slot0x18KeyX: ['slot0x18KeyX'],
    slot0x1bKeyX: ['slot0x1BKeyX'],
    slot0x25KeyX: ['slot0x25KeyX'],
    slot0x2cKeyX: ['slot0x2CKeyX'],
    slot0x3dKeyX: ['slot0x3DKeyX'],
} as const;

const keysPromises = new Map<string, Promise<unknown>>();

export function loadThreeDSClientCertificateOptions(): Promise<ThreeDSClientCertificateOptions> {
    return memoizeKeys('3ds-client-certificate', () =>
        loadCachedKeys({
            platform: '3ds',
            cacheFilename: THREE_DS_CLIENT_CERT_CACHE_FILENAME,
            parse: parseThreeDSClientCertificate,
        })
    );
}

export function loadThreeDSKeys(): Promise<ThreeDSKeys> {
    return memoizeKeys('3ds', () =>
        loadCachedKeys({
            platform: '3ds',
            cacheFilename: THREE_DS_KEYS_CACHE_FILENAME,
            parse: parseThreeDSKeys,
        })
    );
}

export function loadWiiUCommonKey(): Promise<WiiUCommonKey> {
    return memoizeKeys('wiiu', () =>
        loadCachedKeys({
            platform: 'wiiu',
            cacheFilename: WII_U_KEYS_CACHE_FILENAME,
            parse: parseWiiUCommonKey,
        })
    );
}

export function loadWiiCommonKeys(): Buffer[] {
    return [COMMON_KEYS.wii[0], COMMON_KEYS['wii-korea'][0]].map((key) =>
        Buffer.from(key, 'base64')
    );
}

export function loadWudKey(inputPath: string): Promise<WudKey | null> {
    const imagePath = path.resolve(inputPath);
    return memoizeKeys(
        `wud:${imagePath}`,
        () => readWudKey(imagePath),
        (key) => key !== null
    );
}

function parseThreeDSClientCertificate(
    p12: Buffer
): ThreeDSClientCertificateOptions {
    const { cert, key } = readP12ClientCertificate(
        p12,
        THREE_DS_CLIENT_CERT_PASSWORD
    );
    return { cert, key, allowSelfSignedCertificate: true };
}

async function readWudKey(imagePath: string): Promise<WudKey | null> {
    const candidates = getWudKeyCandidates(imagePath);
    for (const candidate of candidates) {
        const raw = await readOptionalFile(candidate);
        if (raw) {
            const key = parseWudKey(raw);
            if (key) {
                return key;
            }
        }
    }

    return null;
}

function parseThreeDSKeys(raw: Buffer): ThreeDSKeys {
    const entries = new Map<string, string>();
    for (const line of Buffer.from(raw).toString('utf8').split(/\r?\n/)) {
        const match = /^([^=#\s]+)\s*=\s*([0-9a-fA-F]{32})\s*$/.exec(
            line.trim()
        );
        if (match) {
            entries.set(match[1], match[2].toLowerCase());
        }
    }

    const readNamedKey = (names: readonly string[]): string | null => {
        for (const name of names) {
            const key = entries.get(name);
            if (key) {
                return key;
            }
        }
        return null;
    };
    const generatorConstant = readNamedKey(
        THREE_DS_AES_KEY_NAMES.generatorConstant
    );
    if (!generatorConstant) {
        throw new Error('3DS keys are missing the generator constant');
    }

    return {
        generatorConstant,
        slot0x18KeyX: readNamedKey(THREE_DS_AES_KEY_NAMES.slot0x18KeyX),
        slot0x1bKeyX: readNamedKey(THREE_DS_AES_KEY_NAMES.slot0x1bKeyX),
        slot0x25KeyX: readNamedKey(THREE_DS_AES_KEY_NAMES.slot0x25KeyX),
        slot0x2cKeyX: readNamedKey(THREE_DS_AES_KEY_NAMES.slot0x2cKeyX),
        slot0x3dKeyX: readNamedKey(THREE_DS_AES_KEY_NAMES.slot0x3dKeyX),
        commonKeyYs: Array.from({ length: 6 }, (_, index) =>
            readNamedKey([`common${index.toString()}`])
        ),
    };
}

function parseWiiUCommonKey(raw: Buffer): WiiUCommonKey {
    if (raw.length === 16) {
        return Buffer.from(raw).toString('hex');
    }
    const text = Buffer.from(raw).toString('utf8').trim();
    const compact = text.replace(/\s+/g, '');
    const keyBytes = /^[\da-fA-F]{32}$/.test(compact)
        ? Buffer.from(compact, 'hex')
        : null;
    if (!keyBytes || keyBytes.length !== 16) {
        throw new Error('Invalid Wii U common key');
    }
    return Buffer.from(keyBytes).toString('hex');
}

function parseWudKey(raw: Buffer): WudKey | null {
    if (raw.length === 16) {
        return Buffer.from(raw).toString('hex');
    }
    const text = Buffer.from(raw).toString('utf8');
    const compact = text.trim().replace(/\s+/g, '');
    const hex = /^[0-9a-f]{32}$/i.test(compact)
        ? compact
        : (text.match(/[0-9a-f]{32}/i)?.[0] ?? null);
    return hex?.toLowerCase() ?? null;
}

function memoizeKeys<Keys>(
    cacheKey: string,
    load: () => Promise<Keys>,
    isCacheable: (keys: Keys) => boolean = () => true
): Promise<Keys> {
    const existing = keysPromises.get(cacheKey) as Promise<Keys> | undefined;
    if (existing) {
        return existing;
    }

    const pending = load();
    keysPromises.set(cacheKey, pending);
    void pending.then(
        (keys) => {
            if (!isCacheable(keys) && keysPromises.get(cacheKey) === pending) {
                keysPromises.delete(cacheKey);
            }
        },
        () => {
            if (keysPromises.get(cacheKey) === pending) {
                keysPromises.delete(cacheKey);
            }
        }
    );
    return pending;
}

async function loadCachedKeys<Keys>({
    platform,
    cacheFilename,
    parse,
}: CachedKeysOptions<Keys>): Promise<Keys> {
    const platformName = TitlePlatform[platform];
    const cacheRoot = getUserAppRoot();
    const cachePath = path.join(cacheRoot, cacheFilename);
    const errors: string[] = [];
    const cached = await readOptionalFile(cachePath);
    if (cached) {
        try {
            return parse(cached, cachePath);
        } catch (error) {
            errors.push(`${cachePath}: ${formatLogError(error)}`);
        }
    }

    for (const [index, downloadUrl] of getKeyUrls(cacheFilename).entries()) {
        try {
            const downloadedFile = await downloadBytes(
                downloadUrl,
                cacheFilename,
                {
                    signal: AbortSignal.timeout(KEYS_DOWNLOAD_TIMEOUT_MS),
                    logDownload: false,
                }
            );
            if (
                downloadedFile.length === 0 ||
                downloadedFile.length > KEYS_MAX_SIZE
            ) {
                throw new Error(
                    `invalid response size ${downloadedFile.length}`
                );
            }
            const keys = parse(downloadedFile, downloadUrl);
            await writeKeyFile(cacheRoot, cachePath, downloadedFile);
            logger.log(
                'metadata',
                `Saved ${platformName} ${cacheFilename} to ${cachePath}`
            );
            return keys;
        } catch (error) {
            errors.push(`source ${index + 1}: ${formatLogError(error)}`);
        }
    }

    throw new Error(
        `Failed to load ${platformName} ${cacheFilename}: ${errors.join('; ')}`
    );
}

export function getKeyUrls(
    cacheFilename: keyof typeof DOWNLOAD_URLS
): string[] {
    return DOWNLOAD_URLS[cacheFilename].map((url) =>
        Buffer.from(url, 'base64').toString('utf8')
    );
}

async function writeKeyFile(
    directory: string,
    filePath: string,
    contents: Buffer
): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, contents);
    await fs.rename(temporaryPath, filePath);
}

function getWudKeyCandidates(imagePath: string): string[] {
    const parsed = path.parse(imagePath);
    return [
        path.join(parsed.dir, `${parsed.name}.key`),
        path.join(parsed.dir, 'game.key'),
    ];
}
