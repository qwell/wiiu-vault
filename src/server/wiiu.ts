import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { TitleEntry, TitleGroup, TitleKind, TitleSlot } from '../shared/shared.js';

type RawTitleDatabaseEntry = {
    titleID?: string;
    name?: string;
    region?: string;
    iconUrl?: string;
};

type TitleDatabaseEntry = {
    titleID: string;
    family: string;
    kind: TitleKind;
    name: string;
    region: string | null;
    iconUrl: string | null;
};

type ParsedMetadata = {
    titleId: string;
    version: number | null;
};

type LocalTitleEntry = TitleEntry & {
    family: string;
    localPath: string;
    sizeBytes: number;
    matchedDatabase: boolean;
};

const TITLE_TIK = 'title.tik';
const TITLE_TMD = 'title.tmd';

const TIK_TITLE_ID_OFFSET = 0x1dc;
const TIK_TITLE_ID_LENGTH = 8;
const TIK_VERSION_OFFSET = 0x1e6;
const TIK_VERSION_LENGTH = 2;

const TMD_TITLE_ID_OFFSET = 0x18c;
const TMD_TITLE_ID_LENGTH = 8;
const TMD_VERSION_OFFSET = 0x1dc;
const TMD_VERSION_LENGTH = 2;

function parseTitleId(buffer: Buffer, offset: number, length: number): string | null {
    if (buffer.length < offset + length) {
        return null;
    }

    return buffer
        .subarray(offset, offset + length)
        .toString('hex')
        .toLowerCase();
}

function parseUnsignedIntegerBE(buffer: Buffer, offset: number, length: number): number | null {
    if (buffer.length < offset + length) {
        return null;
    }

    switch (length) {
        case 1:
            return buffer.readUInt8(offset);

        case 2:
            return buffer.readUInt16BE(offset);

        case 4:
            return buffer.readUInt32BE(offset);

        default:
            throw new Error(`Unsupported integer length: ${length}`);
    }
}

function normalizeTitleName(name: string): string {
    return name
        .replace(/([^\s])\s*\n\s*([^\s])/g, '$1 $2')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
}

function cleanDirectoryName(dirname: string): string {
    return dirname.replace(/\s*\[(Game|Update|DLC)\]\s*\[[0-9a-fA-F]{16}\]\s*$/, '').trim();
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

function classifyTitleId(titleId: string): { family: string; kind: TitleKind } {
    const normalized = titleId.toLowerCase();

    if (normalized.length !== 16) {
        return { family: normalized, kind: 'Unknown' };
    }

    const prefix = normalized.slice(0, 8);
    const family = normalized.slice(8);

    switch (prefix) {
        case '00000007':
            return { family, kind: 'vWii' };

        case '00050000':
            return { family, kind: 'Base' };

        case '00050002':
            return { family, kind: 'Demo' };

        case '0005000b':
            return { family, kind: 'FCT' };

        case '0005000c':
            return { family, kind: 'DLC' };

        case '0005000d':
            return { family, kind: 'Unknown' };

        case '0005000e':
            return { family, kind: 'Update' };

        case '00050010':
            return { family, kind: 'System App' };

        case '0005001b':
            return { family, kind: 'System Data' };

        case '00050030':
            return { family, kind: 'System Applet' };

        default:
            return { family, kind: 'Unknown' };
    }
}

function parseTitleDatabaseEntries(jsonText: string): TitleDatabaseEntry[] {
    const parsed = JSON.parse(jsonText) as unknown;

    if (!Array.isArray(parsed)) {
        throw new Error('titles.json must contain an array');
    }

    return parsed.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            return [];
        }

        const value = entry as RawTitleDatabaseEntry;

        if (typeof value.titleID !== 'string' || typeof value.name !== 'string') {
            return [];
        }

        const titleID = value.titleID.toLowerCase();
        const { family, kind } = classifyTitleId(titleID);

        return [
            {
                titleID,
                family,
                kind,
                name: normalizeTitleName(value.name),
                region: typeof value.region === 'string' && value.region.length > 0 ? value.region : null,
                iconUrl: typeof value.iconUrl === 'string' && value.iconUrl.length > 0 ? value.iconUrl : null,
            },
        ];
    });
}

