import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Zip from 'adm-zip';
import { parse as CsvParse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';

import { normalizeRegion } from '../src/shared/regions.js';
import {
    getDiscProductCode,
    identifyTitle,
    identifyThreeDSTitle,
    identifyWiiUTitle,
    normalizeTitleName,
    PARENT_KINDS,
    replaceTitleKind,
    type ParentKind,
    type RawTitleDatabaseEntry,
    TitleKinds,
} from '../src/shared/titles.js';

import { isObject, toArray } from '../src/shared/utils.js';
import { type TitleLookupResponse } from '../src/shared/api.js';
import { HttpError, isHttpErrorStatus } from '../src/shared/download.js';
import { readOptionalFile } from '../src/shared/file.js';
import {
    getGameTdbLocales,
    getGameTdbTitle,
    getPreferredGameTdbLocale,
    isGameCubeGameTdbTitle,
    isGameTdbGame,
    isSkippedGameTdbTitle,
    type GameTdbXmlFile,
} from '../src/server/gametdb.js';
import {
    downloadNusTitleMetadata,
    downloadTmd,
    getDlcMetadata,
    getUpdateMetadata,
    loadThreeDSClientCertificateOptions,
    THREE_DS_NUS_BASE_URL,
    WII_U_NUS_BASE_URL,
} from '../src/server/nus.js';
import { readTmdFromBuffer, type Tmd } from '../src/server/formats/tmd.js';
import { downloadBytes, type DownloadOptions } from '../src/server/download.js';
import { isErrorType, isNodeErrorCode } from '../src/shared/error.js';

type Icon = {
    titleId: string;
    iconUrl: string;
};

type CsvRow = Record<string, string>;

type SamuraiImage = {
    '#text'?: string;
    '@url'?: string;
    '@type'?: string;
    '@width'?: string;
    '@height'?: string;
    '@index'?: string;
};

type SamuraiNamedItem = {
    '@id'?: string;
    '@type'?: string;
    '@required'?: string;
    id?: string;
    name?: string;
    icons?: { icon?: SamuraiImage[] };
};

type SamuraiTitle = {
    '@id'?: string;
    icon_url?: string;
    banner_url?: string;
    top_image?: SamuraiImage;
    name?: string;
    formal_name?: string;
    description?: string;
    display_genre?: string;
    number_of_players?: string;
    disclaimer?: string;
    product_code?: string;
    platform?: SamuraiNamedItem & { '@device'?: string; '@category'?: string };
    publisher?: SamuraiNamedItem;
    genres?: { genre?: SamuraiNamedItem[] };
    languages?: {
        language?: { iso_code?: string; name?: string }[];
    };
    features?: { feature?: SamuraiNamedItem[] };
    play_styles?: {
        play_style?: (SamuraiNamedItem & {
            features?: { feature?: SamuraiNamedItem[] };
            controllers?: {
                controller?: SamuraiNamedItem[];
            };
        })[];
    };
    rating_info?: {
        rating_system?: SamuraiNamedItem;
        rating?: SamuraiNamedItem;
        descriptors?: {
            descriptor?: { name?: string }[];
        };
    };
    thumbnails?: { thumbnail?: SamuraiImage[] };
    screenshots?: {
        screenshot?: {
            image_url?: SamuraiImage[];
            thumbnail_url?: SamuraiImage;
        }[];
    };
    keywords?: { keyword?: string[] };
    web_sites?: {
        web_site?: {
            name?: string;
            url?: string;
            official?: string;
        }[];
    };
    copyright?: { text?: string };
    release_date_on_eshop?: string;
    release_date_on_original?: string;
    release_date_on_retail?: string;
    retail_sales?: string;
    eshop_sales?: string;
    web_sales?: string;
    download_code_sales?: string;
    download_card_sales?: { '@available'?: string };
    in_app_purchase?: string;
};

type SamuraiContent = {
    title?: SamuraiTitle;
};

type SamuraiResponse = {
    eshop?: {
        title?: SamuraiTitle;
        languages?: {
            language?: { iso_code?: string }[];
        };
        contents?: {
            content?: SamuraiContent[];
        };
    };
};

type MajorRegion = 'USA' | 'EUR' | 'JPN' | 'KOR' | 'CHN' | 'TWN';

type SamuraiCatalogSource = {
    platform: TitleLookupPlatform;
    device: 'CTR' | 'WUP';
    shopId: 1 | 2;
    majorRegion: MajorRegion;
    region: string;
    lang?: string;
};

type SamuraiCatalogTitle = {
    nsUid: string;
    source: SamuraiCatalogSource;
    name: string;
    productCode: string | null;
    iconUrl: string | null;
};

type SamuraiLookupDetails = {
    language: string;
    platform: TitleLookupPlatform;
    title: SamuraiTitle;
};

type SamuraiTitleDetails = {
    title: NusTitle | null;
    lookups: SamuraiLookupDetails[];
};

type LocalizedText = { [language: string]: string };

type SamuraiPlatformUrls = {
    contents: string;
    languages: string;
    title: string;
};

type LocalizedLookup = {
    names?: LocalizedText;
    platform?: TitleLookupPlatform;
    device?: string | null;
    category?: string | null;
    type?: string | null;
    icons?: NusImage[];
};

type NusImage = {
    type: string | null;
    url: string;
    width?: string | null;
    height?: string | null;
};

type NusLocalization = {
    name?: string;
    formalName?: string;
    description?: string;
    displayGenre?: string;
    numberOfPlayers?: string;
    keywords?: string[];
    webSites?: {
        name: string | null;
        url: string | null;
        official: boolean;
    }[];
    disclaimer?: string;
    copyright?: string;
};

type NusRating = {
    ratingSystem?: string | null;
    rating?: string | null;
    descriptors?: string[];
};

type NusImages = {
    iconUrl?: string | null;
    bannerUrl?: string | null;
    topImage?: SamuraiImage | null;
    thumbnails?: NusImage[];
    screenshots?: { index: string; images: NusImage[] }[];
};

type NusRatings = { [country: string]: NusRating };

type NusTitle = {
    titleId: string;
    nsUid?: string;
    productCode: string | null;
    platformId: string | null;
    region?: string;
    publisherId: string | null;
    companyCode?: string | null;
    localizations: { [language: string]: NusLocalization };
    baseVersions: number[];
    updateVersions: number[];
    dlcVersions: number[];
    images: NusImages | null;
    features: { id: string; required: boolean }[];
    controllers: { id: string; required: boolean }[];
    playStyles: string[];
    genres: string[];
    languageCodes: string[];
    releaseDates: {
        eshop: string | null;
        original: string | null;
        retail: string | null;
    };
    ratings: NusRatings | null;
    sales: {
        retail: boolean;
        eshop: boolean;
        web: boolean;
        downloadCode: boolean;
        downloadCard: boolean;
        iap: boolean;
    };
    availableOnCdn: boolean;
};

type NusDatabase = {
    languages: {
        [country: string]: {
            defaultLanguage: string;
            languages: string[];
        };
    };
    platforms: { [id: string]: LocalizedLookup };
    publishers: { [id: string]: LocalizedLookup };
    genres: { [id: string]: LocalizedLookup };
    ratingSystems: { [id: string]: LocalizedLookup };
    ratings: {
        [systemId: string]: {
            [ratingId: string]: { icons: NusImage[] };
        };
    };
    languageNames: { [id: string]: LocalizedLookup };
    features: { [id: string]: LocalizedLookup };
    controllers: { [id: string]: LocalizedLookup };
    titles: NusTitle[];
};

type NusTitleEntry = RawTitleDatabaseEntry & {
    titleId: string;
    samurai?: NusTitle;
};

type NinjaIdPair = {
    nsUid: string;
    titleId: string;
};

type NinjaIdPairSource = {
    ns_uid?: string;
    title_id?: string;
};

type NinjaIdPairResponse = {
    eshop?: {
        title_id_pairs?: {
            title_id_pair?: NinjaIdPairSource | NinjaIdPairSource[];
        };
    };
};

type TagayaLatestVersionResponse = {
    version_list_info?: {
        version?: string;
    };
};

type TagayaVersionListEntry = {
    id?: string;
    version?: string;
};

type TagayaVersionListResponse = {
    version_list?: {
        titles?: {
            title?: TagayaVersionListEntry | TagayaVersionListEntry[];
        };
    };
};

type ThreeDSVersionListEntry = {
    titleId: string;
    version: number;
};

type ThreeDSHShopRow = {
    hshopId: string;
    titleId: string;
    productCode: string;
    name: string;
    version: string;
};

type GeneratedTitleDatabase = {
    '3ds': RawTitleDatabaseEntry[];
    gamecube: RawTitleDatabaseEntry[];
    wiiu: RawTitleDatabaseEntry[];
    wii: RawTitleDatabaseEntry[];
};

type DiscTitleDatabase = Pick<GeneratedTitleDatabase, 'gamecube' | 'wii'>;

type TitleLookupPlatform = '3ds' | 'wiiu';

type TitleRange = {
    platform: TitleLookupPlatform;
    range: string;
};

type ParsedTitleRange = {
    start: bigint;
    end: bigint;
};

type GeneratedTitleId = {
    platform: TitleLookupPlatform;
    titleId: string;
};

type GenerateOptions = {
    extractIcons: boolean;
    limit: number;
    refreshMetadata: boolean;
    refreshCatalog: boolean;
    refreshTdb: boolean;
    refreshVersions: boolean;
    scanGeneratedRanges: boolean;
};

type SamuraiCatalogResult = {
    titles: RawTitleDatabaseEntry[];
    childNsUids: Set<string>;
};

type SamuraiStorefrontLanguages = {
    defaultLanguage: string;
    languages: string[];
};

type FailedVersionSnapshot = {
    snapshot: number;
    statusCode: number;
};

const ranges: TitleRange[] = [
    { platform: '3ds', range: '0004000000000000:00040000001fff00' },
    { platform: '3ds', range: '000400000b000000:000400000b000f00' },
    { platform: '3ds', range: '000400000f700000:000400000f70ff00' },

    { platform: 'wiiu', range: '0005000010100000:0005000010220000' },
    { platform: 'wiiu', range: '000500001f600000:000500001f601f00' },
    { platform: 'wiiu', range: '000500001f700000:000500001f702f00' },
    { platform: 'wiiu', range: '000500001f800000:000500001f80ff00' },
    { platform: 'wiiu', range: '000500001f940e00:000500001f940f00' },
    { platform: 'wiiu', range: '000500001f943100:000500001f943100' },
    { platform: 'wiiu', range: '000500001fbf1000:000500001fbf1000' },
];

const samuraiMajorRegionSources: Readonly<
    Record<MajorRegion, readonly { region: string; lang?: string }[]>
> = {
    USA: [
        { region: 'US', lang: 'en' },
        { region: 'AE' },
        { region: 'AG' },
        { region: 'AI' },
        { region: 'AN' },
        { region: 'AR' },
        { region: 'AW' },
        { region: 'BB' },
        { region: 'BM' },
        { region: 'BO' },
        { region: 'BR' },
        { region: 'BS' },
        { region: 'BZ' },
        { region: 'CA' },
        { region: 'CL' },
        { region: 'CO' },
        { region: 'CR' },
        { region: 'DM' },
        { region: 'DO' },
        { region: 'EC' },
        { region: 'GD' },
        { region: 'GF' },
        { region: 'GP' },
        { region: 'GT' },
        { region: 'GY' },
        { region: 'HN' },
        { region: 'HT' },
        { region: 'JM' },
        { region: 'KN' },
        { region: 'KY' },
        { region: 'LC' },
        { region: 'MQ' },
        { region: 'MS' },
        { region: 'MX' },
        { region: 'NI' },
        { region: 'PA' },
        { region: 'PE' },
        { region: 'PY' },
        { region: 'SA' },
        { region: 'SR' },
        { region: 'SV' },
        { region: 'TC' },
        { region: 'TT' },
        { region: 'UY' },
        { region: 'VC' },
        { region: 'VE' },
        { region: 'VG' },
        { region: 'VI' },
    ],
    EUR: [
        { region: 'GB', lang: 'en' },
        { region: 'AD' },
        { region: 'AL' },
        { region: 'AT' },
        { region: 'AU' },
        { region: 'AZ' },
        { region: 'BA' },
        { region: 'BE' },
        { region: 'BG' },
        { region: 'BW' },
        { region: 'CH' },
        { region: 'CY' },
        { region: 'CZ' },
        { region: 'DE' },
        { region: 'DJ' },
        { region: 'DK' },
        { region: 'EE' },
        { region: 'ER' },
        { region: 'ES' },
        { region: 'FI' },
        { region: 'FR' },
        { region: 'GG' },
        { region: 'GI' },
        { region: 'GR' },
        { region: 'HR' },
        { region: 'HU' },
        { region: 'IE' },
        { region: 'IL' },
        { region: 'IM' },
        { region: 'IN' },
        { region: 'IS' },
        { region: 'IT' },
        { region: 'JE' },
        { region: 'LI' },
        { region: 'LS' },
        { region: 'LT' },
        { region: 'LU' },
        { region: 'LV' },
        { region: 'MC' },
        { region: 'ME' },
        { region: 'MK' },
        { region: 'ML' },
        { region: 'MR' },
        { region: 'MT' },
        { region: 'MZ' },
        { region: 'NA' },
        { region: 'NE' },
        { region: 'NL' },
        { region: 'NO' },
        { region: 'NZ' },
        { region: 'PL' },
        { region: 'PT' },
        { region: 'RO' },
        { region: 'RS' },
        { region: 'RU' },
        { region: 'SD' },
        { region: 'SE' },
        { region: 'SI' },
        { region: 'SK' },
        { region: 'SM' },
        { region: 'SO' },
        { region: 'SZ' },
        { region: 'TD' },
        { region: 'TR' },
        { region: 'VA' },
        { region: 'ZA' },
        { region: 'ZM' },
        { region: 'ZW' },
    ],
    JPN: [{ region: 'JP' }],
    KOR: [{ region: 'KR' }],
    CHN: [{ region: 'CN' }],
    TWN: [{ region: 'TW' }, { region: 'HK' }],
};

const samuraiNusSources: SamuraiCatalogSource[] = (
    Object.entries(samuraiMajorRegionSources) as [
        MajorRegion,
        readonly { region: string; lang?: string }[],
    ][]
).flatMap(([majorRegion, regions]) =>
    regions.flatMap(({ region, lang }): SamuraiCatalogSource[] => [
        {
            platform: '3ds',
            device: 'CTR',
            shopId: 1,
            majorRegion,
            region,
            lang,
        },
        {
            platform: 'wiiu',
            device: 'WUP',
            shopId: 2,
            majorRegion,
            region,
            lang,
        },
    ])
);

const samuraiPreferredSourceCountriesByProductCodeSuffix: Readonly<
    Record<string, readonly string[]>
> = {
    A: ['GB', 'US'],
    C: ['CN'],
    D: ['DE'],
    E: ['US'],
    F: ['FR'],
    H: ['GB'],
    I: ['IT'],
    J: ['JP'],
    K: ['KR'],
    P: ['GB'],
    R: ['RU'],
    S: ['ES'],
    V: ['IT'],
    W: ['TW', 'HK'],
    X: ['GB'],
    Y: ['GB'],
    Z: ['GB'],
};

const ninjaIdPairUrl =
    'https://ninja.wup.shop.nintendo.net/ninja/ws/titles/id_pair';
const samuraiUrls: {
    readonly '3ds': SamuraiPlatformUrls;
    readonly wiiu: SamuraiPlatformUrls;
} = {
    '3ds': {
        contents:
            'https://samurai.ctr.shop.nintendo.net/samurai/ws/%s/contents/',
        languages:
            'https://samurai.ctr.shop.nintendo.net/samurai/ws/%s/languages',
        title: 'https://samurai.ctr.shop.nintendo.net/samurai/ws/%s/title/%s',
    },
    wiiu: {
        contents:
            'https://samurai.wup.shop.nintendo.net/samurai/ws/%s/contents/',
        languages:
            'https://samurai.wup.shop.nintendo.net/samurai/ws/%s/languages',
        title: 'https://samurai.wup.shop.nintendo.net/samurai/ws/%s/title/%s',
    },
};
const tagayaLatestVersionUrl =
    'https://tagaya.wup.shop.nintendo.net/tagaya/versionlist/ZZZ/ZZ/latest_version';
const tagayaVersionListUrl =
    'https://tagaya.wup.shop.nintendo.net/tagaya/versionlist/ZZZ/ZZ/list/%s.versionlist';
const threeDSVersionListUrl =
    'https://tagaya-ctr.cdn.nintendo.net/tagaya/versionlist';
const ninjaIdPairBatchSize = 100;

const nusDatabases = new Map<TitleLookupPlatform, NusDatabase>();

const legacyNusKeyNames: { [key: string]: string } = {
    available_on_cdn: 'availableOnCdn',
    banner_url: 'bannerUrl',
    company_code: 'companyCode',
    default_language: 'defaultLanguage',
    display_genre: 'displayGenre',
    download_card: 'downloadCard',
    download_code: 'downloadCode',
    formal_name: 'formalName',
    icon_url: 'iconUrl',
    language_codes: 'languageCodes',
    language_names: 'languageNames',
    ns_uid: 'nsUid',
    number_of_players: 'numberOfPlayers',
    platform_id: 'platformId',
    play_styles: 'playStyles',
    product_code: 'productCode',
    publisher_id: 'publisherId',
    rating_system: 'ratingSystem',
    rating_systems: 'ratingSystems',
    release_dates: 'releaseDates',
    title_id: 'titleId',
    top_image: 'topImage',
    web_sites: 'webSites',
};

const wiiUTdbZipUrl = 'https://www.gametdb.com/wiiutdb.zip';
const threeDSTdbZipUrl = 'https://www.gametdb.com/3dstdb.zip';
const wiiTdbZipUrl = 'https://www.gametdb.com/wiitdb.zip';

// Maybe useful later?
// https://ninja.ctr.shop.nintendo.net/ninja/ws/titles/id_pair?ns_uid[]=
// https://ninja.ctr.shop.nintendo.net/ninja/ws/titles/id_pair?title_id[]=
// https://ninja.ctr.shop.nintendo.net/ninja/ws/{countryCode}/title/{eShopId}/ec_info
// https://samurai.wup.shop.nintendo.net/samurai/ws/{countryCode}/titles?shop_id=2&limit=10000
// https://samurai.wup.shop.nintendo.net/samurai/ws/{countryCode}/title/{eShopId}
// https://tagaya.wup.shop.nintendo.net/tagaya/versionlist/ZZZ/ZZ/latest_version
// https://tagaya-wup.cdn.nintendo.net/tagaya/versionlist/ZZZ/ZZ/list/{latestVersion}.versionlist

const userAgent = 'ROM Rack';

const parallel = 16;
const limitVersionRequest = createRequestLimiter(parallel);

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
});

