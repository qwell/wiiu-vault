import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { parse as CsvParse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';

import { normalizeRegion } from '../src/shared/regions.js';

type Title = {
    titleId: string;
    name: string | null;
    region: string | null;
    productCode: string | null;
    companyCode: string | null;
    iconUrl: string | null;
    updates: number[];
    dlc: number[];
    availableOnCdn?: 'Yes' | 'No';
};

type Icon = {
    titleId: string;
    iconUrl: string;
};

type TitleAllResponse = {
    titleId?: string;
    name?: string | null;
    region?: string | null;
    productCode?: string | null;
    companyCode?: string | null;
    updates?: number[];
    dlc?: number[];
};

type ChildMetadataResponse = {
    exists?: boolean;
    titleVersion?: number | null;
};

type CsvRow = Record<string, string>;

type SamuraiTitle = {
    '@id'?: string;
    icon_url?: string;
};

type SamuraiContent = {
    title?: SamuraiTitle;
};

type SamuraiResponse = {
    eshop?: {
        contents?: {
            content?: SamuraiContent | SamuraiContent[];
        };
    };
};

const root = process.cwd();
const titlesDir = path.join(root, 'titles');

const ranges = [
    '0005000010100000:0005000010220000',
    '000500001f600000:000500001f601f00',
    '000500001f700000:000500001f702f00',
    '000500001f800000:000500001f80ff00',
    '000500001f940e00:000500001f940f00',
    '000500001f943100:000500001f943100',
    '000500001fbf1000:000500001fbf1000',
];

const titleAllUrl = 'http://localhost:3000/api/title-all?titleId=%s';
const updateMetadataUrl = 'http://localhost:3000/api/title-update?titleId=%s';
const dlcMetadataUrl = 'http://localhost:3000/api/title-dlc?titleId=%s';
const samuraiContentsUrl =
    'https://samurai.wup.shop.nintendo.net/samurai/ws/US/contents/?shop_id=2&limit=10000';

const parallel = Number.parseInt(process.env.parallel ?? '16', 10);

const titlesFile = path.join(titlesDir, 'titles.json');
const extraFile = path.join(titlesDir, 'extra.json');
const iconsFile = path.join(titlesDir, 'icons.json');
const excludeFile = path.join(titlesDir, 'exclude.json');
const titledbFile = path.join(titlesDir, 'titledb.csv');

function formatUrl(template: string, titleId: string): string {
    return template.replace('%s', titleId);
}

function stringFieldRecord<K extends string>(
    value: unknown,
    keys: readonly K[]
): value is Record<K, string> {
    return (
        typeof value === 'object' &&
        value !== null &&
        keys.every(
            (key) => typeof (value as Record<string, unknown>)[key] === 'string'
        )
    );
}

function toArray<T>(value: T | readonly T[] | null | undefined): T[] {
    if (value == null) {
        return [];
    }

    if (Array.isArray(value)) {
        return Array.from(value as readonly T[]);
    }

    return [value as T];
}

function normalizeTitleId(value: string): string | null {
    const titleIdPattern = /^[0-9a-f]{16}$/;
    const titleId = value.toLowerCase();

    return titleIdPattern.test(titleId) ? titleId : null;
}

function titleIdSet(entries: unknown[]): Set<string> {
    const titleIds = new Set<string>();

    for (const entry of entries) {
        if (stringFieldRecord(entry, ['titleId'])) {
            const titleId = normalizeTitleId(entry.titleId);
            if (titleId !== null) {
                titleIds.add(titleId);
            }
        }
    }

    return titleIds;
}

function sortByTitleId<T extends { titleId: string }>(entries: T[]): T[] {
    return entries.toSorted((a, b) => a.titleId.localeCompare(b.titleId));
}

async function readJsonArray(file: string): Promise<unknown[]> {
    try {
        const text = await fs.readFile(file, 'utf8');
        return toArray(JSON.parse(text) as unknown);
    } catch (error) {
        if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
        ) {
            return [];
        }

        throw error;
    }
}

async function writeJson(file: string, value: unknown): Promise<void> {
    await fs.writeFile(file, `${JSON.stringify(value, null, 4)}\n`, 'utf8');
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }

        return (await response.json()) as T;
    } catch {
        return null;
    }
}

