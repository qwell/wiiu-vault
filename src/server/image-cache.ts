import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import { getAppRoot } from './paths.js';

export type CachedImage = {
    body: Buffer;
};

const imageCacheDir = path.join(getAppRoot(), '.cache', 'images');

function cacheKey(url: string): string {
    return createHash('sha256').update(url).digest('hex');
}

function fetchImage(url: string): Promise<CachedImage> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const client = parsed.protocol === 'https:' ? https : http;
        const request = client.get(parsed, (response) => {
            const statusCode = response.statusCode ?? 0;

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(
                    new Error(`image fetch failed for ${url}: ${statusCode}`)
                );
                return;
            }

            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
                resolve({
                    body: Buffer.concat(chunks),
                });
            });
        });

        request.on('error', reject);
    });
}

export async function getCachedImage(url: string): Promise<CachedImage> {
    const key = cacheKey(url);
    const bodyFile = path.join(imageCacheDir, key);
    try {
        const body = await fs.readFile(bodyFile);
        return {
            body,
        };
    } catch {
        // Cache misses fall through to the network.
    }

    const image = await fetchImage(url);

    await fs.mkdir(imageCacheDir, { recursive: true });
    await fs.writeFile(bodyFile, image.body);

    return image;
}