const samuraiRepeatedElements = new Set([
    'content',
    'controller',
    'descriptor',
    'feature',
    'genre',
    'icon',
    'image_url',
    'keyword',
    'language',
    'play_style',
    'screenshot',
    'thumbnail',
    'web_site',
]);
const samuraiParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
    isArray: (name) => samuraiRepeatedElements.has(name),
});

const root = process.cwd();
const titlesDir = path.join(root, 'titles');
const imagesDir = path.join(root, 'images');

const titlesFile = path.join(titlesDir, 'titles.json');
const iconsFile = path.join(titlesDir, 'icons.json');

const wiiTdbFile = path.join(titlesDir, 'wii/tdb.xml');

const wiiUTdbFile = path.join(titlesDir, 'wiiu/tdb.xml');
const wiiUBrewFile = path.join(titlesDir, 'wiiu/wiiubrew.csv');
const wiiUNusFile = path.join(titlesDir, 'wiiu/nus.json');

const threeDSTdbFile = path.join(titlesDir, '3ds/tdb.xml');
const threeDSHShopFile = path.join(titlesDir, '3ds/hshop.json');
const threeDSNusFile = path.join(titlesDir, '3ds/nus.json');

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

function getRawTitleIdentity(entry: RawTitleDatabaseEntry): string {
    const identity = entry.titleId ?? entry.productCode;
    if (!identity) {
        throw new Error('Raw title is missing an identity');
    }
    return identity;
}

function sortRawTitlesByIdentity<T extends RawTitleDatabaseEntry>(
    entries: T[]
): T[] {
    return entries.toSorted((a, b) =>
        getRawTitleIdentity(a).localeCompare(getRawTitleIdentity(b))
    );
}

function sortByTitleId<T extends { titleId: string }>(entries: T[]): T[] {
    return entries.toSorted((a, b) => a.titleId.localeCompare(b.titleId));
}

function parseVersions(value?: string): number[] {
    const matches = [...(value ?? '').matchAll(/v?\s*(\d+)/gi)];
    return matches
        .map((match) => Number.parseInt(match[1], 10))
        .filter((version) => Number.isFinite(version));
}

async function readOptionalJson(file: string): Promise<unknown> {
    const contents = await readOptionalFile(file);
    return contents ? (JSON.parse(contents.toString('utf8')) as unknown) : null;
}

async function readOptionalJsonArray(file: string): Promise<unknown[]> {
    const value = await readOptionalJson(file);
    return Array.isArray(value) ? Array.from(value as unknown[]) : [];
}

async function writeJson(file: string, value: unknown): Promise<void> {
    await fs.writeFile(file, `${JSON.stringify(value, null, 4)}\n`, 'utf8');
}

function parseGenerateOptions(args: string[]): GenerateOptions {
    const options: GenerateOptions = {
        refreshMetadata: false,
        refreshCatalog: false,
        refreshTdb: false,
        refreshVersions: false,

        extractIcons: false,

        scanGeneratedRanges: false,

        limit: 0,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        switch (arg) {
            case '--':
                break;

            case '--refresh-catalog':
                options.refreshCatalog = true;
                break;
            case '--refresh-metadata':
                options.refreshMetadata = true;
                break;
            case '--refresh-tdb':
                options.refreshTdb = true;
                break;
            case '--refresh-versions':
                options.refreshVersions = true;
                break;
            case '--refresh-all':
                options.refreshCatalog = true;
                options.refreshMetadata = true;
                options.refreshTdb = true;
                options.refreshVersions = true;
                break;

            case '--extract-icons':
                options.extractIcons = true;
                break;

            case '--scan-generated-ranges':
                options.scanGeneratedRanges = true;
                break;

            case '--limit': {
                const argument = args[index + 1] ?? '';
                const value = Number.parseInt(argument, 10);

                if (value < 2 || !/^\d+$/.test(argument)) {
                    throw new Error(
                        '--limit requires an integer of at least 2'
                    );
                }

                options.limit = value;
                index += 1;

                break;
            }

            default:
                throw new Error(`Unknown generate-titles option: ${arg}`);
        }
    }

    if (
        options.scanGeneratedRanges &&
        (!options.refreshCatalog || !options.refreshMetadata)
    ) {
        throw new Error(
            '--scan-generated-ranges requires --refresh-catalog and --refresh-metadata'
        );
    }
    if (options.limit !== 0 && !options.refreshCatalog) {
        throw new Error('--limit requires --refresh-catalog');
    }
    if (options.limit !== 0 && options.refreshVersions) {
        throw new Error('--limit cannot be combined with --refresh-versions');
    }
    if (options.extractIcons && !options.refreshMetadata) {
        throw new Error('--extract-icons requires --refresh-metadata');
    }

    return options;
}

async function fetchBinary(url: string): Promise<Buffer> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': userAgent,
        },
    });
    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

async function downloadSourceText(
    url: string,
    certificate?: Pick<DownloadOptions, 'cert' | 'key'>
): Promise<string> {
    return (await downloadSourceBytes(url, certificate)).toString('utf8');
}

function downloadSourceBytes(
    url: string,
    certificate?: Pick<DownloadOptions, 'cert' | 'key'>
): Promise<Buffer> {
    return downloadBytes(url, 'title source', {
        ...certificate,
        allowSelfSignedCertificate: true,
        logDownload: false,
        headers: { 'User-Agent': userAgent },
    });
}

async function mapPool<T, R>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T, index: number, workerIndex: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results: R[] = Array.from({ length: items.length });
    let nextIndex = 0;
    let failure: { error: unknown } | null = null;
    const workerCount = Math.max(
        1,
        Math.min(Math.floor(concurrency) || 1, items.length)
    );

    async function run(workerIndex: number): Promise<void> {
        while (nextIndex < items.length && failure === null) {
            const index = nextIndex;
            nextIndex += 1;
            try {
                results[index] = await worker(items[index], index, workerIndex);
            } catch (error) {
                failure ??= { error };
            }
        }
    }

    await Promise.all(
        Array.from({ length: workerCount }, (_, workerIndex) =>
            run(workerIndex)
        )
    );

    const caughtFailure = failure as { error: unknown } | null;
    if (caughtFailure !== null) {
        throw caughtFailure.error;
    }

    return results;
}

function createRequestLimiter(concurrency: number) {
    const limit = Math.max(1, Math.floor(concurrency) || 1);
    let active = 0;
    const waiting: (() => void)[] = [];

    const release = (): void => {
        active -= 1;
        waiting.shift()?.();
    };

    return async <T>(operation: () => Promise<T>): Promise<T> => {
        if (active >= limit) {
            await new Promise<void>((resolve) => waiting.push(resolve));
        }
        active += 1;
        try {
            return await operation();
        } finally {
            release();
        }
    };
}

function getSamuraiContentsUrl(source: SamuraiCatalogSource): string {
    const parameters = new URLSearchParams({
        shop_id: source.shopId.toString(),
        limit: '10000',
    });
    if (source.lang) {
        parameters.set('lang', source.lang);
    }

    return `${samuraiUrls[source.platform].contents.replace('%s', source.region)}?${parameters.toString()}`;
}

function parseSamuraiCatalogTitles(
    xml: string,
    source: SamuraiCatalogSource
): SamuraiCatalogTitle[] {
    const parsed = samuraiParser.parse(xml) as SamuraiResponse;
    const titles: SamuraiCatalogTitle[] = [];

    for (const content of parsed.eshop?.contents?.content ?? []) {
        const title = content.title;
        const nsUid = title?.['@id'] ?? '';
        if (
            nsUid === '' ||
            !/^\d+$/.test(nsUid) ||
            title?.platform?.['@device'] !== source.device
        ) {
            continue;
        }

        titles.push({
            nsUid,
            source,
            name: normalizeTitleName(title.name ?? ''),
            productCode: title.product_code?.trim() || null,
            iconUrl: title.icon_url?.trim() || null,
        });
    }

    return titles;
}

async function loadSamuraiCatalogSource(
    source: SamuraiCatalogSource
): Promise<SamuraiCatalogTitle[]> {
    try {
        return parseSamuraiCatalogTitles(
            await downloadSourceText(getSamuraiContentsUrl(source)),
            source
        );
    } catch (error) {
        console.warn(
            `[samurai] ${source.platform} ${source.region} catalog unavailable: ${String(error)}`
        );
        return [];
    }
}

function uniqueSamuraiTitlesByNsUid(
    titles: readonly SamuraiCatalogTitle[]
): Map<string, SamuraiCatalogTitle> {
    const unique = new Map<string, SamuraiCatalogTitle>();
    for (const title of titles) {
        if (!unique.has(title.nsUid)) {
            unique.set(title.nsUid, title);
        }
    }
    return unique;
}

function logSamuraiRegionCounts(
    platform: TitleLookupPlatform,
    titlesBySource: ReadonlyMap<SamuraiCatalogSource, SamuraiCatalogTitle[]>
): void {
    for (const majorRegion of Object.keys(
        samuraiMajorRegionSources
    ) as MajorRegion[]) {
        const sources = samuraiNusSources.filter(
            (source) =>
                source.platform === platform &&
                source.majorRegion === majorRegion
        );
        const available = sources.filter(
            (source) => (titlesBySource.get(source)?.length ?? 0) > 0
        );
        if (available.length === 0) {
            continue;
        }

        const baseline = available[0];
        const baselineTitles = uniqueSamuraiTitlesByNsUid(
            titlesBySource.get(baseline) ?? []
        );
        console.log(
            `[samurai] ${platform} ${majorRegion} ${baseline.region}: ${baselineTitles.size.toString()} titles (baseline)`
        );

        for (const source of available.slice(1)) {
            const titles = uniqueSamuraiTitlesByNsUid(
                titlesBySource.get(source) ?? []
            );
            let additions = 0;
            for (const nsUid of titles.keys()) {
                if (!baselineTitles.has(nsUid)) {
                    additions += 1;
                }
            }
            console.log(
                `[samurai] ${platform} ${majorRegion} ${source.region}: ${titles.size.toString()} titles, +${additions.toString()} vs ${baseline.region}`
            );
        }
    }
}

function choosePreferredSamuraiTitles(
    platform: TitleLookupPlatform,
    titlesBySource: ReadonlyMap<SamuraiCatalogSource, SamuraiCatalogTitle[]>
): SamuraiCatalogTitle[] {
    const selected = new Map<string, SamuraiCatalogTitle>();

    for (const source of samuraiNusSources.filter(
        (candidate) => candidate.platform === platform
    )) {
        for (const title of titlesBySource.get(source) ?? []) {
            const identity = `${source.majorRegion}:${title.nsUid}`;
            const existing = selected.get(identity);
            if (
                !existing ||
                getSamuraiSourcePriority(title) <
                    getSamuraiSourcePriority(existing)
            ) {
                selected.set(identity, title);
            }
        }
    }

    return [...selected.values()];
}

function getSamuraiSourcePriority(title: SamuraiCatalogTitle): number {
    const productCodeSuffix = title.productCode?.at(-1)?.toUpperCase();
    const preferredCountries =
        productCodeSuffix === undefined
            ? undefined
            : samuraiPreferredSourceCountriesByProductCodeSuffix[
                  productCodeSuffix
              ];
    const index = preferredCountries?.indexOf(title.source.region) ?? -1;
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
    const output: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        output.push(values.slice(index, index + size));
    }
    return output;
}

function parseNinjaIdPairs(xml: string): NinjaIdPair[] {
    const parsed = parser.parse(xml) as NinjaIdPairResponse;
    const pairs: NinjaIdPair[] = [];

    for (const pair of toArray(parsed.eshop?.title_id_pairs?.title_id_pair)) {
        const nsUid = pair.ns_uid ?? '';
        const title = identifyTitle(pair.title_id ?? '');
        if (
            /^\d+$/.test(nsUid) &&
            (title?.platform === '3ds' || title?.platform === 'wiiu')
        ) {
            pairs.push({ nsUid, titleId: title.titleId });
        }
    }

    return pairs;
}

function ninjaIdPairRequestUrl(nsUids: readonly string[]): string {
    const parameters = new URLSearchParams({
        'ns_uid[]': nsUids.join(','), // I don't know, that's just how it works.
    });

    return `${ninjaIdPairUrl}?${parameters.toString()}`;
}

async function loadNinjaIdPairBatch(
    nsUids: readonly string[],
    certificate: Pick<DownloadOptions, 'cert' | 'key'>
): Promise<NinjaIdPair[]> {
    try {
        return parseNinjaIdPairs(
            await downloadSourceText(ninjaIdPairRequestUrl(nsUids), certificate)
        );
    } catch (error) {
        if (isHttpErrorStatus(error, 400) && nsUids.length > 1) {
            const middle = Math.ceil(nsUids.length / 2);
            const [left, right] = await Promise.all([
                loadNinjaIdPairBatch(nsUids.slice(0, middle), certificate),
                loadNinjaIdPairBatch(nsUids.slice(middle), certificate),
            ]);
            return [...left, ...right];
        }

        if (isHttpErrorStatus(error, 400) && nsUids.length === 1) {
            console.warn(
                `[ninja] NS UID ${nsUids[0]} rejected: ${error.message}`
            );
            return [];
        }

        throw error;
    }
}

async function loadNinjaIdPairs(
    nsUids: readonly string[]
): Promise<NinjaIdPair[]> {
    if (nsUids.length === 0) {
        return [];
    }

    const certificate = await loadNinjaClientCertificate();
    const uniqueNsUids = [...new Set(nsUids)];
    const batches = chunks(uniqueNsUids, ninjaIdPairBatchSize);
    const results = await mapPool(batches, parallel, (batch) =>
        loadNinjaIdPairBatch(batch, certificate)
    );

    return results.flat();
}

async function loadNinjaClientCertificate(): Promise<
    Pick<DownloadOptions, 'cert' | 'key'>
