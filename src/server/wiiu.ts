import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getAppRoot } from './paths.js';
import { TITLE_TMD } from './metadata.js';

import {
    type TitleEntry,
    type TitleGroup,
    TitleKinds,
    type ChildKind,
    type ParentKind,
    PARENT_KINDS,
    CHILD_KINDS,
} from '../shared/shared.js';
import { readTmd } from './metadata.js';

type RawTitleDatabaseEntry = {
    titleID: string;
    name: string;
    region: string;
    iconUrl: string;
};

type TitleDatabaseEntry = {
    titleID: string;
    name: string;
    region: string | null;
    iconUrl: string | null;

    kind: TitleKinds;
    family: string;
};

type LocalTitleEntry = TitleEntry & {
    family: string;
};

function normalizeTitleName(name: string): string {
    const normalized =
        name
            ?.replace(/([^\s])\s*\n\s*([^\s])/g, '$1 $2')
            ?.replace(/\s*\n\s*/g, ' ')
            ?.replace(/ {2,}/g, ' ')
            ?.trim() ?? 'Unknown';
    return normalized;
}

function cleanDirectoryName(dirname: string): string {
    const base = path.basename(dirname);
    return base
        .replace(/\[(Game|Update|DLC)\]\s*\[[0-9a-fA-F]{16}\]$/, '')
        .trim();
}

function getTitleName(dirname: string, databaseName: string | null): string {
    if (databaseName && databaseName.length > 0) {
        return normalizeTitleName(databaseName);
    }

    const cleaned = cleanDirectoryName(dirname);

    if (cleaned.length > 0) {
        return cleaned;
    }

    return 'Unknown';
}

function classifyTitleId(titleId: string): {
    family: string;
    kind: TitleKinds;
} {
    const normalized = titleId?.toLowerCase() ?? '';

    if (normalized.length !== 16) {
        return { family: normalized, kind: TitleKinds.Unknown };
    }

    const prefix = normalized.slice(0, 8);
    const family = normalized.slice(8);

    switch (prefix) {
        case '00000007':
            return { family, kind: TitleKinds.vWii };

        case '00050000':
            return { family, kind: TitleKinds.Base };

        case '00050002':
            return { family, kind: TitleKinds.Demo };

        case '0005000b':
            return { family, kind: TitleKinds.FCT };

        case '0005000c':
            return { family, kind: TitleKinds.DLC };

        case '0005000d':
            return { family, kind: TitleKinds.Unknown };

        case '0005000e':
            return { family, kind: TitleKinds.Update };

        case '00050010':
            return { family, kind: TitleKinds.SystemApp };

        case '0005001b':
            return { family, kind: TitleKinds.SystemData };

        case '00050030':
            return { family, kind: TitleKinds.SystemApplet };

        default:
            return { family, kind: TitleKinds.Unknown };
    }
}

function parseTitleDatabaseEntries(jsonText: string): TitleDatabaseEntry[] {
    const json = JSON.parse(jsonText) as unknown;

    if (!Array.isArray(json)) {
        throw new Error('titles.json must contain an array');
    }

    return (json as RawTitleDatabaseEntry[]).map((entry) => {
        if (typeof entry.titleID !== 'string') {
            throw new Error(
                `invalid titleID in titles.json: ${JSON.stringify(entry)}`
            );
        }

        const { family, kind } = classifyTitleId(entry.titleID);

        return {
            titleID: entry.titleID.toLowerCase(),
            name: normalizeTitleName(entry.name),
            region: entry.region?.length > 0 ? entry.region : null,
            iconUrl: entry.iconUrl?.length > 0 ? entry.iconUrl : null,

            family,
            kind,
        };
    });
}

async function readTitleDatabase(): Promise<Map<string, TitleDatabaseEntry>> {
    const titlesJsonPath = path.join(getAppRoot(), 'titles.json');
    try {
        const jsonText = await readFile(titlesJsonPath, 'utf8');
        const entries = parseTitleDatabaseEntries(jsonText);
        return new Map(entries.map((entry) => [entry.titleID, entry]));
    } catch (error) {
        console.error(
            `[wiiu] failed to read titles DB at ${titlesJsonPath}:`,
            error
        );
        return new Map();
    }
}

