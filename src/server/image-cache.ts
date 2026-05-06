import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { getUserAppRoot } from './paths.js';

export type CachedImage = {
    body: Buffer;
    contentType: string;
};

const imageCacheDir = path.join(getUserAppRoot(), '.cache', 'images');
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const META_SUFFIX = '.json';
const MAX_REDIRECTS = 5;
const inFlightImages = new Map<string, Promise<CachedImage>>();

function cacheKey(url: string): string {
    return createHash('sha256').update(url).digest('hex');
}

async function readBodyWithLimit(
    response: Response,
    url: string
): Promise<Buffer> {
    if (!response.body) {
        throw new Error(`image fetch returned no body for ${url}`);
    }

    const reader =
        response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            total += value.length;
            if (total > MAX_BODY_BYTES) {
                throw new Error(
                    `image exceeded ${MAX_BODY_BYTES.toString()} bytes: ${url}`
                );
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(chunks, total);
}

function isRedirectStatus(status: number): boolean {
    return status >= 300 && status < 400;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function readNodeResponseWithLimit(
    response: IncomingMessage,
    url: string
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;

        response.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                response.destroy(
                    new Error(
                        `image exceeded ${MAX_BODY_BYTES.toString()} bytes: ${url}`
                    )
                );
                return;
            }
            chunks.push(chunk);
        });

        response.on('end', () => {
            resolve(Buffer.concat(chunks, total));
        });
        response.on('error', reject);
    });
}

function fetchImageInsecure(
    url: string,
    redirectsRemaining = MAX_REDIRECTS
): Promise<CachedImage> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const request =
            parsed.protocol === 'https:'
                ? https.get(
                      parsed,
                      { rejectUnauthorized: false },
                      (response) => {
                          void handleResponse(response);
                      }
                  )
                : client.get(parsed, (response) => {
                      void handleResponse(response);
                  });

        const timeout = setTimeout(() => {
            request.destroy(
                new Error(
                    `image fetch timed out after ${FETCH_TIMEOUT_MS.toString()}ms for ${url}`
                )
            );
        }, FETCH_TIMEOUT_MS);

        async function handleResponse(
            response: IncomingMessage
        ): Promise<void> {
            const statusCode = response.statusCode ?? 0;

            if (isRedirectStatus(statusCode) && response.headers.location) {
                response.resume();
                if (redirectsRemaining <= 0) {
                    reject(new Error(`too many redirects fetching ${url}`));
                    return;
                }
                const nextUrl = new URL(response.headers.location, url);
                try {
                    resolve(
                        await fetchImageInsecure(
                            nextUrl.toString(),
                            redirectsRemaining - 1
                        )
                    );
                } catch (error) {
                    reject(toError(error));
                }
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(
                    new Error(
                        `image fetch failed for ${url}: ${statusCode.toString()}`
                    )
                );
                return;
            }

            try {
                const body = await readNodeResponseWithLimit(response, url);
                const contentTypeHeader = response.headers['content-type'] as
                    | string
                    | string[]
                    | undefined;
                const contentType = Array.isArray(contentTypeHeader)
                    ? (contentTypeHeader[0] ?? 'application/octet-stream')
                    : (contentTypeHeader ?? 'application/octet-stream');
                resolve({ body, contentType });
            } catch (error) {
                reject(toError(error));
            }
        }

        request.on('error', reject);
        request.on('close', () => {
            clearTimeout(timeout);
        });
    });
}

async function fetchImage(url: string): Promise<CachedImage> {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
    }).catch((error: unknown) => {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:') {
            return fetchImageInsecure(url);
        }
        throw new Error(`image fetch failed for ${url}`, { cause: error });
    });

    if (!(response instanceof Response)) {
        return response;
    }

    if (!response.ok) {
        throw new Error(
            `image fetch failed for ${url}: ${response.status.toString()}`
        );
    }

    const body = await readBodyWithLimit(response, url);
    const contentType =
        response.headers.get('content-type') ?? 'application/octet-stream';

    return { body, contentType };
}

async function writeFile(
    targetPath: string,
    data: Buffer | string
): Promise<void> {
    const tempPath = `${targetPath}.${process.pid}.${Date.now().toString()}.tmp`;
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, targetPath);
}

async function readCachedImage(
    bodyFile: string,
    metaFile: string
): Promise<CachedImage | null> {
    try {
        const [body, metaText] = await Promise.all([
            fs.readFile(bodyFile),
            fs.readFile(metaFile, 'utf8').catch(() => null),
        ]);
        const meta = metaText
            ? (JSON.parse(metaText) as { contentType?: unknown })
            : null;
        const contentType =
            typeof meta?.contentType === 'string'
                ? meta.contentType
                : 'application/octet-stream';
        return { body, contentType };
    } catch {
        return null;
    }
}

async function fetchAndCacheImage(
    url: string,
    bodyFile: string,
    metaFile: string
): Promise<CachedImage> {
    const image = await fetchImage(url);

    await fs.mkdir(imageCacheDir, { recursive: true });
    await writeFile(bodyFile, image.body);
    await writeFile(
        metaFile,
        JSON.stringify({ contentType: image.contentType })
    );

    return image;
}

export async function getCachedImage(url: string): Promise<CachedImage> {
    const key = cacheKey(url);
    const bodyFile = path.join(imageCacheDir, key);
    const metaFile = `${bodyFile}${META_SUFFIX}`;

    const cached = await readCachedImage(bodyFile, metaFile);
    if (cached) {
        return cached;
    }

    const pending =
        inFlightImages.get(key) ??
        fetchAndCacheImage(url, bodyFile, metaFile).finally(() => {
            inFlightImages.delete(key);
        });
    inFlightImages.set(key, pending);
    return pending;
}