async function fetchTextInsecure(url: string): Promise<string> {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    return await new Promise((resolve, reject) => {
        const request = client.get(
            parsed,
            parsed.protocol === 'https:' ? { rejectUnauthorized: false } : {},
            (response) => {
                if (
                    response.statusCode === undefined ||
                    response.statusCode < 200 ||
                    response.statusCode >= 300
                ) {
                    response.resume();
                    reject(
                        new Error(
                            `Request failed with status ${response.statusCode ?? 'unknown'}`
                        )
                    );
                    return;
                }

                response.setEncoding('utf8');

                let body = '';
                response.on('data', (chunk: string) => {
                    body += chunk;
                });
                response.on('end', () => resolve(body));
            }
        );

        request.on('error', reject);
    });
}

async function mapPool<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function run() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, run)
    );

    return results;
}

function generateTitleIds(excluded: Set<string>): string[] {
    const titleIds: string[] = [];

    for (const range of ranges) {
        const [startHex, endHex] = range.split(':');
        let current = BigInt(`0x${startHex}`);
        const end = BigInt(`0x${endHex}`);

        while (current <= end) {
            const titleId = current.toString(16).padStart(16, '0');

            if (!excluded.has(titleId)) {
                titleIds.push(titleId);
            }

            current += 0x100n;
        }
    }

    return titleIds;
}

async function processTitle(
    titleId: string,
    index: number
): Promise<Title | null> {
    const metadata = await fetchJson<TitleAllResponse>(
        formatUrl(titleAllUrl, titleId)
    );

    if (
        !metadata ||
        !metadata.titleId ||
        (metadata.name == null &&
            metadata.productCode == null &&
            metadata.companyCode == null)
    ) {
        console.log(`[${index + 1}] MISS ${titleId}`);
        return null;
    }

    const title: Title = {
        titleId,
        name: metadata.name ?? null,
        region: normalizeRegion(metadata.region, metadata.productCode),
        productCode: metadata.productCode ?? null,
        companyCode: metadata.companyCode ?? null,
        iconUrl: null,
        updates: metadata.updates ?? [],
        dlc: metadata.dlc ?? [],
    };

    console.log(
        `[${index + 1}] HIT  ${titleId} update=${versionsText(title.updates)} dlc=${versionsText(title.dlc)}`
    );

    return title;
}

function versionsText(versions: number[]): string {
    return versions.length === 0 ? 'none' : versions.join(',');
}

async function loadTitles(excluded: Set<string>): Promise<Title[]> {
    const titleIds = generateTitleIds(excluded);
    const titles = await mapPool(titleIds, parallel, processTitle);

    return sortByTitleId(titles.filter((title) => title !== null));
}

async function loadChildVersion(
    urlTemplate: string,
    titleId: string
): Promise<number | null> {
    const metadata = await fetchJson<ChildMetadataResponse>(
        formatUrl(urlTemplate, titleId)
    );

    if (
        metadata?.exists === true &&
        typeof metadata.titleVersion === 'number'
    ) {
        return metadata.titleVersion;
    }

    return null;
}

async function processExtraTitle(title: Title, index: number): Promise<Title> {
    const [updateVersion, dlcVersion] = await Promise.all([
        loadChildVersion(updateMetadataUrl, title.titleId),
        loadChildVersion(dlcMetadataUrl, title.titleId),
    ]);

    const updatedTitle: Title = {
        ...title,
        updates: updateVersion === null ? [] : [updateVersion],
        dlc: dlcVersion === null ? [] : [dlcVersion],
    };

    console.log(
        `[${index + 1}] EXTRA ${title.titleId} update=${versionsText(updatedTitle.updates)} dlc=${versionsText(updatedTitle.dlc)}`
    );

    return updatedTitle;
}