> {
    const { cert, key } = await loadThreeDSClientCertificateOptions();
    if (!cert || !key) {
        throw new Error(
            '3DS download options did not include a client certificate and private key'
        );
    }

    return { cert, key };
}

function getNusDatabase(platform: TitleLookupPlatform): NusDatabase {
    const existing = nusDatabases.get(platform);
    if (existing) {
        return existing;
    }
    const database: NusDatabase = {
        languages: {},
        platforms: {},
        publishers: {},
        genres: {},
        ratingSystems: {},
        ratings: {},
        languageNames: {},
        features: {},
        controllers: {},
        titles: [],
    };
    nusDatabases.set(platform, database);
    return database;
}

function getSamuraiLanguagesUrl(
    source: SamuraiCatalogSource,
    language?: string
): string {
    const parameters = new URLSearchParams({ shop_id: String(source.shopId) });
    if (language) {
        parameters.set('lang', language);
    }
    const url = samuraiUrls[source.platform].languages.replace(
        '%s',
        source.region
    );
    return `${url}?${parameters.toString()}`;
}

function getSamuraiTitleUrl(
    source: SamuraiCatalogSource,
    nsUid: string
): string {
    const url = samuraiUrls[source.platform].title
        .replace('%s', source.region)
        .replace('%s', nsUid);
    return `${url}?shop_id=${String(source.shopId)}`;
}

function parseSamuraiImage(value: SamuraiImage | undefined): NusImage | null {
    const url = value?.['#text'] ?? value?.['@url'];
    return url
        ? {
              type: value?.['@type'] ?? 'image',
              url,
          }
        : null;
}

function parseSamuraiImages(title: SamuraiTitle): NusImages | null {
    const screenshots = (title.screenshots?.screenshot ?? []).map(
        (screenshot, index) => {
            const imageValues = screenshot.image_url ?? [];
            const items = imageValues.flatMap((item) => {
                const parsed = parseSamuraiImage(item);
                return parsed ? [parsed] : [];
            });
            const thumbnail = parseSamuraiImage(screenshot.thumbnail_url);
            if (thumbnail) {
                items.push({ ...thumbnail, type: 'thumbnail' });
            }
            return {
                index: imageValues[0]?.['@index'] ?? String(index + 1),
                images: items,
            };
        }
    );
    const thumbnails = (title.thumbnails?.thumbnail ?? []).flatMap((value) => {
        const url = value['@url'];
        return url
            ? [
                  {
                      type: value['@type'] ?? null,
                      width: value['@width'] ?? null,
                      height: value['@height'] ?? null,
                      url,
                  },
              ]
            : [];
    });
    if (
        !title.icon_url &&
        !title.banner_url &&
        !title.top_image &&
        thumbnails.length === 0 &&
        screenshots.length === 0
    ) {
        return null;
    }
    return {
        iconUrl: title.icon_url ?? null,
        bannerUrl: title.banner_url ?? null,
        topImage: title.top_image ?? null,
        thumbnails,
        screenshots,
    };
}

function addLocalizedLookup(
    table: { [id: string]: LocalizedLookup },
    id: string | null,
    language: string,
    name: string | null,
    fields: Omit<LocalizedLookup, 'names'> = {}
): void {
    if (!id) {
        return;
    }
    const existing = table[id];
    const icons = mergeOptionalUniqueValues(existing?.icons, fields.icons);
    const entry: LocalizedLookup = {
        ...fields,
        ...existing,
        platform: existing?.platform ?? fields.platform,
        device: existing?.device ?? fields.device,
        category: existing?.category ?? fields.category,
        type: existing?.type ?? fields.type,
        ...(icons ? { icons } : {}),
    };
    if (name) {
        entry.names = {
            [language]: name,
            ...entry.names,
        };
    }
    table[id] = entry;
}

function parseLookupIconList(value: SamuraiNamedItem): NusImage[] {
    return (value.icons?.icon ?? []).flatMap((item) => {
        const parsed = parseSamuraiImage(item);
        return parsed ? [parsed] : [];
    });
}

function addSamuraiLookups(
    database: NusDatabase,
    title: SamuraiTitle,
    language: string,
    platform: TitleLookupPlatform
): void {
    const platformValue = title.platform;
    addLocalizedLookup(
        database.platforms,
        platformValue?.['@id'] ?? null,
        language,
        platformValue?.name ?? null,
        {
            platform,
            device: platformValue?.['@device'] ?? null,
            category: platformValue?.['@category'] ?? null,
        }
    );
    const publisher = title.publisher;
    addLocalizedLookup(
        database.publishers,
        publisher?.['@id'] ?? null,
        language,
        publisher?.name ?? null
    );
    for (const value of title.genres?.genre ?? []) {
        addLocalizedLookup(
            database.genres,
            value['@id'] ?? null,
            language,
            value.name ?? null
        );
    }
    const ratingInfo = title.rating_info;
    const ratingSystem = ratingInfo?.rating_system;
    addLocalizedLookup(
        database.ratingSystems,
        ratingSystem?.['@id'] ?? null,
        language,
        ratingSystem?.name ?? null
    );
    const rating = ratingInfo?.rating;
    const ratingSystemId = ratingSystem?.['@id'];
    const ratingId = rating?.['@id'];
    if (ratingSystemId && ratingId) {
        const ratings = database.ratings[ratingSystemId] ?? {};
        ratings[ratingId] = ratings[ratingId] ?? {
            icons: parseLookupIconList(rating),
        };
        database.ratings[ratingSystemId] = ratings;
    }
    for (const value of title.languages?.language ?? []) {
        addLocalizedLookup(
            database.languageNames,
            value.iso_code ?? null,
            language,
            value.name ?? null
        );
    }
    const playStyles = title.play_styles?.play_style ?? [];
    const featureValues = [
        ...(title.features?.feature ?? []),
        ...playStyles.flatMap((value) => value.features?.feature ?? []),
    ];
    for (const value of featureValues) {
        addLocalizedLookup(
            database.features,
            value.id ?? null,
            language,
            value.name ?? null,
            {
                type: value['@type'] ?? null,
                icons: parseLookupIconList(value),
            }
        );
    }
    for (const playStyle of playStyles) {
        for (const value of playStyle.controllers?.controller ?? []) {
            addLocalizedLookup(
                database.controllers,
                value.id ?? null,
                language,
                value.name ?? null,
                { type: value['@type'] ?? null }
            );
        }
    }
}

function parseLocalizedSamuraiFields(title: SamuraiTitle): NusLocalization {
    return {
        name: title.name,
        formalName: title.formal_name,
        description: title.description,
        displayGenre: title.display_genre,
        numberOfPlayers: title.number_of_players,
        keywords: title.keywords?.keyword ?? [],
        webSites: (title.web_sites?.web_site ?? []).map((site) => ({
            name: site.name ?? null,
            url: site.url ?? null,
            official: site.official === 'true',
        })),
        disclaimer: title.disclaimer,
        copyright: title.copyright?.text,
    };
}

function parseSamuraiRating(title: SamuraiTitle): NusRating {
    const ratingInfo = title.rating_info;
    return {
        ratingSystem: ratingInfo?.rating_system?.['@id'] ?? null,
        rating: ratingInfo?.rating?.['@id'] ?? null,
        descriptors: (ratingInfo?.descriptors?.descriptor ?? []).flatMap(
            (value) => (value.name ? [value.name] : [])
        ),
    };
}

function parseSamuraiTitleDetails(
    title: SamuraiTitle,
    catalogTitle: SamuraiCatalogTitle,
    titleId: string,
    language: string
): NusTitle {
    const playStyles = title.play_styles?.play_style ?? [];
    const relationships = (values: SamuraiNamedItem[]): NusTitle['features'] =>
        values.flatMap((value) => {
            return value.id
                ? [{ id: value.id, required: value['@required'] === 'true' }]
                : [];
        });
    const features = relationships([
        ...(title.features?.feature ?? []),
        ...playStyles.flatMap((value) => value.features?.feature ?? []),
    ]);
    const controllers = relationships(
        playStyles.flatMap((value) => value.controllers?.controller ?? [])
    );
    const genres = (title.genres?.genre ?? []).flatMap((value) =>
        value['@id'] ? [value['@id']] : []
    );
    const languageCodes = (title.languages?.language ?? []).flatMap((value) =>
        value.iso_code ? [value.iso_code.toLowerCase()] : []
    );
    const rating = parseSamuraiRating(title);
    return {
        titleId,
        nsUid: catalogTitle.nsUid,
        productCode: title.product_code ?? null,
        localizations: { [language]: parseLocalizedSamuraiFields(title) },
        platformId: title.platform?.['@id'] ?? null,
        publisherId: title.publisher?.['@id'] ?? null,
        images: parseSamuraiImages(title),
        features,
        controllers,
        playStyles: playStyles.flatMap((value) =>
            value['@type'] ? [value['@type']] : []
        ),
        genres,
        languageCodes,
        releaseDates: {
            eshop: title.release_date_on_eshop ?? null,
            original: title.release_date_on_original ?? null,
            retail: title.release_date_on_retail ?? null,
        },
        ratings:
            rating.ratingSystem || rating.rating || rating.descriptors?.length
                ? { [catalogTitle.source.region]: rating }
                : null,
        sales: {
            retail: title.retail_sales === 'true',
            eshop: title.eshop_sales === 'true',
            web: title.web_sales === 'true',
            downloadCode: title.download_code_sales === 'true',
            downloadCard: title.download_card_sales?.['@available'] === 'true',
            iap: title.in_app_purchase === 'true',
        },
        baseVersions: [],
        updateVersions: [],
        dlcVersions: [],
        availableOnCdn: false,
    };
}

function mergeSamuraiRelationships(
    target: NusTitle,
    source: NusTitle,
    key: 'features' | 'controllers'
): void {
    const merged = new Map(
        [...source[key], ...target[key]].map((value) => [value.id, value])
    );
    target[key] = [...merged.values()];
}

function mergeUniqueValues<T>(
    existing: readonly T[],
    incoming: readonly T[]
): T[] {
    const merged = new Map<string, T>();
    for (const value of [...existing, ...incoming]) {
        const identity = JSON.stringify(value);
        if (!merged.has(identity)) {
            merged.set(identity, value);
        }
    }
    return [...merged.values()];
}

function mergeOptionalUniqueValues<T>(
    existing: readonly T[] | undefined,
    incoming: readonly T[] | undefined
): T[] | undefined {
    return existing || incoming
        ? mergeUniqueValues(existing ?? [], incoming ?? [])
        : undefined;
}

function mergeLocalization(
    existing: NusLocalization | undefined,
    incoming: NusLocalization | undefined
): NusLocalization {
    return {
        name: existing?.name ?? incoming?.name,
        formalName: existing?.formalName ?? incoming?.formalName,
        description: existing?.description ?? incoming?.description,
        displayGenre: existing?.displayGenre ?? incoming?.displayGenre,
        numberOfPlayers: existing?.numberOfPlayers ?? incoming?.numberOfPlayers,
        keywords: mergeOptionalUniqueValues(
            existing?.keywords,
            incoming?.keywords
        ),
        webSites: mergeOptionalUniqueValues(
            existing?.webSites,
            incoming?.webSites
        ),
        disclaimer: existing?.disclaimer ?? incoming?.disclaimer,
        copyright: existing?.copyright ?? incoming?.copyright,
    };
}

function mergeRatings(
    existing: NusRatings | null,
    incoming: NusRatings | null
): NusRatings | null {
    if (!existing && !incoming) {
        return null;
    }

    const countries = new Set([
        ...Object.keys(existing ?? {}),
        ...Object.keys(incoming ?? {}),
    ]);
    return Object.fromEntries(
        [...countries].map((country) => {
            const existingRating = existing?.[country];
            const incomingRating = incoming?.[country];
            return [
                country,
                {
                    ratingSystem:
                        existingRating?.ratingSystem ??
                        incomingRating?.ratingSystem,
                    rating: existingRating?.rating ?? incomingRating?.rating,
                    descriptors: mergeOptionalUniqueValues(
                        existingRating?.descriptors,
                        incomingRating?.descriptors
                    ),
                },
            ];
        })
    );
}

function mergeSamuraiTitleDetails(target: NusTitle, source: NusTitle): void {
    const languages = new Set([
        ...Object.keys(target.localizations),
        ...Object.keys(source.localizations),
    ]);
    target.localizations = Object.fromEntries(
        [...languages].map((language) => [
            language,
            mergeLocalization(
                target.localizations[language],
                source.localizations[language]
            ),
        ])
    );
    target.ratings = mergeRatings(target.ratings, source.ratings);
    mergeSamuraiRelationships(target, source, 'features');
    mergeSamuraiRelationships(target, source, 'controllers');
    target.playStyles = [
        ...new Set([...target.playStyles, ...source.playStyles]),
    ];
    target.genres = [...new Set([...target.genres, ...source.genres])];
    target.languageCodes = [
        ...new Set([...target.languageCodes, ...source.languageCodes]),
    ];
}

function mergeNusTitleDetails(
    existing: NusTitle | undefined,
    incoming: NusTitle | undefined
): NusTitle | undefined {
    if (!existing) {
        return incoming;
    }
    if (!incoming) {
        return existing;
    }

    const merged = structuredClone(existing);
    mergeSamuraiTitleDetails(merged, incoming);
    return {
        ...incoming,
        ...merged,
        nsUid: existing.nsUid ?? incoming.nsUid,
        productCode: existing.productCode ?? incoming.productCode,
        platformId: existing.platformId ?? incoming.platformId,
        region: existing.region || incoming.region,
        publisherId: existing.publisherId ?? incoming.publisherId,
        companyCode: existing.companyCode ?? incoming.companyCode,
        localizations: merged.localizations,
        baseVersions: mergeVersions(
            existing.baseVersions,
            incoming.baseVersions
        ),
        updateVersions: mergeVersions(
            existing.updateVersions,
            incoming.updateVersions
        ),
        dlcVersions: mergeVersions(existing.dlcVersions, incoming.dlcVersions),
        images:
            existing.images || incoming.images
                ? {
                      ...incoming.images,
                      ...existing.images,
                      iconUrl:
                          existing.images?.iconUrl ?? incoming.images?.iconUrl,
                      bannerUrl:
                          existing.images?.bannerUrl ??
                          incoming.images?.bannerUrl,
                      topImage:
                          existing.images?.topImage ??
                          incoming.images?.topImage,
                      thumbnails: mergeOptionalUniqueValues(
                          existing.images?.thumbnails,
                          incoming.images?.thumbnails
                      ),
                      screenshots: mergeOptionalUniqueValues(
                          existing.images?.screenshots,
                          incoming.images?.screenshots
                      ),
                  }
                : null,
        ratings: merged.ratings,
        features: merged.features,
        controllers: merged.controllers,
        playStyles: merged.playStyles,
        genres: merged.genres,
        languageCodes: merged.languageCodes,
        releaseDates: {
            eshop: existing.releaseDates.eshop ?? incoming.releaseDates.eshop,
            original:
                existing.releaseDates.original ??
                incoming.releaseDates.original,
            retail:
                existing.releaseDates.retail ?? incoming.releaseDates.retail,
        },
        sales: {
            retail: existing.sales.retail || incoming.sales.retail,
            eshop: existing.sales.eshop || incoming.sales.eshop,
            web: existing.sales.web || incoming.sales.web,
            downloadCode:
                existing.sales.downloadCode || incoming.sales.downloadCode,
            downloadCard:
                existing.sales.downloadCard || incoming.sales.downloadCard,
            iap: existing.sales.iap || incoming.sales.iap,
        },
        availableOnCdn: existing.availableOnCdn || incoming.availableOnCdn,
    };
}

function deduplicateLocalizedNames(names: LocalizedText): LocalizedText {
    const seen = new Set<string>();
    return Object.fromEntries(
        Object.entries(names)
            .toSorted(([left], [right]) => {
                if (left === 'en') {
                    return -1;
                }
                if (right === 'en') {
                    return 1;
                }
                return left.localeCompare(right);
            })
            .filter(([, name]) => {
                if (seen.has(name)) {
                    return false;
                }
                seen.add(name);
                return true;
            })
    );
}

function deduplicateLookupNames(
    table: NusDatabase['platforms']
): NusDatabase['platforms'] {
    return Object.fromEntries(
        Object.entries(table).map(([id, entry]) => [
            id,
            entry.names
                ? { ...entry, names: deduplicateLocalizedNames(entry.names) }
                : entry,
        ])
    );
}

