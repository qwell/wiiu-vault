import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import https from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError } from '../shared/download.js';
import logger from '../shared/logger.js';

export type DownloadOptions = {
    signal?: AbortSignal;
    cert?: string;
    key?: string;
    pfx?: Buffer;
    passphrase?: string;
    allowSelfSignedCertificate?: boolean;
    logDownload?: boolean;
    headers?: Record<string, string>;
};

export async function downloadBytes(
    url: string,
    label = 'file',
    options: DownloadOptions = {}
): Promise<Buffer> {
    if (options.logDownload !== false) {
        logger.log('download', `downloading ${label}: ${url}`);
    }
    const response = await fetchDownload(url, options);
    if (!response.ok) {
        throw new HttpError(url, response.status);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (options.logDownload !== false) {
        logger.log(
            'download',
            `downloaded ${label}: ${url} (${bytes.length.toString()} bytes)`
        );
    }
    return bytes;
}

export async function downloadFile(
    url: string,
    targetFile: string,
    label = 'file',
    options: DownloadOptions = {}
): Promise<void> {
    if (options.logDownload !== false) {
        logger.log('download', `downloading ${label}: ${url}`);
    }
    const response = await fetchDownload(url, options);
    if (!response.ok) {
        throw new HttpError(url, response.status);
    }
    if (!response.body) {
        throw new Error(`download failed for ${url}: empty response body`);
    }

    const tempFile = `${targetFile}.${process.pid.toString()}.${randomUUID()}.download`;
    try {
        await pipeline(
            Readable.fromWeb(response.body),
            createWriteStream(tempFile),
            { signal: options.signal }
        );
        await rename(tempFile, targetFile);
    } catch (error) {
        await rm(tempFile, { force: true });
        throw error;
    }

    if (options.logDownload !== false) {
        const { size } = await stat(targetFile);
        logger.log(
            'download',
            `downloaded ${label}: ${url} (${size.toString()} bytes)`
        );
    }
}

async function fetchDownload(
    url: string,
    options: DownloadOptions
): Promise<Response> {
    return options.cert ||
        options.pfx ||
        options.allowSelfSignedCertificate === true
        ? fetchWithHttpsOptions(url, options)
        : fetch(url, {
              signal: options.signal,
              headers: options.headers,
          });
}

async function fetchWithHttpsOptions(
    url: string,
    options: DownloadOptions
): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        return fetch(url, {
            signal: options.signal,
            headers: options.headers,
        });
    }

    if (options.signal?.aborted) {
        throw createAbortError(options.signal);
    }

    return new Promise<Response>((resolve, reject) => {
        const request = https.get(
            parsed,
            {
                rejectUnauthorized: options.allowSelfSignedCertificate !== true,
                cert: options.cert,
                key: options.key,
                pfx: options.pfx,
                passphrase: options.passphrase,
                headers: options.headers,
            },
            (response) => {
                const status = response.statusCode;
                if (status === undefined) {
                    response.destroy();
                    reject(
                        new Error(
                            `Response had no status while downloading ${url}`
                        )
                    );
                    return;
                }

                const body =
                    request.method === 'HEAD' ||
                    [204, 205, 304].includes(status)
                        ? null
                        : (Readable.toWeb(
                              response
                          ) as ReadableStream<Uint8Array>);
                resolve(
                    new Response(body, {
                        headers: Object.fromEntries(
                            Object.entries(response.headers).flatMap(
                                ([name, value]) =>
                                    value === undefined
                                        ? []
                                        : [[name, toHeaderValue(value)]]
                            )
                        ),
                        status,
                        statusText: response.statusMessage,
                    })
                );
            }
        );

        const abort = (): void => {
            request.destroy(createAbortError(options.signal));
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        request.once('close', () => {
            options.signal?.removeEventListener('abort', abort);
        });
        request.on('error', reject);
    });
}

function toHeaderValue(value: string | string[]): string {
    return Array.isArray(value) ? value.join(', ') : value;
}

function createAbortError(signal?: AbortSignal): Error {
    const error = new Error('Aborted', {
        cause: signal?.reason as unknown,
    });
    error.name = 'AbortError';
    return error;
}