async function loadExtraTitles(
    existingTitles: Title[],
    excluded: Set<string>
): Promise<Title[] | null> {
    if (!(await fileExists(titledbFile))) {
        return null;
    }

    const existing = new Set(existingTitles.map((title) => title.titleId));
    const rows = parseCsvRows(await fs.readFile(titledbFile, 'utf8'));
    const titles = rows
        .map((row): Title | null => {
            const titleId = normalizeTitleId(row['Title ID'] ?? '');
            if (titleId === null) {
                return null;
            }

            return {
                titleId: titleId,
                name: row.Description ?? 'Unknown',
                region: normalizeRegion(row.Region, row['Product Code']),
                productCode:
                    row['Product Code'] === ''
                        ? null
                        : (row['Product Code'] ?? null),
                companyCode:
                    row['Company Code'] === ''
                        ? null
                        : (row['Company Code'] ?? null),
                iconUrl: null,
                updates: [],
                dlc: [],
                availableOnCdn:
                    (row['Available on CDN?'] ?? '').toLowerCase() === 'yes'
                        ? 'Yes'
                        : 'No',
            };
        })
        .filter(
            (title): title is Title =>
                title !== null &&
                !existing.has(title.titleId) &&
                !excluded.has(title.titleId)
        );

    return sortByTitleId(await mapPool(titles, parallel, processExtraTitle));
}

function parseCsvRows(text: string): CsvRow[] {
    const parsed = CsvParse(text, {
        bom: true,
        columns: true,
        relaxColumnCount: true,
        skipEmptyLines: true,
    });

    return toArray(parsed as unknown).filter(
        (value): value is CsvRow =>
            typeof value === 'object' &&
            value !== null &&
            Object.values(value).every((item) => typeof item === 'string')
    );
}

async function loadSamuraiIcons(): Promise<Icon[] | null> {
    try {
        const xml = await fetchTextInsecure(samuraiContentsUrl);
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@',
        });
        const parsed = parser.parse(xml) as SamuraiResponse;
        const contents = parsed.eshop?.contents?.content;
        const contentEntries = toArray(contents);
        const icons: Icon[] = [];

        for (const { title } of contentEntries) {
            const titleId = normalizeTitleId(title?.['@id'] ?? '');
            const iconUrl = title?.icon_url ?? '';

            if (titleId !== null && iconUrl !== '') {
                icons.push({ titleId, iconUrl });
            }
        }

        return sortByTitleId(uniqueByTitleId(icons));
    } catch {
        return null;
    }
}

function uniqueByTitleId<T extends { titleId: string }>(entries: T[]): T[] {
    const byTitleId = new Map<string, T>();

    for (const entry of entries) {
        if (!byTitleId.has(entry.titleId)) {
            byTitleId.set(entry.titleId, entry);
        }
    }

    return [...byTitleId.values()];
}

async function mergeSamuraiIcons(): Promise<void> {
    const samuraiIcons = await loadSamuraiIcons();

    if (samuraiIcons === null) {
        console.log(
            'Skipping Samurai icon supplement: fetch or XML conversion failed'
        );
        return;
    }

    const icons = (await readJsonArray(iconsFile))
        .filter(isIcon)
        .map((icon) => ({
            titleId: icon.titleId.toLowerCase(),
            iconUrl: icon.iconUrl,
        }));
    const existing = new Set(icons.map((icon) => icon.titleId));

    await writeJson(
        iconsFile,
        sortByTitleId([
            ...icons,
            ...samuraiIcons.filter((icon) => !existing.has(icon.titleId)),
        ])
    );

    console.log(`Icon data saved to ${iconsFile}`);
}

function isIcon(value: unknown): value is Icon {
    return stringFieldRecord(value, ['titleId', 'iconUrl']);
}

async function applyIcons(file: string, icons: Icon[]): Promise<void> {
    if (!(await fileExists(file))) {
        return;
    }

    const iconByTitleId = new Map(
        icons.map((icon) => [icon.titleId, icon.iconUrl])
    );
    const titles = (await readJsonArray(file)).filter((value) =>
        stringFieldRecord(value, ['titleId'])
    );

    await writeJson(
        file,
        titles.map((title) => ({
            ...title,
            iconUrl: iconByTitleId.get(title.titleId) ?? null,
        }))
    );
}

async function fileExists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const excluded = titleIdSet(await readJsonArray(excludeFile));
    const titles = await loadTitles(excluded);

    await writeJson(titlesFile, titles);
    console.log(`Title data saved to ${titlesFile}`);

    const extraTitles = await loadExtraTitles(titles, excluded);
    if (extraTitles !== null) {
        await writeJson(extraFile, extraTitles);
        console.log(`Extra title data saved to ${extraFile}`);
    }

    await mergeSamuraiIcons();

    const icons = (await readJsonArray(iconsFile)).filter(isIcon);
    await applyIcons(titlesFile, icons);
    await applyIcons(extraFile, icons);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