function collapseDuplicateLocalizationFields(
    localizations: NusTitle['localizations']
): NusTitle['localizations'] {
    const languages = Object.keys(localizations).toSorted((left, right) => {
        if (left === 'en') {
            return -1;
        }
        if (right === 'en') {
            return 1;
        }
        return left.localeCompare(right);
    });
    const valuesByField = new Map<keyof NusLocalization, Set<string>>();

    return Object.fromEntries(
        languages.map((language) => {
            const fields = Object.entries(localizations[language]).filter(
                ([field, value]) => {
                    if (value === null || value === undefined) {
                        return false;
                    }
                    const key = field as keyof NusLocalization;
                    const values = valuesByField.get(key) ?? new Set<string>();
                    const signature = JSON.stringify(value);
                    if (values.has(signature)) {
                        return false;
                    }
                    values.add(signature);
                    valuesByField.set(key, values);
                    return true;
                }
            );
            return [language, Object.fromEntries(fields)];
        })
    );
}

function orderLocalizationFields(
    localization: NusLocalization
): NusLocalization {
    return {
        name: localization.name,
        formalName: localization.formalName,
        description: localization.description,
        displayGenre: localization.displayGenre,
        numberOfPlayers: localization.numberOfPlayers,
        keywords: localization.keywords,
        webSites: localization.webSites,
        disclaimer: localization.disclaimer,
        copyright: localization.copyright,
    };
}

function finalizeLocalizations(
    localizations: NusTitle['localizations']
): NusTitle['localizations'] {
    const collapsed = collapseDuplicateLocalizationFields(localizations);
    return Object.fromEntries(
        Object.entries(collapsed).map(([language, localization]) => [
            language,
            orderLocalizationFields(localization),
        ])
    );
}

function collapseDuplicateRatingFields(ratings: NusRatings): NusRatings {
    const countries = Object.keys(ratings).toSorted((left, right) => {
        if (left === 'US') {
            return -1;
        }
        if (right === 'US') {
            return 1;
        }
        return left.localeCompare(right);
    });
    const valuesByField = new Map<keyof NusRating, Set<string>>();

    return Object.fromEntries(
        countries.map((country) => {
            const fields = Object.entries(ratings[country]).filter(
                ([field, value]) => {
                    const key = field as keyof NusRating;
                    const values = valuesByField.get(key) ?? new Set<string>();
                    const signature = JSON.stringify(value);
                    if (values.has(signature)) {
                        return false;
                    }
                    values.add(signature);
                    valuesByField.set(key, values);
                    return true;
                }
            );
            return [country, Object.fromEntries(fields)];
        })
    );
}

function finalizeNusDatabase(database: NusDatabase): void {
    database.languages = Object.fromEntries(
        Object.entries(database.languages).toSorted(([left], [right]) =>
            left.localeCompare(right)
        )
    );
    database.platforms = deduplicateLookupNames(database.platforms);
    database.publishers = deduplicateLookupNames(database.publishers);
    database.genres = deduplicateLookupNames(database.genres);
    database.ratingSystems = deduplicateLookupNames(database.ratingSystems);
    database.languageNames = deduplicateLookupNames(database.languageNames);
    database.features = deduplicateLookupNames(database.features);
    database.controllers = deduplicateLookupNames(database.controllers);
    database.titles = database.titles.map((title) => ({
        ...title,
        localizations: finalizeLocalizations(title.localizations),
        ratings: title.ratings
            ? collapseDuplicateRatingFields(title.ratings)
            : null,
    }));
}

async function loadSamuraiStorefrontLanguages(
    source: SamuraiCatalogSource,
    certificate: Pick<DownloadOptions, 'cert' | 'key'>
): Promise<SamuraiStorefrontLanguages | null> {
    try {
        const defaultXml = await downloadSourceText(
            getSamuraiLanguagesUrl(source),
            certificate
        );
        const parsed = samuraiParser.parse(defaultXml) as SamuraiResponse;
        const languages = (parsed.eshop?.languages?.language ?? []).flatMap(
            (value) => (value.iso_code ? [value.iso_code.toLowerCase()] : [])
        );
        for (const language of languages) {
            const explicitXml = await downloadSourceText(
                getSamuraiLanguagesUrl(source, language),
                certificate
            );
            if (
                JSON.stringify(samuraiParser.parse(explicitXml)) ===
                JSON.stringify(parsed)
            ) {
                return { defaultLanguage: language, languages };
            }
        }
    } catch (error) {
        console.warn(
            `[samurai] ${source.platform} ${source.region} languages unavailable: ${String(error)}`
        );
    }
    return null;
}

async function loadSamuraiTitleDetails(
    catalogTitles: readonly SamuraiCatalogTitle[],
    titleId: string,
    certificate: Pick<DownloadOptions, 'cert' | 'key'>,
    languageBySource: ReadonlyMap<SamuraiCatalogSource, string>
): Promise<SamuraiTitleDetails> {
    let normalized: NusTitle | null = null;
    const details = await mapPool(
        catalogTitles,
        parallel,
        async (catalogTitle) => {
            const language = languageBySource.get(catalogTitle.source);
            if (!language) {
                return null;
            }
            try {
                const parsed = samuraiParser.parse(
                    await downloadSourceText(
                        getSamuraiTitleUrl(
                            catalogTitle.source,
                            catalogTitle.nsUid
                        ),
                        certificate
                    )
                ) as SamuraiResponse;
                const title = parsed.eshop?.title;
                return title ? { catalogTitle, language, title } : null;
            } catch (error) {
                if (!isHttpErrorStatus(error, 404)) {
                    console.warn(
                        `[samurai] ${catalogTitle.source.platform} ${catalogTitle.source.region} title ${catalogTitle.nsUid} unavailable: ${String(error)}`
                    );
                }
                return null;
            }
        }
    );

    for (const detail of details) {
        if (!detail) {
            continue;
        }
        const current = parseSamuraiTitleDetails(
            detail.title,
            detail.catalogTitle,
            titleId,
            detail.language
        );
        if (normalized) {
            mergeSamuraiTitleDetails(normalized, current);
        } else {
            normalized = current;
        }
    }
    return {
        title: normalized,
        lookups: details.flatMap((detail) =>
            detail
                ? [
                      {
                          language: detail.language,
                          platform: detail.catalogTitle.source.platform,
                          title: detail.title,
                      },
                  ]
                : []
        ),
    };
}

function parseTagayaLatestVersion(xml: string): string {
    const parsed = parser.parse(xml) as TagayaLatestVersionResponse;
    const version = parsed.version_list_info?.version?.trim() ?? '';

    if (!/^\d+$/.test(version)) {
        throw new Error(
            'Tagaya latest_version response did not contain version_list_info.version'
        );
    }

    return version;
}

function parseTagayaVersions(xml: string): Map<string, number> {
    const parsed = parser.parse(xml) as TagayaVersionListResponse;
    const versions = new Map<string, number>();

    for (const title of toArray(parsed.version_list?.titles?.title)) {
        const titleId = title.id?.trim().toLowerCase() ?? '';
        const versionText = title.version?.trim() ?? '';
        if (!/^[0-9a-f]{16}$/.test(titleId) || !/^\d+$/.test(versionText)) {
            continue;
        }

        versions.set(titleId, Number.parseInt(versionText, 10));
    }

    return versions;
}

function isRetryableSourceError(error: unknown): error is HttpError {
    if (!isErrorType(error, HttpError)) {
        return false;
    }

    return error.status === 429 || (error.status >= 500 && error.status <= 599);
}

function isRetryableNetworkError(error: unknown): boolean {
    return (
        isErrorType(error, TypeError) ||
        [
            'ECONNRESET',
            'ETIMEDOUT',
            'EAI_AGAIN',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'ECONNREFUSED',
            'EPIPE',
        ].some((code) => isNodeErrorCode(error, code))
    );
}

async function loadTagayaVersionHistory(): Promise<Map<string, number[]>> {
    const latestVersionText = parseTagayaLatestVersion(
        await downloadSourceText(tagayaLatestVersionUrl)
    );
    const latestVersion = Number.parseInt(latestVersionText, 10);
    const snapshotNumbers = Array.from(
        { length: latestVersion },
        (_, index) => index + 1
    );
    const history = new Map<string, Set<number>>();
    const unavailableSnapshots: number[] = [];
    const failedSnapshots: FailedVersionSnapshot[] = [];
    let completed = 0;

    console.log(
        `[tagaya] refreshing Wii U version history from 1 through ${latestVersion.toString()}`
    );

    await mapPool(snapshotNumbers, parallel, async (snapshotNumber) => {
        const url = tagayaVersionListUrl.replace(
            '%s',
            snapshotNumber.toString()
        );

        try {
            let xml: string;
            try {
                xml = await downloadSourceText(url);
            } catch (error) {
                if (isRetryableSourceError(error)) {
                    console.warn(
                        `[tagaya] snapshot ${snapshotNumber.toString()} returned ${error.status.toString()}; retrying once`
                    );
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    xml = await downloadSourceText(url);
                } else {
                    throw error;
                }
            }

            const versions = parseTagayaVersions(xml);

            for (const [titleId, version] of versions) {
                if (
                    !titleId.startsWith('00050000') &&
                    !titleId.startsWith('0005000c') &&
                    !titleId.startsWith('0005000e')
                ) {
                    continue;
                }

                let titleVersions = history.get(titleId);
                if (!titleVersions) {
                    titleVersions = new Set<number>();
                    history.set(titleId, titleVersions);
                }
                titleVersions.add(version);
            }
        } catch (error) {
            if (isHttpErrorStatus(error, [403, 404])) {
                unavailableSnapshots.push(snapshotNumber);
            } else if (isRetryableSourceError(error)) {
                failedSnapshots.push({
                    snapshot: snapshotNumber,
                    statusCode: error.status,
                });
                console.warn(
                    `[tagaya] snapshot ${snapshotNumber.toString()} still failed after one retry (${error.status.toString()}); skipping`
                );
            } else {
                throw error;
            }
        } finally {
            completed += 1;
            if (
                completed === 1 ||
                completed % 50 === 0 ||
                completed === latestVersion
            ) {
                console.log(
                    `[tagaya] history ${completed.toString()} / ${latestVersion.toString()} snapshots processed`
                );
            }
        }
    });

    unavailableSnapshots.sort((a, b) => a - b);
    failedSnapshots.sort((a, b) => a.snapshot - b.snapshot);
    if (failedSnapshots.length > 0) {
        throw new Error(
            `[tagaya] ${failedSnapshots.length.toString()} snapshots failed after retry; refusing to replace cached version history with incomplete data`
        );
    }

    const versions = new Map<string, number[]>();
    let versionCount = 0;
    for (const [titleId, titleVersions] of history) {
        const sorted = [...titleVersions].sort((a, b) => a - b);
        versions.set(titleId, sorted);
        versionCount += sorted.length;
    }

    const countPrefix = (prefix: string): number =>
        [...versions.keys()].filter((titleId) => titleId.startsWith(prefix))
            .length;
    const wiiUBaseCount = countPrefix('00050000');
    const wiiUUpdateCount = countPrefix('0005000e');
    const wiiUDlcCount = countPrefix('0005000c');

    console.log(
        `[tagaya] Wii U history loaded: ${versionCount.toString()} distinct versions; ` +
            `${wiiUBaseCount.toString()} base / ` +
            `${wiiUUpdateCount.toString()} update / ` +
            `${wiiUDlcCount.toString()} DLC` +
            (unavailableSnapshots.length > 0
                ? `; ${unavailableSnapshots.length.toString()} snapshots unavailable (403/404)`
                : '')
    );

    return versions;
}

function relatedTagayaUpdateTitleId(
    platform: TitleLookupPlatform,
    baseTitleId: string
): string | null {
    const normalized = baseTitleId.toLowerCase();

    switch (platform) {
        case '3ds':
            return /^00040000[0-9a-f]{8}$/.test(normalized)
                ? `0004000e${normalized.slice(8)}`
                : null;
        case 'wiiu':
            return /^00050000[0-9a-f]{8}$/.test(normalized)
                ? `0005000e${normalized.slice(8)}`
                : null;
    }
}

function relatedTagayaDlcTitleId(
    platform: TitleLookupPlatform,
    baseTitleId: string
): string | null {
    const normalized = baseTitleId.toLowerCase();

    switch (platform) {
        case '3ds':
            return /^00040000[0-9a-f]{8}$/.test(normalized)
                ? `0004008c${normalized.slice(8)}`
                : null;
        case 'wiiu':
            return /^00050000[0-9a-f]{8}$/.test(normalized)
                ? `0005000c${normalized.slice(8)}`
                : null;
    }
}

function supplementTagayaVersionHistory(
    platform: TitleLookupPlatform,
    title: RawTitleDatabaseEntry,
    tagayaVersions: ReadonlyMap<string, readonly number[]>
): RawTitleDatabaseEntry {
    if (!title.titleId) {
        return title;
    }

    const baseTitleId = title.titleId.toLowerCase();
    const updateTitleId = relatedTagayaUpdateTitleId(platform, baseTitleId);
    const dlcTitleId = relatedTagayaDlcTitleId(platform, baseTitleId);
    const baseVersions = tagayaVersions.get(baseTitleId);
    const updateVersions = updateTitleId
        ? tagayaVersions.get(updateTitleId)
        : undefined;
    const dlcVersions = dlcTitleId ? tagayaVersions.get(dlcTitleId) : undefined;

    return {
        ...title,
        baseVersions: mergeVersions(title.baseVersions, baseVersions ?? []),
        updateVersions: mergeVersions(
            title.updateVersions,
            updateVersions ?? []
        ),
        dlcVersions: mergeVersions(title.dlcVersions, dlcVersions ?? []),
    };
}

function parseThreeDSVersionList(data: Buffer): ThreeDSVersionListEntry[] {
    if (data.length < 0x10 || (data.length - 0x10) % 0x10 !== 0) {
        throw new Error(
            `Invalid 3DS versionList.dat size: ${data.length.toString()} bytes`
        );
    }

    const entries: ThreeDSVersionListEntry[] = [];
    for (let offset = 0x10; offset < data.length; offset += 0x10) {
        const titleId = data
            .readBigUInt64LE(offset)
            .toString(16)
            .padStart(16, '0')
            .toLowerCase();
        const version = data.readUInt32LE(offset + 0x8);

        entries.push({ titleId, version });
    }

    return entries;
}

async function loadThreeDSVersionList(): Promise<Map<string, number>> {
    console.log(`[tagaya-ctr] loading ${threeDSVersionListUrl}`);

    const data = await downloadSourceBytes(threeDSVersionListUrl);
    const entries = parseThreeDSVersionList(data);
    const versions = new Map<string, number>();

    for (const entry of entries) {
        versions.set(entry.titleId, entry.version);
    }

    const countPrefix = (prefix: string): number =>
        entries.filter((entry) => entry.titleId.startsWith(prefix)).length;
    console.log(
        `[tagaya-ctr] ${entries.length.toString()} entries loaded; ` +
            `${countPrefix('00040000').toString()} base / ` +
            `${countPrefix('0004000e').toString()} update`
    );

    return versions;
}

function supplementThreeDSVersionList(
    title: RawTitleDatabaseEntry,
    versions: ReadonlyMap<string, number>
): RawTitleDatabaseEntry {
    if (!title.titleId) {
        return title;
    }

    const baseTitleId = title.titleId.toLowerCase();
    if (!/^00040000[0-9a-f]{8}$/.test(baseTitleId)) {
        return title;
    }

    const updateTitleId = `0004000e${baseTitleId.slice(8)}`;
    const dlcTitleId = `0004008c${baseTitleId.slice(8)}`;

    return {
        ...title,
        baseVersions: addKnownVersion(
            title.baseVersions,
            versions.get(baseTitleId)
        ),
        updateVersions: addKnownVersion(
            title.updateVersions,
            versions.get(updateTitleId)
        ),
        dlcVersions: addKnownVersion(
            title.dlcVersions,
            versions.get(dlcTitleId)
        ),
    };
}