async function getDirectorySizeBytes(targetPath: string): Promise<number> {
    const info = await stat(targetPath);

    if (info.isFile()) {
        return info.size;
    }

    if (!info.isDirectory()) {
        return 0;
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    let total = 0;

    const queue = [...entries];
    const cpuCount = os.cpus()?.length ?? 4;
    const concurrency = Math.min(cpuCount * 2, queue.length);

    const workers = new Array(concurrency).fill(null).map(async () => {
        while (queue.length > 0) {
            const entry = queue.shift();
            if (!entry) break;

            const childPath = path.join(targetPath, entry.name);

            try {
                if (entry.isDirectory()) {
                    const size = await getDirectorySizeBytes(childPath);
                    total += size;
                    continue;
                }

                if (entry.isFile()) {
                    const childInfo = await stat(childPath);
                    total += childInfo.size;
                }
            } catch {
                // ignore individual errors while scanning
            }
        }
    });

    await Promise.all(workers);

    return total;
}

async function readTitleEntry(
    root: string,
    dirname: string,
    titleDatabase: Map<string, TitleDatabaseEntry>
): Promise<LocalTitleEntry | null> {
    const dirPath = path.join(root, dirname);
    const tmd = await readTmd(dirPath);
    if (!tmd) {
        return null;
    }

    const titleId = Buffer.from(tmd.header.titleId).toString('hex');
    const { family, kind } = classifyTitleId(titleId);
    const databaseEntry = titleDatabase.get(titleId);

    return {
        titleId,
        version: tmd.header.titleVersion,
        titleName: getTitleName(dirname, databaseEntry?.name ?? null),
        region: databaseEntry?.region ?? tmd.header.region,
        iconUrl: databaseEntry?.iconUrl ?? null,

        kind,
        family,
        sizeBytes: await getDirectorySizeBytes(dirPath),
    };
}

function createEmptyGroup(family: string): TitleGroup {
    return {
        family,
        name: 'Unknown',
        region: null,
        iconUrl: null,
        titleInDatabase: false,
        expectedChildren: [],

        entries: [],
    };
}

function getParentByKind<T extends { kind: TitleKinds }>(
    entries: T[]
): T | null {
    return (
        entries.find((candidate) =>
            PARENT_KINDS.includes(candidate.kind as ParentKind)
        ) ?? null
    );
}

export async function scanWiiUTitles(root: string): Promise<TitleGroup[]> {
    const titleDatabase = await readTitleDatabase();
    const databaseByFamily = new Map<string, TitleDatabaseEntry[]>();

    for (const entry of titleDatabase.values()) {
        const existing = databaseByFamily.get(entry.family) ?? [];
        existing.push(entry);
        databaseByFamily.set(entry.family, existing);
    }

    // Recursively find directories that contain a title.tmd file.
    async function findTitleDirs(
        currentPath: string,
        relative = ''
    ): Promise<string[]> {
        const found: string[] = [];
        let entries: Dirent[];
        try {
            entries = await readdir(currentPath, { withFileTypes: true });
        } catch {
            return found;
        }

        const hasTmd = entries.some((e) => e.isFile() && e.name === TITLE_TMD);
        if (hasTmd) {
            found.push(relative || '.');
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const subRel = relative
                    ? `${relative}/${entry.name}`
                    : entry.name;
                const childPath = path.join(currentPath, entry.name);
                const childFound = await findTitleDirs(childPath, subRel);
                found.push(...childFound);
            }
        }

        return found;
    }

    const directories = (await findTitleDirs(root)).sort((a, b) =>
        a.localeCompare(b)
    );

    const scanned = (
        await Promise.all(
            directories.map(async (dirname) =>
                readTitleEntry(root, dirname, titleDatabase)
            )
        )
    ).filter((entry): entry is LocalTitleEntry => entry !== null);

    const groups = new Map<string, TitleGroup>();

    for (const entry of scanned) {
        let group = groups.get(entry.family);

        if (!group) {
            group = createEmptyGroup(entry.family);
            groups.set(entry.family, group);
        }

        const publicEntry: TitleEntry = {
            titleId: entry.titleId,
            version: entry.version,
            titleName: entry.titleName,
            region: entry.region,

            iconUrl: entry.iconUrl,
            kind: entry.kind,
            sizeBytes: entry.sizeBytes,
        };
        group.entries.push(publicEntry);
    }

    for (const family of databaseByFamily.keys()) {
        if (!groups.has(family)) {
            groups.set(family, createEmptyGroup(family));
        }
    }

    for (const group of groups.values()) {
        const familyEntries = databaseByFamily.get(group.family) ?? [];
        const parentEntry = getParentByKind(group.entries);
        const databaseParent = getParentByKind(familyEntries);
        group.titleInDatabase = familyEntries.length > 0;
        group.expectedChildren = CHILD_KINDS.filter((kind) =>
            familyEntries.some((entry) => entry.kind === kind)
        );

        if (parentEntry) {
            group.name = parentEntry.titleName;
            group.region = parentEntry.region;
            group.iconUrl = parentEntry.iconUrl;
        } else if (databaseParent) {
            group.name = databaseParent.name;
            group.region = databaseParent.region;
            group.iconUrl = databaseParent.iconUrl;
        } else {
            const firstLocalChild = group.entries.find((entry) =>
                CHILD_KINDS.includes(entry.kind as ChildKind)
            );

            group.name = firstLocalChild?.titleName ?? 'Unknown';
            group.region = firstLocalChild?.region ?? null;
            group.iconUrl = firstLocalChild?.iconUrl ?? null;
        }

        group.entries.sort((a, b) => b.version - a.version);
    }

    return [...groups.values()]
        .filter((group) => group.entries.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
}