async function readTitleDatabase(): Promise<Map<string, TitleDatabaseEntry>> {
    const titlesJsonPath = path.resolve(import.meta.dirname, '../titles.json');
    try {
        const jsonText = await readFile(titlesJsonPath, 'utf8');
        const entries = parseTitleDatabaseEntries(jsonText);
        return new Map(entries.map((entry) => [entry.titleID, entry]));
    } catch (error) {
        console.error(`[wiiu] failed to read titles DB at ${titlesJsonPath}:`, error);
        return new Map();
    }
}

async function readFromTmd(dirPath: string): Promise<ParsedMetadata | null> {
    try {
        const buffer = await readFile(path.join(dirPath, TITLE_TMD));
        const titleId = parseTitleId(buffer, TMD_TITLE_ID_OFFSET, TMD_TITLE_ID_LENGTH);

        if (!titleId) {
            return null;
        }

        return {
            titleId,
            version: parseUnsignedIntegerBE(buffer, TMD_VERSION_OFFSET, TMD_VERSION_LENGTH),
        };
    } catch {
        return null;
    }
}

async function readFromTik(dirPath: string): Promise<ParsedMetadata | null> {
    try {
        const buffer = await readFile(path.join(dirPath, TITLE_TIK));
        const titleId = parseTitleId(buffer, TIK_TITLE_ID_OFFSET, TIK_TITLE_ID_LENGTH);

        if (!titleId) {
            return null;
        }

        return {
            titleId,
            version: parseUnsignedIntegerBE(buffer, TIK_VERSION_OFFSET, TIK_VERSION_LENGTH),
        };
    } catch {
        return null;
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

    for (const entry of entries) {
        const childPath = path.join(targetPath, entry.name);

        if (entry.isDirectory()) {
            total += await getDirectorySizeBytes(childPath);
            continue;
        }

        if (entry.isFile()) {
            const childInfo = await stat(childPath);
            total += childInfo.size;
        }
    }

    return total;
}

async function readTitleEntry(
    root: string,
    dirname: string,
    titleDatabase: Map<string, TitleDatabaseEntry>
): Promise<LocalTitleEntry | null> {
    const dirPath = path.join(root, dirname);

    const tmdData = await readFromTmd(dirPath);
    const tikData = await readFromTik(dirPath);
    const metadata = tmdData ?? tikData;

    if (!metadata) {
        return null;
    }

    const { family, kind } = classifyTitleId(metadata.titleId);
    const databaseEntry = titleDatabase.get(metadata.titleId);

    return {
        titleId: metadata.titleId,
        family,
        kind,
        version: metadata.version,
        titleName: getTitleName(dirname, databaseEntry?.name ?? null),
        region: databaseEntry?.region ?? null,
        iconUrl: databaseEntry?.iconUrl ?? null,
        localPath: dirPath,
        sizeBytes: await getDirectorySizeBytes(dirPath),
        matchedDatabase: databaseEntry !== undefined,
    };
}

function createEmptySlot(kind: 'Update' | 'DLC'): TitleSlot {
    return {
        kind,
        titleId: null,
        version: null,
        available: false,
        existsLocally: false,
    };
}

function createEmptyGroup(family: string): TitleGroup {
    return {
        family,
        name: 'Unknown',
        region: null,
        iconUrl: null,
        parentMissing: true,
        titleInDatabase: false,

        base: null,
        update: null,
        dlc: [],

        demo: null,
        fct: null,
        systemApplet: null,
        systemApp: null,
        systemData: null,
        vWii: null,
        unknown: [],

        updateSlot: createEmptySlot('Update'),
        dlcSlot: createEmptySlot('DLC'),

        gameTitleId: null,
        updateTitleId: null,
        dlcTitleId: null,

        gameSizeBytes: null,
        updateSizeBytes: null,
        dlcSizeBytes: null,
    };
}

function getParentEntry(group: TitleGroup): TitleEntry | null {
    return (
        group.base ??
        group.demo ??
        group.fct ??
        group.systemApplet ??
        group.systemApp ??
        group.systemData ??
        group.vWii ??
        null
    );
}

function getDatabaseParentEntry(entries: TitleDatabaseEntry[]): TitleDatabaseEntry | null {
    const kinds: TitleKind[] = ['Base', 'Demo', 'FCT', 'System Applet', 'System App', 'System Data', 'vWii'];

    for (const kind of kinds) {
        const entry = entries.find((candidate) => candidate.kind === kind);
        if (entry) {
            return entry;
        }
    }

    return null;
}

function buildTitleSlot(kind: 'Update' | 'DLC', group: TitleGroup, familyEntries: TitleDatabaseEntry[]): TitleSlot {
    const dbEntry = familyEntries.find((entry) => entry.kind === kind);

    switch (kind) {
        case 'Update':
            return {
                kind,
                titleId: dbEntry?.titleID ?? null,
                version: group.update?.version ?? null,
                available: dbEntry !== undefined,
                existsLocally: group.update !== null,
            };

        case 'DLC': {
            const localDlc = group.dlc[0] ?? null;

            return {
                kind,
                titleId: dbEntry?.titleID ?? null,
                version: localDlc?.version ?? null,
                available: dbEntry !== undefined,
                existsLocally: localDlc !== null,
            };
        }
    }
}

export async function scanWiiUTitles(root: string): Promise<TitleGroup[]> {
    const titleDatabase = await readTitleDatabase();
    const databaseByFamily = new Map<string, TitleDatabaseEntry[]>();

    for (const entry of titleDatabase.values()) {
        const existing = databaseByFamily.get(entry.family) ?? [];
        existing.push(entry);
        databaseByFamily.set(entry.family, existing);
    }

    const entries = await readdir(root, { withFileTypes: true });
    const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const scanned = (
        await Promise.all(directories.map(async (dirname) => readTitleEntry(root, dirname, titleDatabase)))
    ).filter((entry): entry is LocalTitleEntry => entry !== null);

    const groups = new Map<string, TitleGroup>();

    for (const entry of scanned) {
        let group = groups.get(entry.family);

        if (!group) {
            group = createEmptyGroup(entry.family);
            groups.set(entry.family, group);
        }

        group.titleInDatabase ||= entry.matchedDatabase;

        const publicEntry: TitleEntry = {
            titleId: entry.titleId,
            kind: entry.kind,
            version: entry.version,
            titleName: entry.titleName,
            region: entry.region,
            iconUrl: entry.iconUrl,
        };

        switch (entry.kind) {
            case 'Base':
                group.base = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'Update':
                group.update = publicEntry;
                group.updateSizeBytes = entry.sizeBytes;
                break;

            case 'DLC':
                group.dlc.push(publicEntry);
                group.dlcSizeBytes = (group.dlcSizeBytes ?? 0) + entry.sizeBytes;
                break;

            case 'Demo':
                group.demo = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'FCT':
                group.fct = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'System Applet':
                group.systemApplet = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'System App':
                group.systemApp = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'System Data':
                group.systemData = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'vWii':
                group.vWii = publicEntry;
                group.gameSizeBytes = entry.sizeBytes;
                break;

            case 'Unknown':
                group.unknown.push(publicEntry);
                break;
        }
    }

    for (const group of groups.values()) {
        const familyEntries = databaseByFamily.get(group.family) ?? [];
        const parentEntry = getParentEntry(group);
        const databaseParent = getDatabaseParentEntry(familyEntries);

        if (parentEntry) {
            group.parentMissing = false;
            group.name = parentEntry.titleName;
            group.region = parentEntry.region;
            group.iconUrl = parentEntry.iconUrl;
            group.gameTitleId = parentEntry.titleId;
        } else if (databaseParent) {
            group.parentMissing = true;
            group.titleInDatabase = true;
            group.name = databaseParent.name;
            group.region = databaseParent.region;
            group.iconUrl = databaseParent.iconUrl;
            group.gameTitleId = databaseParent.titleID;
        } else {
            const firstLocal = group.update ?? group.dlc[0] ?? group.unknown[0] ?? null;

            group.parentMissing = true;
            group.titleInDatabase = false;
            group.name = firstLocal?.titleName ?? 'Unknown';
            group.region = firstLocal?.region ?? null;
            group.iconUrl = firstLocal?.iconUrl ?? null;
            group.gameTitleId = null;
        }

        group.updateSlot = buildTitleSlot('Update', group, familyEntries);
        group.dlcSlot = buildTitleSlot('DLC', group, familyEntries);

        group.updateTitleId = group.updateSlot.titleId;
        group.dlcTitleId = group.dlcSlot.titleId;
    }

    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