async function loadTagayaVersions(): Promise<Map<string, number>> {
    try {
        const latestVersion = parseTagayaLatestVersion(
            await downloadSourceText(tagayaLatestVersionUrl)
        );
        const url = tagayaVersionListUrl.replace('%s', latestVersion);
        console.log(`[tagaya] loading version list ${latestVersion}`);

        const versions = parseTagayaVersions(await downloadSourceText(url));
        if (versions.size === 0) {
            throw new Error('Tagaya version list contained no title versions');
        }

        const countPrefix = (prefix: string): number =>
            [...versions.keys()].filter((titleId) => titleId.startsWith(prefix))
                .length;
        console.log(
            `[tagaya] ${versions.size.toString()} versions loaded; wiiu ` +
                `${countPrefix('00050000').toString()} base / ` +
                `${countPrefix('0005000e').toString()} update / ` +
                `${countPrefix('0005000c').toString()} dlc`
        );

        return versions;
    } catch (error) {
        console.warn(
            `[tagaya] refresh failed; cached and /api/title versions will be preserved: ${String(error)}`
        );
        return new Map();
    }
}

function addKnownVersion(
    versions: number[],
    version: number | undefined
): number[] {
    return version === undefined
        ? versions
        : mergeVersions(versions, [version]);
}

function supplementTagayaLatestVersions(
    platform: TitleLookupPlatform,
    title: RawTitleDatabaseEntry,
    tagayaVersions: ReadonlyMap<string, number>
): RawTitleDatabaseEntry {
    if (!title.titleId) {
        return title;
    }

    const baseTitleId = title.titleId.toLowerCase();
    const updateTitleId = relatedTagayaUpdateTitleId(platform, baseTitleId);
    const dlcTitleId = relatedTagayaDlcTitleId(platform, baseTitleId);

    return {
        ...title,
        baseVersions: addKnownVersion(
            title.baseVersions,
            tagayaVersions.get(baseTitleId)
        ),
        updateVersions: addKnownVersion(
            title.updateVersions,
            updateTitleId ? tagayaVersions.get(updateTitleId) : undefined
        ),
        dlcVersions: addKnownVersion(
            title.dlcVersions,
            dlcTitleId ? tagayaVersions.get(dlcTitleId) : undefined
        ),
    };
}

function createSamuraiSupplementalTitle(
    platform: TitleLookupPlatform,
    title: SamuraiCatalogTitle,
    titleId: string
): NusTitleEntry | null {
    const identified =
        platform === '3ds'
            ? identifyThreeDSTitle(titleId)
            : identifyWiiUTitle(titleId);
    if (!identified) {
        return null;
    }

    let parentTitleId = identified.titleId;
    if (!PARENT_KINDS.includes(identified.kind as ParentKind)) {
        try {
            parentTitleId = replaceTitleKind(
                identified.titleId,
                TitleKinds.Base
            );
        } catch {
            return null;
        }
    }

    return {
        titleId: parentTitleId,
        name: title.name,
        region:
            normalizeRegion(null, title.productCode) ||
            title.source.majorRegion,
        productCode: title.productCode,
        companyCode: null,
        iconUrl: title.iconUrl,
        baseVersions: [],
        updateVersions: [],
        dlcVersions: [],
        availableOnCdn: false,
    };
}

async function loadSamuraiCatalogTitles(
    platform: TitleLookupPlatform,
    limit: number
): Promise<SamuraiCatalogResult> {
    const sources = samuraiNusSources.filter(
        (source) => source.platform === platform
    );
    const loaded = await mapPool(sources, parallel, async (source) => ({
        source,
        titles: await loadSamuraiCatalogSource(source),
    }));
    const titlesBySource = new Map(
        loaded.map(({ source, titles }) => [source, titles])
    );

    logSamuraiRegionCounts(platform, titlesBySource);

    const allSelected = [
        ...uniqueSamuraiTitlesByNsUid(
            choosePreferredSamuraiTitles(platform, titlesBySource)
        ).values(),
    ];
    const platformLimit =
        limit === 0
            ? null
            : platform === '3ds'
              ? Math.ceil(limit / 2)
              : Math.floor(limit / 2);
    const pairs = await loadNinjaIdPairs(
        allSelected.map((title) => title.nsUid)
    );
    const titleIdByNsUid = new Map(
        pairs.map((pair) => [pair.nsUid, pair.titleId])
    );
    const identifiedTitles = allSelected.map((title) => ({
        title,
        identified: identifyTitle(titleIdByNsUid.get(title.nsUid) ?? ''),
    }));
    const childNsUids = new Set(
        identifiedTitles.flatMap(({ title, identified }) =>
            identified && !PARENT_KINDS.includes(identified.kind as ParentKind)
                ? [title.nsUid]
                : []
        )
    );
    const parentTitles = identifiedTitles.flatMap(({ title, identified }) =>
        identified && PARENT_KINDS.includes(identified.kind as ParentKind)
            ? [title]
            : []
    );
    const selected =
        platformLimit === null
            ? parentTitles
            : parentTitles.slice(0, platformLimit);
    if (selected.length === 0) {
        throw new Error(
            `[samurai] ${platform} did not return any catalog titles`
        );
    }

    const selectedNsUids = new Set(selected.map((title) => title.nsUid));
    const relevantSources = loaded.filter(({ titles }) =>
        titles.some((title) => selectedNsUids.has(title.nsUid))
    );
    const certificate = await loadNinjaClientCertificate();
    const database = getNusDatabase(platform);
    const languageResults = await mapPool(
        relevantSources,
        parallel,
        async ({ source }) => ({
            source,
            info: await loadSamuraiStorefrontLanguages(source, certificate),
        })
    );
    const availableLanguages = languageResults.flatMap(({ source, info }) =>
        info ? [{ source, info }] : []
    );
    const languageBySource = new Map(
        availableLanguages.map(({ source, info }) => [
            source,
            info.defaultLanguage,
        ])
    );
    database.languages = {
        ...database.languages,
        ...Object.fromEntries(
            availableLanguages.map(({ source, info }) => [
                source.region,
                {
                    defaultLanguage: info.defaultLanguage,
                    languages: info.languages,
                },
            ])
        ),
    };

    const allCatalogTitles = loaded.flatMap(({ titles }) => titles);
    const allByNsUid = Map.groupBy(allCatalogTitles, (title) => title.nsUid);
    const resolvedResults = await mapPool(selected, parallel, async (title) => {
        const titleId = titleIdByNsUid.get(title.nsUid);
        if (!titleId) {
            return null;
        }
        const supplemental = createSamuraiSupplementalTitle(
            platform,
            title,
            titleId
        );
        if (!supplemental) {
            return null;
        }
        const details = await loadSamuraiTitleDetails(
            allByNsUid.get(title.nsUid) ?? [title],
            supplemental.titleId,
            certificate,
            languageBySource
        );
        supplemental.samurai = details.title ?? undefined;
        return { lookups: details.lookups, supplemental };
    });
    const resolved = resolvedResults.flatMap((result) => {
        if (!result) {
            return [];
        }
        for (const lookup of result.lookups) {
            addSamuraiLookups(
                database,
                lookup.title,
                lookup.language,
                lookup.platform
            );
        }
        return [result.supplemental];
    });

    console.log(
        `[samurai] ${platform}: ${resolved.length.toString()} titles resolved through Ninja from ${selected.length.toString()} NS UIDs`
    );

    const preferredByTitleId = new Map<string, RawTitleDatabaseEntry>();
    for (const title of resolved) {
        const titleId = title.titleId;
        if (!titleId) {
            continue;
        }
        const existing = preferredByTitleId.get(titleId);
        preferredByTitleId.set(
            titleId,
            existing ? mergeTitleEntries([title, existing])[0] : title
        );
    }

    return {
        titles: sortRawTitlesByIdentity([...preferredByTitleId.values()]),
        childNsUids,
    };
}

function mergeSupplementalTitleMaps(
    base: ReadonlyMap<string, RawTitleDatabaseEntry>,
    additions: readonly RawTitleDatabaseEntry[]
): Map<string, RawTitleDatabaseEntry> {
    const merged = new Map(base);

    for (const addition of additions) {
        const identity = getRawTitleIdentity(addition);
        const existing = merged.get(identity);
        merged.set(
            identity,
            existing ? mergeTitleEntries([existing, addition])[0] : addition
        );
    }

    return merged;
}

function parseTitleRange(range: string): ParsedTitleRange {
    const [startHex, endHex] = range.split(':');
    return {
        start: BigInt(`0x${startHex}`),
        end: BigInt(`0x${endHex}`),
    };
}

function getLookupPlatform(titleId: string): TitleLookupPlatform | null {
    const title = identifyTitle(titleId);
    if (!title) {
        return null;
    }

    switch (title.platform) {
        case '3ds':
        case 'wiiu':
            return title.platform;
    }

    return null;
}

function getActiveLookupPlatforms(): Set<TitleLookupPlatform> {
    return new Set(ranges.map((range) => range.platform));
}

function generateTitleIds(): GeneratedTitleId[] {
    const titleIds: GeneratedTitleId[] = [];

    for (const range of ranges) {
        const { start, end } = parseTitleRange(range.range);
        let current = start;

        while (current <= end) {
            const title = identifyTitle(current.toString(16).padStart(16, '0'));
            if (title?.platform === range.platform) {
                titleIds.push({
                    platform: range.platform,
                    titleId: title.titleId,
                });
            }

            current += 0x100n;
        }
    }

    return titleIds;
}

function formatTitleLogProgress(index: number, total: number): string {
    return `[${index + 1} / ${total}]`;
}

function logTitleResult(
    index: number,
    total: number,
    titleId: string,
    title?: RawTitleDatabaseEntry
): void {
    const fields = [
        formatTitleLogProgress(index, total),
        titleId,
        title?.productCode ? `- ${title.productCode}` : '',
        title?.region ? `[${title.region}]` : '',
        title?.name ?? '',
    ].filter((field) => field !== '');

    console.log(fields.join(' '));
}

function hasTitleLookupMetadata(
    metadata: TitleLookupResponse | null
): metadata is TitleLookupResponse {
    return metadata !== null && metadata.titleId !== undefined;
}

function getDefaultAvailableOnCdn(platform: TitleLookupPlatform): boolean {
    switch (platform) {
        case '3ds':
            return false;
        case 'wiiu':
            return true;
    }
}

function supplementNusMetadata(
    title: RawTitleDatabaseEntry,
    supplemental: RawTitleDatabaseEntry | undefined
): RawTitleDatabaseEntry {
    if (!supplemental) {
        return title;
    }

    const samurai = mergeNusTitleDetails(
        (title as NusTitleEntry).samurai,
        (supplemental as NusTitleEntry).samurai
    );
    const supplemented = {
        ...supplemental,
        ...title,
        ...(samurai ? { samurai } : {}),
        name: title.name || supplemental.name,
        region: title.region || supplemental.region,
        productCode: title.productCode ?? supplemental.productCode,
        companyCode: title.companyCode ?? supplemental.companyCode,
        iconUrl: title.iconUrl ?? supplemental.iconUrl,
    };

    if (title.titleId) {
        return { ...supplemented, titleId: title.titleId };
    }

    const productCode = supplemented.productCode;
    if (!productCode) {
        throw new Error(
            'Supplemented title has neither title ID nor product code'
        );
    }

    return { ...supplemented, productCode };
}

async function loadCandidateTitleMetadata(
    platform: TitleLookupPlatform,
    titleId: string,
    index: number,
    total: number,
    supplementalTitleById: Map<string, RawTitleDatabaseEntry>,
    includeLookupVersions: boolean,
    extractIcons: boolean
): Promise<RawTitleDatabaseEntry | null | undefined> {
    const { metadata, definitive } = await loadTitleLookupMetadata(
        platform,
        titleId,
        extractIcons
    );

    if (!hasTitleLookupMetadata(metadata)) {
        return definitive ? null : undefined;
    }

    const metadataTitle = createNusTitleFromMetadata(platform, metadata);
    const title = includeLookupVersions
        ? metadataTitle
        : {
              ...metadataTitle,
              baseVersions: [],
              updateVersions: [],
              dlcVersions: [],
          };
    const supplementalTitle =
        supplementalTitleById.get(getRawTitleIdentity(title)) ??
        supplementalTitleById.get(titleId);

    const supplementedTitle = supplementNusMetadata(title, supplementalTitle);

    logTitleResult(index, total, titleId, supplementedTitle);

    return supplementedTitle;
}

type TitleLookupMetadataResult = {
    metadata: TitleLookupResponse | null;
    definitive: boolean;
};

async function writeExtractedTitleIcon(
    platform: TitleLookupPlatform,
    titleId: string,
    icon: { data: Buffer; extension: 'png' | 'tga' } | null
): Promise<void> {
    if (!icon) {
        return;
    }

    const platformImagesDir = path.join(imagesDir, platform);
    await fs.mkdir(platformImagesDir, { recursive: true });
    await fs.writeFile(
        path.join(
            platformImagesDir,
            `${titleId.toLowerCase()}.${icon.extension}`
        ),
        icon.data
    );
}

async function loadTitleLookupMetadata(
    platform: TitleLookupPlatform,
    titleId: string,
    extractIcons: boolean
): Promise<TitleLookupMetadataResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const baseUrl =
                platform === '3ds' ? THREE_DS_NUS_BASE_URL : WII_U_NUS_BASE_URL;
            const downloadOptions: DownloadOptions =
                platform === '3ds'
                    ? {
                          ...(await loadThreeDSClientCertificateOptions()),
                          logDownload: false,
                      }
                    : { logDownload: false };
            const nusOptions = {
                baseUrl,
                downloadOptions,
                logMetadata: false,
                extractIcon: extractIcons,
            };
            const identified = identifyTitle(titleId);
            const baseTitleId =
                identified &&
                PARENT_KINDS.includes(identified.kind as ParentKind)
                    ? identified.titleId
                    : replaceTitleKind(titleId, TitleKinds.Base);
            const [metadata, updateMetadata, dlcMetadata] = await Promise.all([
                downloadNusTitleMetadata(baseTitleId, nusOptions),
                getUpdateMetadata(baseTitleId, nusOptions),
                getDlcMetadata(baseTitleId, nusOptions),
            ]);

            await writeExtractedTitleIcon(
                platform,
                baseTitleId,
                metadata?.icon ?? null
            );

            if (!metadata && !updateMetadata.exists && !dlcMetadata.exists) {
                return { metadata: null, definitive: true };
            }

            return {
                metadata: {
                    titleId: metadata?.titleId ?? baseTitleId,
                    name: metadata?.name ?? null,
                    region: metadata?.region ?? null,
                    productCode: metadata?.productCode ?? null,
                    companyCode: metadata?.companyCode ?? null,
                    baseVersions: metadata ? [metadata.titleVersion] : [],
                    updateVersions:
                        updateMetadata.exists &&
                        updateMetadata.titleVersion !== null
                            ? [updateMetadata.titleVersion]
                            : [],
                    dlcVersions:
                        dlcMetadata.exists && dlcMetadata.titleVersion !== null
                            ? [dlcMetadata.titleVersion]
                            : [],
                    iconUrl: null,
                    availableOnCdn: metadata !== null,
                },
                definitive: true,
            };
        } catch (error) {
            if (isHttpErrorStatus(error, [403, 404])) {
                return { metadata: null, definitive: true };
            }
            const retryable =
                isRetryableSourceError(error) || isRetryableNetworkError(error);
            if (!retryable) {
                throw error;
            }
            if (attempt === 3) {
                return { metadata: null, definitive: false };
            }

            console.warn(
                `[nus] transient failure for ${titleId}; ` +
                    `retrying (${attempt.toString()} / 2)`
            );
            await new Promise((resolve) =>
                setTimeout(resolve, 250 * 2 ** (attempt - 1))
            );
        }
    }

    throw new Error(`Unreachable lookup retry state for ${titleId}`);
}

async function refreshCachedTitleMetadata(
    platform: TitleLookupPlatform,
    title: RawTitleDatabaseEntry,
    supplementalTitleById: Map<string, RawTitleDatabaseEntry>,
    includeLookupVersions: boolean,
    extractIcons: boolean
): Promise<RawTitleDatabaseEntry> {
    if (!title.titleId) {
        return title;
    }

    const { metadata, definitive } = await loadTitleLookupMetadata(
        platform,
        title.titleId,
        extractIcons
    );
    if (!definitive) {
        return title;
    }
    if (!metadata) {
        return { ...title, availableOnCdn: false };
    }

    const refreshed = createNusTitleFromMetadata(platform, metadata);
    const preserved = {
        ...supplementNusMetadata(refreshed, title),
        baseVersions: includeLookupVersions
            ? mergeVersions(title.baseVersions, refreshed.baseVersions)
            : title.baseVersions,
        updateVersions: includeLookupVersions
            ? mergeVersions(title.updateVersions, refreshed.updateVersions)
            : title.updateVersions,
        dlcVersions: includeLookupVersions
            ? mergeVersions(title.dlcVersions, refreshed.dlcVersions)
            : title.dlcVersions,
        availableOnCdn: refreshed.availableOnCdn,
    };
    const supplementalTitle =
        supplementalTitleById.get(getRawTitleIdentity(preserved)) ??
        supplementalTitleById.get(title.titleId);
    return supplementNusMetadata(preserved, supplementalTitle);
}

function createNusTitleFromMetadata(
    platform: TitleLookupPlatform,
    metadata: TitleLookupResponse
): RawTitleDatabaseEntry {
    const productCode = metadata.productCode ?? null;
    const name = metadata.name ? normalizeTitleName(metadata.name) : '';

    return {
        titleId: metadata.titleId,
        name,
        region:
            normalizeRegion(null, productCode) ||
            normalizeRegion(metadata.region ?? null, null),
        productCode,
        companyCode: metadata.companyCode ?? null,
        iconUrl: metadata.iconUrl ?? null,
        baseVersions: metadata.baseVersions,
        updateVersions: metadata.updateVersions,
        dlcVersions: metadata.dlcVersions,
        availableOnCdn:
            metadata.availableOnCdn ?? getDefaultAvailableOnCdn(platform),
    };
}

function toLegacyTitleEntry(
    title: RawTitleDatabaseEntry
): RawTitleDatabaseEntry {
    if (!title.titleId) {
        return title;
    }
    return {
        titleId: title.titleId,
        name: title.name,
        region: title.region,
        productCode: title.productCode,
        companyCode: title.companyCode,
        iconUrl: title.iconUrl,
        baseVersions: title.baseVersions,
        updateVersions: title.updateVersions,
        dlcVersions: title.dlcVersions,
        availableOnCdn: title.availableOnCdn,
    };
}

async function loadTitles(
    options: GenerateOptions
): Promise<GeneratedTitleDatabase> {
    const discTitles = await loadDiscTitles();
    const supplementalTitles: GeneratedTitleDatabase = {
        '3ds': mergeTitleEntries(await loadThreeDSTitles()),
        gamecube: mergeTitleEntries(discTitles.gamecube),
        wiiu: mergeTitleEntries(await loadWiiUTitles()),
        wii: mergeTitleEntries(discTitles.wii),
    };
    const supplementalTitleById = new Map(
        Object.values(supplementalTitles)
            .flat()
            .map((title) => [getRawTitleIdentity(title), title])
    );

    const nusTitles = await loadNusTitles(options, supplementalTitleById);

    const nusTitlesByPlatform: GeneratedTitleDatabase = {
        '3ds': [],
        gamecube: [],
        wiiu: [],
        wii: [],
    };

    for (const title of mergeTitleEntries(nusTitles)) {
        const platform = getLookupPlatform(getRawTitleIdentity(title));
        if (platform) {
            nusTitlesByPlatform[platform].push(toLegacyTitleEntry(title));
        }
    }

    const merged = (
        platform: keyof GeneratedTitleDatabase
    ): RawTitleDatabaseEntry[] =>
        sortRawTitlesByIdentity(
            mergeCanonicalNusEntries(
                supplementalTitles[platform],
                nusTitlesByPlatform[platform]
            )
        );

    return {
        '3ds': merged('3ds'),
        gamecube: merged('gamecube'),
        wiiu: merged('wiiu'),
        wii: merged('wii'),
    };
}

async function loadWiiUTitles(): Promise<RawTitleDatabaseEntry[]> {
    return [...(await loadWiiUBrewTitles())];
}

async function loadThreeDSTitles(): Promise<RawTitleDatabaseEntry[]> {
    return [...(await loadThreeDSHShopTitles())];
}

async function loadNusTitles(
    options: GenerateOptions,
    supplementalTitleById: Map<string, RawTitleDatabaseEntry>
): Promise<RawTitleDatabaseEntry[]> {
    const activePlatforms = getActiveLookupPlatforms();
    const cacheFiles = getActiveNusCacheFiles(activePlatforms);
    const titles: RawTitleDatabaseEntry[] = [];

    let wiiUTagayaVersionHistory = null;
    if (options.refreshVersions && activePlatforms.has('wiiu')) {
        wiiUTagayaVersionHistory = await loadTagayaVersionHistory();
    }

    let wiiUTagayaLatestVersions = null;
    if (
        activePlatforms.has('wiiu') &&
        options.refreshCatalog &&
        options.refreshMetadata &&
        !wiiUTagayaVersionHistory
    ) {
        wiiUTagayaLatestVersions = await loadTagayaVersions();
    }

    let threeDSCurrentVersions = null;
    if (
        options.refreshCatalog &&
        options.refreshMetadata &&
        activePlatforms.has('3ds')
    ) {
        threeDSCurrentVersions = await loadThreeDSVersionList();
    }

    for (const [platform, file] of cacheFiles) {
        if (!options.refreshCatalog) {
            if (await fileExists(file)) {
                let cachedTitles = await readNusCache(platform, file);
                const beforeBaseVersions = cachedTitles.reduce(
                    (sum, title) => sum + title.baseVersions.length,
                    0
                );
                const beforeUpdateVersions = cachedTitles.reduce(
                    (sum, title) => sum + title.updateVersions.length,
                    0
                );
                const beforeDlcVersions = cachedTitles.reduce(
                    (sum, title) => sum + title.dlcVersions.length,
                    0
                );

                if (platform === 'wiiu' && wiiUTagayaVersionHistory) {
                    cachedTitles = cachedTitles.map((title) =>
                        supplementTagayaVersionHistory(
                            'wiiu',
                            title,
                            wiiUTagayaVersionHistory
                        )
                    );
                    await writeNusCache(platform, file, cachedTitles);
                }

                if (options.refreshVersions) {
                    cachedTitles = await refreshVersionHistories(
                        platform,
                        cachedTitles,
                        async (checkpoint) => {
                            await writeNusCache(platform, file, checkpoint);
                        }
                    );
                    const afterBaseVersions = cachedTitles.reduce(
                        (sum, title) => sum + title.baseVersions.length,
                        0
                    );
                    const afterUpdateVersions = cachedTitles.reduce(
                        (sum, title) => sum + title.updateVersions.length,
                        0
                    );
                    const afterDlcVersions = cachedTitles.reduce(
                        (sum, title) => sum + title.dlcVersions.length,
                        0
                    );

                    await writeNusCache(platform, file, cachedTitles);
                    console.log(
                        `[nus] ${platform} versions saved: ` +
                            `+${(afterBaseVersions - beforeBaseVersions).toString()} base, ` +
                            `+${(afterUpdateVersions - beforeUpdateVersions).toString()} update, ` +
                            `+${(afterDlcVersions - beforeDlcVersions).toString()} DLC`
                    );
                }

                if (options.refreshMetadata) {
                    cachedTitles = await refreshCachedMetadata(
                        platform,
                        cachedTitles,
                        supplementalTitleById,
                        !options.refreshVersions,
                        options.extractIcons,
                        async (checkpoint) => {
                            await writeNusCache(platform, file, checkpoint);
                        }
                    );
                    await writeNusCache(platform, file, cachedTitles);
                }

                titles.push(...cachedTitles);
            } else {
                console.log(
                    `[nus] ${platform} cache missing; skipping ` +
                        `(use --refresh-catalog to build it)`
                );
            }

            continue;
        }

        const cachedTitles = (await fileExists(file))
            ? await readNusCache(platform, file)
            : [];

        console.log(
            options.refreshMetadata
                ? `[nus] ${platform} refresh: rechecking ` +
                      `${cachedTitles.length.toString()} cached titles, then probing uncached catalog and version-source candidates`
                : `[nus] ${platform} catalog refresh: preserving ` +
                      `${cachedTitles.length.toString()} cached titles without TMD rechecks`
        );
        let platformTitles = await refreshPlatformCatalog(
            platform,
            options.limit,
            supplementalTitleById,
            cachedTitles,
            options.scanGeneratedRanges,
            options.refreshMetadata,
            options.extractIcons,
            !options.refreshVersions,
            platform === 'wiiu'
                ? new Set(
                      (
                          wiiUTagayaVersionHistory ??
                          wiiUTagayaLatestVersions ??
                          new Map()
                      ).keys()
                  )
                : new Set(threeDSCurrentVersions?.keys() ?? []),
            async (checkpoint) => {
                await writeNusCache(platform, file, checkpoint);
            }
        );

        if (platform === 'wiiu') {
            if (wiiUTagayaVersionHistory) {
                platformTitles = platformTitles.map((title) =>
                    supplementTagayaVersionHistory(
                        'wiiu',
                        title,
                        wiiUTagayaVersionHistory
                    )
                );
                await writeNusCache(platform, file, platformTitles);
            } else if (wiiUTagayaLatestVersions) {
                platformTitles = platformTitles.map((title) =>
                    supplementTagayaLatestVersions(
                        'wiiu',
                        title,
                        wiiUTagayaLatestVersions
                    )
                );
            }
        }

        if (
            platform === '3ds' &&
            threeDSCurrentVersions &&
            !options.refreshVersions
        ) {
            platformTitles = platformTitles.map((title) =>
                supplementThreeDSVersionList(title, threeDSCurrentVersions)
            );
        }

        if (options.refreshVersions) {
            platformTitles = await refreshVersionHistories(
                platform,
                platformTitles,
                async (checkpoint) => {
                    await writeNusCache(platform, file, checkpoint);
                }
            );
        }

        await writeNusCache(platform, file, platformTitles);
        console.log(`[nus] ${platform} cache saved:`, platformTitles.length);

        titles.push(...platformTitles);
    }

    return titles;
}

async function refreshCachedMetadata(
    platform: TitleLookupPlatform,
    cachedTitles: RawTitleDatabaseEntry[],
    supplementalTitleById: Map<string, RawTitleDatabaseEntry>,
    includeLookupVersions: boolean,
    extractIcons: boolean,
    checkpoint: (titles: RawTitleDatabaseEntry[]) => Promise<void>
): Promise<RawTitleDatabaseEntry[]> {
    const refreshedTitles = [...cachedTitles];
    let completed = 0;
    let checkpointQueue = Promise.resolve();

    await mapPool(cachedTitles, parallel, async (title, index) => {
        refreshedTitles[index] = await refreshCachedTitleMetadata(
            platform,
            title,
            supplementalTitleById,
            includeLookupVersions,
            extractIcons
        );
        completed += 1;
        if (
            completed === 1 ||
            completed % 50 === 0 ||
            completed === cachedTitles.length
        ) {
            console.log(
                `[metadata] ${platform} cached title recheck: ` +
                    `${completed.toString()} / ${cachedTitles.length.toString()}`
            );
            const snapshot = sortRawTitlesByIdentity(
                mergeTitleEntries(refreshedTitles)
            );
            checkpointQueue = checkpointQueue.then(async () => {
                await checkpoint(snapshot);
            });
        }
    });
    await checkpointQueue;

    return sortRawTitlesByIdentity(mergeTitleEntries(refreshedTitles));
}

async function refreshPlatformCatalog(
    platform: TitleLookupPlatform,
    limit: number,
    supplementalTitleById: Map<string, RawTitleDatabaseEntry>,
    cachedTitles: RawTitleDatabaseEntry[],
    scanGeneratedRanges: boolean,
    refreshMetadata: boolean,
    extractIcons: boolean,
    includeLookupVersions: boolean,
    versionSourceTitleIds: ReadonlySet<string>,
    checkpoint: (titles: RawTitleDatabaseEntry[]) => Promise<void>
): Promise<RawTitleDatabaseEntry[]> {
    const samuraiCatalog = await loadSamuraiCatalogTitles(platform, limit);
    const samuraiTitles = samuraiCatalog.titles;
    cachedTitles = cachedTitles.map((title) => {
        const nsUid = (title as NusTitleEntry).samurai?.nsUid;
        return nsUid && samuraiCatalog.childNsUids.has(nsUid)
            ? toLegacyTitleEntry(title)
            : title;
    });
    const mergedSupplementalTitleById = mergeSupplementalTitleMaps(
        supplementalTitleById,
        samuraiTitles
    );
    const limitedTitleIds = new Set(
        samuraiTitles.flatMap((title) =>
            title.titleId ? [title.titleId.toLowerCase()] : []
        )
    );
    const cachedTitlesToRefresh = !refreshMetadata
        ? []
        : limit === 0
          ? cachedTitles
          : cachedTitles.filter((title) =>
                title.titleId
                    ? limitedTitleIds.has(title.titleId.toLowerCase())
                    : false
            );
    const preservedCachedTitles = !refreshMetadata
        ? cachedTitles
        : limit === 0
          ? []
          : cachedTitles.filter((title) =>
                title.titleId
                    ? !limitedTitleIds.has(title.titleId.toLowerCase())
                    : true
            );
    const refreshedCachedTitles = [...cachedTitlesToRefresh];
    let completedCachedLookups = 0;
    let cachedCheckpointQueue = Promise.resolve();
    await mapPool(cachedTitlesToRefresh, parallel, async (title, index) => {
        refreshedCachedTitles[index] = await refreshCachedTitleMetadata(
            platform,
            title,
            mergedSupplementalTitleById,
            includeLookupVersions,
            extractIcons
        );
        completedCachedLookups += 1;
        if (
            completedCachedLookups === 1 ||
            completedCachedLookups % 50 === 0 ||
            completedCachedLookups === cachedTitlesToRefresh.length
        ) {
            console.log(
                `[nus] ${platform} cached title recheck: ` +
                    `${completedCachedLookups.toString()} / ${cachedTitlesToRefresh.length.toString()}`
            );
            const snapshot = sortRawTitlesByIdentity(
                mergeTitleEntries([
                    ...preservedCachedTitles,
                    ...refreshedCachedTitles,
                ])
            );
            cachedCheckpointQueue = cachedCheckpointQueue.then(async () => {
                await checkpoint(snapshot);
            });
        }
    });
    await cachedCheckpointQueue;

    const cachedByTitleId = new Map(
        [...preservedCachedTitles, ...refreshedCachedTitles].flatMap((title) =>
            title.titleId ? [[title.titleId.toLowerCase(), title] as const] : []
        )
    );
    const samuraiByTitleId = new Map(
        samuraiTitles.flatMap((title) =>
            title.titleId ? [[title.titleId.toLowerCase(), title] as const] : []
        )
    );
    const supplementalCatalogCandidates =
        limit === 0
            ? uniqueGeneratedTitleIds(
                  [...supplementalTitleById.values()].flatMap((title) => {
                      if (!title.titleId) {
                          return [];
                      }

                      const titleId = title.titleId.toLowerCase();
                      return getLookupPlatform(titleId) === platform &&
                          !cachedByTitleId.has(titleId) &&
                          !samuraiByTitleId.has(titleId)
                          ? [{ platform, titleId }]
                          : [];
                  })
              )
            : [];
    const versionSourceBaseTitleIds = new Set(
        [...versionSourceTitleIds].flatMap((titleId) => {
            const normalized = titleId.toLowerCase();
            const pattern =
                platform === '3ds'
                    ? /^000400(?:00|0e|8c)[0-9a-f]{8}$/
                    : /^000500(?:00|0c|0e)[0-9a-f]{8}$/;
            if (!pattern.test(normalized)) {
                return [];
            }
            const basePrefix = platform === '3ds' ? '00040000' : '00050000';
            return [`${basePrefix}${normalized.slice(8)}`];
        })
    );
    const versionSourceCandidates =
        limit === 0
            ? uniqueGeneratedTitleIds(
                  [...versionSourceBaseTitleIds]
                      .filter(
                          (titleId) =>
                              !cachedByTitleId.has(titleId) &&
                              !samuraiByTitleId.has(titleId)
                      )
                      .map((titleId) => ({ platform, titleId }))
              )
            : [];
    const generatedRangeCandidates =
        scanGeneratedRanges && limit === 0
            ? uniqueGeneratedTitleIds(
                  generateTitleIds().filter(
                      (title) =>
                          title.platform === platform &&
                          !cachedByTitleId.has(title.titleId.toLowerCase()) &&
                          !samuraiByTitleId.has(title.titleId.toLowerCase())
                  )
              )
            : [];

    const matchedSamuraiTitles: RawTitleDatabaseEntry[] = [];
    const newSamuraiTitles: RawTitleDatabaseEntry[] = [];

    for (const samuraiTitle of samuraiTitles) {
        const titleId = samuraiTitle.titleId?.toLowerCase();
        const cachedTitle = titleId ? cachedByTitleId.get(titleId) : undefined;
        if (!cachedTitle) {
            newSamuraiTitles.push(samuraiTitle);
            continue;
        }

        matchedSamuraiTitles.push(
            supplementNusMetadata(cachedTitle, samuraiTitle)
        );
    }

    const cachedOnlyTitles = [
        ...preservedCachedTitles,
        ...refreshedCachedTitles,
    ].filter((title) => {
        const titleId = title.titleId?.toLowerCase();
        return !titleId || !samuraiByTitleId.has(titleId);
    });

    console.log(
        `[nus] ${platform} catalog comparison: ` +
            `${samuraiTitles.length.toString()} Samurai, ` +
            `${cachedTitles.length.toString()} cached, ` +
            `${matchedSamuraiTitles.length.toString()} matched, ` +
            `${newSamuraiTitles.length.toString()} new, ` +
            `${cachedOnlyTitles.length.toString()} cache-only`
    );

    const lookupCandidates = uniqueGeneratedTitleIds([
        ...newSamuraiTitles.flatMap((title) =>
            title.titleId ? [{ platform, titleId: title.titleId }] : []
        ),
        ...supplementalCatalogCandidates,
        ...versionSourceCandidates,
        ...generatedRangeCandidates,
    ]);
    const catalogBackedTitleIds = new Set([
        ...newSamuraiTitles.flatMap((title) =>
            title.titleId ? [title.titleId.toLowerCase()] : []
        ),
        ...supplementalCatalogCandidates.map(({ titleId }) =>
            titleId.toLowerCase()
        ),
        ...versionSourceBaseTitleIds,
    ]);

    console.log(
        `[nus] ${platform} title candidates: ` +
            `${newSamuraiTitles.length.toString()} new Samurai, ` +
            `${supplementalCatalogCandidates.length.toString()} supplemental catalog, ` +
            `${versionSourceCandidates.length.toString()} version-source, ` +
            `${generatedRangeCandidates.length.toString()} generated-range`
    );

    await checkpoint(
        sortRawTitlesByIdentity(
            mergeTitleEntries([...cachedOnlyTitles, ...matchedSamuraiTitles])
        )
    );
    const lookupResults: (RawTitleDatabaseEntry | null | undefined)[] =
        Array.from({ length: lookupCandidates.length }, () => null);
    let completedLookups = 0;
    let checkpointQueue = Promise.resolve();
    await mapPool(lookupCandidates, parallel, async (candidate, index) => {
        const lookedUp = refreshMetadata
            ? await loadCandidateTitleMetadata(
                  candidate.platform,
                  candidate.titleId,
                  index,
                  lookupCandidates.length,
                  mergedSupplementalTitleById,
                  includeLookupVersions,
                  extractIcons
              )
            : null;
        let result = lookedUp;
        if (
            result === null &&
            catalogBackedTitleIds.has(candidate.titleId.toLowerCase())
        ) {
            const supplemental = mergedSupplementalTitleById.get(
                candidate.titleId.toLowerCase()
            );
            const sparse: RawTitleDatabaseEntry = {
                titleId: candidate.titleId,
                name: '',
                region: '',
                productCode: null,
                companyCode: null,
                iconUrl: null,
                baseVersions: [],
                updateVersions: [],
                dlcVersions: [],
                availableOnCdn: false,
            };
            result = supplementNusMetadata(sparse, supplemental);
        }

        lookupResults[index] = result;
        completedLookups += 1;
        if (
            completedLookups === 1 ||
            completedLookups % 50 === 0 ||
            completedLookups === lookupCandidates.length
        ) {
            const snapshot = sortRawTitlesByIdentity(
                mergeTitleEntries([
                    ...cachedOnlyTitles,
                    ...matchedSamuraiTitles,
                    ...lookupResults.filter(
                        (title): title is RawTitleDatabaseEntry => title != null
                    ),
                ])
            );
            checkpointQueue = checkpointQueue.then(async () => {
                await checkpoint(snapshot);
            });
        }
    });
    await checkpointQueue;
    const lookedUpNewTitles = lookupResults.filter(
        (title): title is RawTitleDatabaseEntry => title != null
    );
    const cdnBackedNewTitles = lookedUpNewTitles.filter(
        (title) => title.availableOnCdn === true
    ).length;

    const titles = [
        ...cachedOnlyTitles,
        ...matchedSamuraiTitles,
        ...lookedUpNewTitles,
    ];

    console.log(
        `[nus] ${platform} refresh complete: ${titles.length.toString()} NUS records; ` +
            `${(refreshMetadata ? lookupCandidates.length : 0).toString()} metadata lookups attempted, ` +
            `${lookedUpNewTitles.length.toString()} records retained ` +
            `(${cdnBackedNewTitles.toString()} CDN-backed, ` +
            `${(lookedUpNewTitles.length - cdnBackedNewTitles).toString()} catalog-only)`
    );

    return sortRawTitlesByIdentity(mergeTitleEntries(titles));
}

function getActiveNusCacheFiles(
    activePlatforms: Set<TitleLookupPlatform>
): Map<TitleLookupPlatform, string> {
    const files = new Map<TitleLookupPlatform, string>();

    if (activePlatforms.has('wiiu')) {
        files.set('wiiu', wiiUNusFile);
    }
    if (activePlatforms.has('3ds')) {
        files.set('3ds', threeDSNusFile);
    }

    return files;
}

async function readNusCache(
    platform: TitleLookupPlatform,
    file: string
): Promise<RawTitleDatabaseEntry[]> {
    const cached = await readOptionalJson(file);
    const normalizedDatabase = parseNusDatabase(cached);
    if (normalizedDatabase) {
        nusDatabases.set(platform, normalizedDatabase);
    }
    const values = normalizedDatabase?.titles ?? toArray(cached);
    const titles = values
        .map((value) =>
            normalizedDatabase && isNusTitle(value)
                ? nusTitleToRawEntry(value)
                : value
        )
        .filter(isRawTitleDatabaseEntry)
        .map((title) => {
            const identified = identifyTitle(title.titleId ?? '');
            return identified
                ? { ...title, titleId: identified.titleId }
                : title;
        })
        .filter(
            (title) =>
                getLookupPlatform(getRawTitleIdentity(title)) === platform
        );

    console.log(`[nus] ${platform} cached titles: ${titles.length.toString()}`);

    return titles;
}

function isNusTitle(value: unknown): value is NusTitle {
    return (
        isObject(value) &&
        typeof value.titleId === 'string' &&
        isObject(value.localizations) &&
        Array.isArray(value.baseVersions) &&
        Array.isArray(value.updateVersions) &&
        Array.isArray(value.dlcVersions)
    );
}

function migrateLegacyNusKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(migrateLegacyNusKeys);
    }
    if (!isObject(value)) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
            legacyNusKeyNames[key] ?? key,
            migrateLegacyNusKeys(child),
        ])
    );
}

function parseNusDatabase(value: unknown): NusDatabase | null {
    const migrated = migrateLegacyNusKeys(value);
    if (!isObject(migrated) || !Array.isArray(migrated.titles)) {
        return null;
    }
    return {
        languages: isObject(migrated.languages)
            ? (migrated.languages as NusDatabase['languages'])
            : {},
        platforms: isObject(migrated.platforms)
            ? (migrated.platforms as NusDatabase['platforms'])
            : {},
        publishers: isObject(migrated.publishers)
            ? (migrated.publishers as NusDatabase['publishers'])
            : {},
        genres: isObject(migrated.genres)
            ? (migrated.genres as NusDatabase['genres'])
            : {},
        ratingSystems: isObject(migrated.ratingSystems)
            ? (migrated.ratingSystems as NusDatabase['ratingSystems'])
            : {},
        ratings: isObject(migrated.ratings)
            ? (migrated.ratings as NusDatabase['ratings'])
            : {},
        languageNames: isObject(migrated.languageNames)
            ? (migrated.languageNames as NusDatabase['languageNames'])
            : {},
        features: isObject(migrated.features)
            ? (migrated.features as NusDatabase['features'])
            : {},
        controllers: isObject(migrated.controllers)
            ? (migrated.controllers as NusDatabase['controllers'])
            : {},
        titles: migrated.titles.filter(isNusTitle),
    };
}

function getNusTitleName(title: NusTitle): string {
    const english = title.localizations.en;
    const localization = english ?? Object.values(title.localizations)[0];
    return localization?.name ?? '';
}

function getFallbackTitleNameLanguage(title: RawTitleDatabaseEntry): string {
    if (getLookupPlatform(title.titleId ?? '') === 'wiiu') {
        return 'en';
    }

    switch (title.region) {
        case 'JPN':
            return 'ja';
        case 'KOR':
            return 'ko';
        case 'CHN':
        case 'TWN':
            return 'zh';
        default:
            return 'en';
    }
}

function migrateSyntheticEnglishName(
    title: NusTitle,
    scalarName: string
): void {
    const english = title.localizations.en;
    if (english?.name !== scalarName || Object.keys(english).length !== 1) {
        return;
    }

    const localized = Object.entries(title.localizations).find(
        ([language, localization]) =>
            language !== 'en' &&
            !localization.name &&
            localization.formalName === scalarName
    );
    if (!localized) {
        return;
    }

    const [, localization] = localized;
    localization.name = scalarName;
    delete title.localizations.en;
}

function orderNusTitleFields(title: NusTitle): NusTitle {
    return {
        titleId: title.titleId,
        nsUid: title.nsUid,
        productCode: title.productCode,
        platformId: title.platformId,
        region: title.region,
        publisherId: title.publisherId,
        companyCode: title.companyCode,
        localizations: title.localizations,
        baseVersions: title.baseVersions,
        updateVersions: title.updateVersions,
        dlcVersions: title.dlcVersions,
        availableOnCdn: title.availableOnCdn,
        images:
            title.images && Object.keys(title.images).length > 0
                ? title.images
                : null,
        features: title.features,
        controllers: title.controllers,
        playStyles: title.playStyles,
        genres: title.genres,
        languageCodes: title.languageCodes,
        releaseDates: title.releaseDates,
        ratings:
            title.ratings && Object.keys(title.ratings).length > 0
                ? title.ratings
                : null,
        sales: title.sales,
    };
}

function nusTitleToRawEntry(title: NusTitle): NusTitleEntry {
    const entry: NusTitleEntry = {
        titleId: title.titleId,
        name: getNusTitleName(title),
        region: title.region ?? '',
        productCode: title.productCode,
        companyCode: title.companyCode ?? null,
        iconUrl: title.images?.iconUrl ?? null,
        baseVersions: title.baseVersions,
        updateVersions: title.updateVersions,
        dlcVersions: title.dlcVersions,
        availableOnCdn: title.availableOnCdn,
    };
    return title.nsUid ? { ...entry, samurai: title } : entry;
}

function rawEntryToNusTitle(title: RawTitleDatabaseEntry): NusTitle {
    const enriched = (title as NusTitleEntry).samurai;
    const normalized: NusTitle = enriched
        ? structuredClone(enriched)
        : {
              titleId: title.titleId ?? '',
              productCode: title.productCode ?? null,
              platformId: null,
              region: title.region || undefined,
              publisherId: null,
              companyCode: title.companyCode,
              localizations: {},
              images: null,
              features: [],
              controllers: [],
              playStyles: [],
              genres: [],
              languageCodes: [],
              releaseDates: { eshop: null, original: null, retail: null },
              ratings: null,
              sales: {
                  retail: false,
                  eshop: false,
                  web: false,
                  downloadCode: false,
                  downloadCard: false,
                  iap: false,
              },
              baseVersions: [],
              updateVersions: [],
              dlcVersions: [],
              availableOnCdn: false,
          };
    normalized.titleId = title.titleId ?? normalized.titleId;
    normalized.productCode = title.productCode ?? null;
    normalized.region = title.region || undefined;
    normalized.companyCode = title.companyCode;
    if (title.name && enriched) {
        migrateSyntheticEnglishName(normalized, title.name);
    } else if (title.name) {
        const language = getFallbackTitleNameLanguage(title);
        const localization = normalized.localizations[language] ?? {};
        localization.name = title.name;
        normalized.localizations[language] = localization;
    }
    if (title.iconUrl) {
        normalized.images = {
            ...normalized.images,
            iconUrl: title.iconUrl,
        };
    }
    normalized.baseVersions = title.baseVersions;
    normalized.updateVersions = title.updateVersions;
    normalized.dlcVersions = title.dlcVersions;
    normalized.availableOnCdn = title.availableOnCdn === true;
    return orderNusTitleFields(normalized);
}

async function writeNusCache(
    platform: TitleLookupPlatform,
    file: string,
    titles: RawTitleDatabaseEntry[]
): Promise<void> {
    const database = structuredClone(getNusDatabase(platform));
    database.titles = sortRawTitlesByIdentity(titles).map(rawEntryToNusTitle);
    finalizeNusDatabase(database);
    await writeJson(file, database);
}

function isRawTitleDatabaseEntry(
    value: unknown
): value is RawTitleDatabaseEntry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const entry = value as Record<string, unknown>;

    return (
        typeof entry.titleId === 'string' &&
        typeof entry.name === 'string' &&
        Array.isArray(entry.baseVersions) &&
        Array.isArray(entry.updateVersions) &&
        Array.isArray(entry.dlcVersions)
    );
}

function uniqueGeneratedTitleIds(
    titleIds: GeneratedTitleId[]
): GeneratedTitleId[] {
    const byTitleId = new Map<string, GeneratedTitleId>();

    for (const title of titleIds) {
        if (title.titleId !== '' && !byTitleId.has(title.titleId)) {
            byTitleId.set(title.titleId, title);
        }
    }

    return [...byTitleId.values()];
}

function mergeTitleEntries(
    titles: RawTitleDatabaseEntry[]
): RawTitleDatabaseEntry[] {
    const byTitleId = new Map<string, RawTitleDatabaseEntry>();

    for (const title of titles) {
        const titleIdentity = getRawTitleIdentity(title);
        const existing = byTitleId.get(titleIdentity);
        if (!existing) {
            byTitleId.set(titleIdentity, title);
            continue;
        }

        const samurai = mergeNusTitleDetails(
            (existing as NusTitleEntry).samurai,
            (title as NusTitleEntry).samurai
        );
        const merged = {
            ...existing,
            ...title,
            ...(samurai ? { samurai } : {}),
            name: title.name !== '' ? title.name : existing.name,
            region: title.region || existing.region,
            productCode: title.productCode ?? existing.productCode,
            companyCode: title.companyCode ?? existing.companyCode,
            iconUrl: title.iconUrl ?? existing.iconUrl,
            baseVersions: mergeVersions(
                existing.baseVersions,
                title.baseVersions
            ),
            updateVersions: mergeVersions(
                existing.updateVersions,
                title.updateVersions
            ),
            dlcVersions: mergeVersions(existing.dlcVersions, title.dlcVersions),
            availableOnCdn: existing.availableOnCdn || title.availableOnCdn,
        };
        byTitleId.set(
            titleIdentity,
            merged.titleId
                ? { ...merged, titleId: merged.titleId }
                : {
                      ...merged,
                      titleId: undefined,
                      productCode: merged.productCode ?? titleIdentity,
                  }
        );
    }

    return [...byTitleId.values()];
}

function mergeCanonicalNusEntries(
    supplementalTitles: RawTitleDatabaseEntry[],
    nusTitles: RawTitleDatabaseEntry[]
): RawTitleDatabaseEntry[] {
    const byIdentity = new Map(
        mergeTitleEntries(supplementalTitles).map((title) => [
            getRawTitleIdentity(title),
            title,
        ])
    );

    for (const nusTitle of nusTitles) {
        const identity = getRawTitleIdentity(nusTitle);
        const supplementalTitle = byIdentity.get(identity);
        const merged = supplementalTitle
            ? mergeTitleEntries([supplementalTitle, nusTitle])[0]
            : nusTitle;
        byIdentity.set(identity, {
            ...merged,
            baseVersions: nusTitle.baseVersions,
            updateVersions: nusTitle.updateVersions,
            dlcVersions: nusTitle.dlcVersions,
            availableOnCdn: nusTitle.availableOnCdn,
        });
    }

    return [...byIdentity.values()];
}

function mergeVersions(a: readonly number[], b: readonly number[]): number[] {
    return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

type VersionField = 'baseVersions' | 'updateVersions' | 'dlcVersions';

type VersionTarget = {
    field: VersionField;
    kind: TitleKinds;
};

const versionTargets: readonly VersionTarget[] = [
    { field: 'baseVersions', kind: TitleKinds.Base },
    { field: 'updateVersions', kind: TitleKinds.Update },
    { field: 'dlcVersions', kind: TitleKinds.DLC },
];

async function readOptionalTmd(
    platform: TitleLookupPlatform,
    titleId: string,
    version?: number
): Promise<Tmd | null> {
    const baseUrl =
        platform === '3ds' ? THREE_DS_NUS_BASE_URL : WII_U_NUS_BASE_URL;
    const options: DownloadOptions =
        platform === '3ds'
            ? {
                  ...(await loadThreeDSClientCertificateOptions()),
                  logDownload: false,
              }
            : { logDownload: false };
    const target = `${titleId}/tmd${
        version === undefined ? '' : `.${version.toString()}`
    }`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const tmd = readTmdFromBuffer(
                await limitVersionRequest(() =>
                    downloadTmd(baseUrl, titleId, options, version)
                )
            );
            if (!tmd || tmd.header.titleId.toString('hex') !== titleId) {
                throw new Error(`Invalid TMD for ${titleId}`);
            }
            if (version !== undefined && tmd.header.titleVersion !== version) {
                throw new Error(`Unexpected TMD version for ${titleId}`);
            }
            return tmd;
        } catch (error) {
            if (isHttpErrorStatus(error, [403, 404])) {
                return null;
            }
            const retryable =
                isRetryableSourceError(error) || error instanceof TypeError;
            if (!retryable || attempt === 3) {
                throw error;
            }
            console.warn(
                `[versions] transient failure for ${target}; ` +
                    `retrying (${attempt.toString()} / 2)`
            );
            await new Promise((resolve) =>
                setTimeout(resolve, 250 * 2 ** (attempt - 1))
            );
        }
    }

    throw new Error(`Unreachable retry state for ${target}`);
}

async function reconcileVersionTarget(
    platform: TitleLookupPlatform,
    baseTitleId: string,
    kind: TitleKinds,
    existingVersions: number[],
    setPhase: (phase: VersionWorkerPhase) => void
): Promise<number[]> {
    setPhase('scanning');
    let titleId: string;
    try {
        titleId = replaceTitleKind(baseTitleId, kind);
    } catch {
        return existingVersions;
    }
    const currentTmd = await readOptionalTmd(platform, titleId);
    if (!currentTmd) {
        return existingVersions;
    }

    setPhase('gettingVersions');
    const currentVersion = currentTmd.header.titleVersion;
    const verified =
        platform === 'wiiu'
            ? existingVersions
            : (
                  await mapPool(existingVersions, 1, async (version) =>
                      version === currentVersion ||
                      (await readOptionalTmd(platform, titleId, version))
                          ? version
                          : null
                  )
              ).filter((version): version is number => version !== null);
    const firstUnknown =
        existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 0;
    const candidates = Array.from(
        { length: Math.max(0, currentVersion - firstUnknown + 1) },
        (_, index) => firstUnknown + index
    );
    const discovered = (
        await mapPool(candidates, 1, async (version) =>
            (await readOptionalTmd(platform, titleId, version)) ? version : null
        )
    ).filter((version): version is number => version !== null);
    return mergeVersions([...verified, currentVersion], discovered);
}

type VersionWorkerPhase = 'scanning' | 'gettingVersions';

async function refreshVersionHistories(
    platform: TitleLookupPlatform,
    titles: RawTitleDatabaseEntry[],
    checkpoint: (titles: RawTitleDatabaseEntry[]) => Promise<void>
): Promise<RawTitleDatabaseEntry[]> {
    const refreshed = [...titles];
    const workerPhases = new Map<number, VersionWorkerPhase>();
    let completed = 0;
    let checkpointQueue = Promise.resolve();
    await mapPool(titles, parallel, async (title, index, workerIndex) => {
        const setPhase = (phase: VersionWorkerPhase): void => {
            workerPhases.set(workerIndex, phase);
        };
        setPhase('scanning');
        let updated = title;
        if (title.titleId) {
            for (const target of versionTargets) {
                updated = {
                    ...updated,
                    [target.field]: await reconcileVersionTarget(
                        platform,
                        title.titleId,
                        target.kind,
                        updated[target.field],
                        setPhase
                    ),
                };
            }
        }

        refreshed[index] = updated;
        completed += 1;
        const otherActiveWorkers = workerPhases.size - 1;
        const queuedTitles = titles.length - completed - otherActiveWorkers;
        if (queuedTitles > 0) {
            setPhase('scanning');
        } else {
            workerPhases.delete(workerIndex);
        }
        if (
            completed === 1 ||
            completed % 50 === 0 ||
            titles.length - completed < parallel
        ) {
            const scanning = [...workerPhases.values()].filter(
                (phase) => phase === 'scanning'
            ).length;
            const gettingVersions = workerPhases.size - scanning;
            console.log(
                `[versions] ${platform} ${completed} / ${titles.length}; ` +
                    `${scanning} threads scanning, ` +
                    `${gettingVersions} threads getting versions`
            );
        }

        if (completed % 50 === 0 || completed === titles.length) {
            const snapshot = [...refreshed];
            checkpointQueue = checkpointQueue.then(async () => {
                await checkpoint(snapshot);
            });
        }
        return updated;
    });
    await checkpointQueue;

    return refreshed;
}

async function loadDiscTitles(): Promise<DiscTitleDatabase> {
    if (!(await fileExists(wiiTdbFile))) {
        return { gamecube: [], wii: [] };
    }

    const parsed = parser.parse(
        await fs.readFile(wiiTdbFile, 'utf8')
    ) as GameTdbXmlFile;
    const games = toArray(parsed.datafile?.game)
        .filter(isGameTdbGame)
        .filter((game) => !isSkippedGameTdbTitle(game));
    const titles = {
        gamecube: [] as RawTitleDatabaseEntry[],
        wii: [] as RawTitleDatabaseEntry[],
    };

    for (const game of games) {
        const productCode = getDiscProductCode(game.id ?? null);
        if (!productCode) {
            continue;
        }

        const platform = isGameCubeGameTdbTitle(game) ? 'gamecube' : 'wii';
        titles[platform].push({
            name: normalizeTitleName(
                getGameTdbTitle(
                    getPreferredGameTdbLocale(getGameTdbLocales(game))
                ) ?? productCode
            ),
            region:
                normalizeRegion(null, productCode) ||
                normalizeRegion(game.region ?? null, null),
            productCode,
            companyCode: game.id?.slice(4, 6) || null,
            iconUrl: null,
            baseVersions: [],
            updateVersions: [],
            dlcVersions: [],
            availableOnCdn: false,
        });
    }

    return titles;
}

async function loadWiiUBrewTitles(): Promise<RawTitleDatabaseEntry[]> {
    if (!(await fileExists(wiiUBrewFile))) {
        return [];
    }

    const rows = parseCsvRows(await fs.readFile(wiiUBrewFile, 'utf8'));
    return rows
        .map((row): RawTitleDatabaseEntry | null => {
            const title = identifyWiiUTitle(row['Title ID']);
            if (!title) {
                return null;
            }
            const { titleId } = title;

            return {
                titleId,
                name: normalizeTitleName(row.Description),
                region: normalizeRegion(row.Region, row['Product Code']),
                productCode: row['Product Code'] ?? null,
                companyCode: row['Company Code'] ?? null,
                iconUrl: null,
                baseVersions: parseVersions(row.Versions),
                updateVersions: [],
                dlcVersions: [],
                availableOnCdn:
                    (row['Available on CDN?'] ?? '').toLowerCase() === 'yes'
                        ? true
                        : false,
            };
        })
        .filter((title): title is RawTitleDatabaseEntry => title !== null);
}

function getThreeDSTitleVersion(
    row: Pick<ThreeDSHShopRow, 'version'>
): number | null {
    if (row.version === 'N/A') {
        return null;
    }

    const version = Number.parseInt(row.version, 10);
    return Number.isFinite(version) ? version : null;
}

function addVersion(versions: number[], version: number | null): void {
    if (version !== null && !versions.includes(version)) {
        versions.push(version);
    }
}

function isThreeDSHShopRow(value: unknown): value is ThreeDSHShopRow {
    return stringFieldRecord(value, [
        'hshopId',
        'titleId',
        'name',
        'version',
        'productCode',
    ]);
}

function isThreeDSHShopIncludedRow(row: ThreeDSHShopRow): boolean {
    return (
        row.titleId !== '0004000001111100' &&
        row.productCode !== 'CTR-N-THEME' &&
        !row.productCode.startsWith('MOD-')
    );
}

async function loadThreeDSHShopTitles(): Promise<RawTitleDatabaseEntry[]> {
    if (!(await fileExists(threeDSHShopFile))) {
        console.log('[hshop] missing file', threeDSHShopFile);
        return [];
    }

    const rows = (await readOptionalJsonArray(threeDSHShopFile)).filter(
        isThreeDSHShopRow
    );
    const titles = new Map<string, RawTitleDatabaseEntry>();
    let skipped = 0;

    for (const row of rows) {
        if (!isThreeDSHShopIncludedRow(row)) {
            skipped++;
            continue;
        }

        const title = identifyThreeDSTitle(row.titleId ?? '');
        const productCode = row.productCode;
        if (!title) {
            skipped++;
            continue;
        }

        const baseTitleId = PARENT_KINDS.includes(title.kind as ParentKind)
            ? title.titleId
            : replaceTitleKind(title.titleId, TitleKinds.Base);
        let entry = titles.get(baseTitleId);
        if (!entry) {
            entry = {
                titleId: baseTitleId,
                name: normalizeTitleName(row.name),
                region: normalizeRegion(null, productCode),
                productCode,
                companyCode: null,
                iconUrl: null,
                baseVersions: [],
                updateVersions: [],
                dlcVersions: [],
                availableOnCdn: false,
            };
            titles.set(baseTitleId, entry);
        }

        const version = getThreeDSTitleVersion(row);
        switch (title.kind) {
            case TitleKinds.Base:
            case TitleKinds.Demo:
                entry.name = normalizeTitleName(row.name);
                entry.region = normalizeRegion(null, productCode);
                entry.productCode = productCode;
                addVersion(entry.baseVersions, version);
                break;
            case TitleKinds.Update:
                addVersion(entry.updateVersions, version);
                break;
            case TitleKinds.DLC:
                addVersion(entry.dlcVersions, version);
                break;
            default:
                break;
        }
    }

    const entries = [...titles.values()];
    for (const entry of entries) {
        entry.baseVersions.sort((a, b) => a - b);
        entry.updateVersions.sort((a, b) => a - b);
        entry.dlcVersions.sort((a, b) => a - b);
    }

    console.log('[hshop] rows:', rows.length);
    console.log('[hshop] skipped rows:', skipped);
    console.log('[hshop] usable titles:', entries.length);

    return entries;
}

function parseCsvRows(text: string): CsvRow[] {
    const parsed = CsvParse(text, {
        bom: true,
        columns: true,
        relaxColumnCount: true,
        skipEmptyLines: true,
    });

    const rows: CsvRow[] = [];
    for (const value of toArray(parsed as unknown)) {
        if (typeof value !== 'object' || value === null) {
            continue;
        }
        const row: CsvRow = {};
        for (const [key, item] of Object.entries(value)) {
            row[key] = typeof item === 'string' ? item : '';
        }
        rows.push(row);
    }
    return rows;
}

async function loadSamuraiIcons(): Promise<Icon[] | null> {
    const sources = samuraiNusSources.filter(
        (source) => source.region === 'US'
    );

    try {
        const catalogTitles = (
            await mapPool(sources, parallel, async (source) =>
                parseSamuraiCatalogTitles(
                    await downloadSourceText(getSamuraiContentsUrl(source)),
                    source
                )
            )
        ).flat();
        const pairs = await loadNinjaIdPairs(
            catalogTitles.map((title) => title.nsUid)
        );
        const titleIdByNsUid = new Map(
            pairs.map((pair) => [pair.nsUid, pair.titleId])
        );
        const icons: Icon[] = [];

        for (const title of catalogTitles) {
            const titleId = titleIdByNsUid.get(title.nsUid) ?? '';
            if (
                titleId !== '' &&
                title.iconUrl !== null &&
                getLookupPlatform(titleId) === title.source.platform
            ) {
                icons.push({ titleId, iconUrl: title.iconUrl });
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

    const icons = (await readOptionalJsonArray(iconsFile))
        .filter(isIcon)
        .map((icon) => ({
            titleId: identifyTitle(icon.titleId)?.titleId ?? '',
            iconUrl: icon.iconUrl,
        }))
        .filter((icon) => icon.titleId !== '');
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

async function downloadWiiUTdbXml(): Promise<void> {
    console.log(`Downloading ${wiiUTdbZipUrl}`);
    const zip = new Zip(await fetchBinary(wiiUTdbZipUrl));
    const entry = zip.getEntry('wiiutdb.xml');
    if (!entry) {
        throw new Error(`Missing wiiutdb.xml in ${wiiUTdbZipUrl}`);
    }

    await fs.writeFile(wiiUTdbFile, entry.getData());
    console.log(`Extracted ${wiiUTdbFile}`);
}

async function downloadWiiTdbXml(): Promise<void> {
    console.log(`Downloading ${wiiTdbZipUrl}`);
    const zip = new Zip(await fetchBinary(wiiTdbZipUrl));
    const entry = zip.getEntry('wiitdb.xml');
    if (!entry) {
        throw new Error(`Missing wiitdb.xml in ${wiiTdbZipUrl}`);
    }

    await fs.mkdir(path.dirname(wiiTdbFile), { recursive: true });
    await fs.writeFile(wiiTdbFile, entry.getData());
    console.log(`Extracted ${wiiTdbFile}`);
}

async function downloadThreeDSTdbXml(): Promise<void> {
    console.log(`Downloading ${threeDSTdbZipUrl}`);
    const zip = new Zip(await fetchBinary(threeDSTdbZipUrl));
    const entry = zip.getEntry('3dstdb.xml');
    if (!entry) {
        throw new Error(`Missing 3dstdb.xml in ${threeDSTdbZipUrl}`);
    }

    await fs.writeFile(threeDSTdbFile, entry.getData());
    console.log(`Extracted ${threeDSTdbFile}`);
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
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`Invalid generated title database: ${file}`);
    }

    const database = parsed as GeneratedTitleDatabase;
    const applyPlatformIcons = (
        titles: RawTitleDatabaseEntry[]
    ): RawTitleDatabaseEntry[] =>
        titles.map((title) => ({
            ...title,
            iconUrl:
                iconByTitleId.get(title.titleId ?? title.productCode ?? '') ??
                title.iconUrl ??
                null,
        }));

    await writeJson(file, {
        '3ds': applyPlatformIcons(database['3ds']),
        gamecube: applyPlatformIcons(database.gamecube),
        wiiu: applyPlatformIcons(database.wiiu),
        wii: applyPlatformIcons(database.wii),
    });
}

async function fileExists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

export async function main() {
    const options = parseGenerateOptions(process.argv.slice(2));

    if (options.refreshTdb) {
        await downloadWiiTdbXml();
        await downloadWiiUTdbXml();
        await downloadThreeDSTdbXml();
    }

    const titles = await loadTitles(options);

    await writeJson(titlesFile, titles);
    console.log(`Title data saved to ${titlesFile}`);

    await mergeSamuraiIcons();

    const icons = (await readOptionalJsonArray(iconsFile)).filter(isIcon);
    await applyIcons(titlesFile, icons);
}

function runMain(): void {
    let mainSettled = false;
    process.once('beforeExit', () => {
        if (!mainSettled) {
            console.error(
                'generate-titles exited with unresolved asynchronous work'
            );
            process.exitCode = 1;
        }
    });

    void main()
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(() => {
            mainSettled = true;
        });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
    runMain();
}
