import path from 'path';
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import {
    createContentIv,
    createTitleKeyIv,
    decryptContentWithIndex,
    decryptContentWithIv,
    decryptContentWithBigIntIv,
    decryptTitleKey,
    generateTitleKeyCandidates,
} from './decryption.js';
import { getAppRoot } from './paths.js';

export type Tmd = {
    header: TmdHeader;
    contents: TmdContent[];
    certificates: TmdCertificates;
};

type TmdHeader = {
    titleId: Uint8Array;
    titleVersion: number;
    region: string;
    systemType: SYSTEM_TYPE;
    contentCount: number;
};

type TmdContent = {
    id: number;
    index: number;
    type: number;
    size: bigint;
    hash: Uint8Array;
};

type TmdCertificates = {
    certificate1: TmdCertificateFull | null;
    certificate2: TmdCertificateFull | null;
};

type TmdCertificateFull = {
    raw: Uint8Array;
    parsed: TmdCertificate | null;
};

type TmdCertificate = {
    signatureType: CertificateSignatureType;
    signature: Uint8Array;
    issuer: string;
    keyType: CertificateKeyType;
    name: string;
    keyId: number;
    publicKey: Uint8Array;
};

type CertificateSignatureType =
    | typeof CERT_SIGNATURE_RSA_4096
    | typeof CERT_SIGNATURE_RSA_2048
    | typeof CERT_SIGNATURE_ECC;

type CertificateKeyType =
    | typeof CERT_KEY_RSA_4096
    | typeof CERT_KEY_RSA_2048
    | typeof CERT_KEY_ECC;

export type Tik = {
    titleId: Uint8Array;
    titleVersion: number | null;
    encryptedKey: Uint8Array;
    cert0: Uint8Array | null;
    cert1: Uint8Array | null;
};

export type NusTitleMetadata = {
    titleId: string;
    titleVersion: number;
    name: string | null;
    region: string | null;
    productCode: string | null;
    companyCode: string | null;
    titleKey: Uint8Array | null;
    titleKeyPassword: string | null;
    metaJson: Record<string, unknown> | null;
};

export type ChildTitleMetadata = {
    titleId: string;
    childTitleId: string;
    exists: boolean;
    titleVersion: number | null;
};

class TitleMetadataError extends Error {
    stage: string;

    constructor(stage: string, message: string) {
        super(message);
        this.name = 'TitleMetadataError';
        this.stage = stage;
    }
}

export type NUSTitleInformation = {
    name: string | null;
    region: string | null;
    productCode: string | null;
    companyCode: string | null;
    version: number | null;
    titleVersion: number | null;
};

type FstEntry = {
    name: string;
    path: string;
    fullPath: string;
    isDirectory: boolean;
    contentId: number;
    extractWithHash: boolean;
    fileOffset: number;
    shiftedFileOffset: number;
    fileLength: number;
};

const REGION_JPN = 0;
const REGION_USA = 1;
const REGION_EUR = 2;
const REGION_ALL = 3;
const REGION_KOR = 4;

const REGION_JPN_NAME = 'JPN';
const REGION_USA_NAME = 'USA';
const REGION_EUR_NAME = 'EUR';
const REGION_ALL_NAME = 'ALL';
const REGION_KOR_NAME = 'KOR';
const REGION_UNK_NAME = 'UNK';

type SYSTEM_TYPE =
    | typeof SYSTEM_TYPE_WIIU
    | typeof SYSTEM_TYPE_WII
    | typeof SYSTEM_TYPE_UNKNOWN;

const SYSTEM_TYPE_WIIU = 'wiiu';
const SYSTEM_TYPE_WII = 'wii';
const SYSTEM_TYPE_UNKNOWN = 'unknown';

export const TITLE_TIK = 'title.tik';
export const TITLE_TMD = 'title.tmd';
export const TITLE_CERT = 'title.cert';
const CDN_TICKET_NAME = 'cetk';

const TIK_TITLE_ID_OFFSET = 0x1dc;
const TIK_TITLE_ID_SIZE = 8;
const TIK_VERSION_OFFSET = 0x1e6;
const TIK_VERSION_SIZE = 2;
const TIK_ENCRYPTED_KEY_OFFSET = 0x1bf;
const TIK_ENCRYPTED_KEY_SIZE = 16;
const TIK_CERT_1_OFFSET = 0x350;
const TIK_CERT_1_SIZE = 0x300;
const TIK_CERT_0_OFFSET = 0x650;
const TIK_CERT_0_SIZE = 0x400;

const CERT_SIGNATURE_RSA_4096 = 0x00010000;
const CERT_SIGNATURE_RSA_2048 = 0x00010001;
const CERT_SIGNATURE_ECC = 0x00010002;

const CERT_KEY_RSA_4096 = 0x00000000;
const CERT_KEY_RSA_2048 = 0x00000001;
const CERT_KEY_ECC = 0x00000002;

const TMD_TITLE_ID_OFFSET = 0x18c;
const TMD_TITLE_ID_SIZE = 8;
const TMD_VERSION_OFFSET = 0x1dc;
const TMD_VERSION_SIZE = 2;
const TMD_REGION_OFFSET = 0x19c;
const TMD_REGION_SIZE = 2;
const TMD_CONTENT_COUNT_OFFSET = 0x1de;
const TMD_CONTENT_COUNT_SIZE = 2;
const TMD_CONTENT_OFFSET = 0xb04;
const TMD_CONTENT_SIZE = 0x30;
const TMD_CERTIFICATE_1_SIZE = 0x400;
const TMD_CERTIFICATE_2_SIZE = 0x300;

const COMMON_KEY_SIZE = 16;
const FST_MAGIC = 'FST';
const FST_ENTRY_SIZE = 0x10;
const FST_CHANGE_OFFSET_FLAG = 0x0004;
const HASHED_BLOCK_SIZE = 0x10000;
const HASHED_BLOCK_DATA_OFFSET = 0x400;
const HASHED_BLOCK_DATA_SIZE = 0xfc00;
const NUS_BASE_URL = 'http://ccs.cdn.wup.shop.nintendo.net/ccs/download';

const META_XML_PARSER = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
});

// -- Public API --

export async function downloadNusTitleMetadata(
    titleId: string
): Promise<NusTitleMetadata | null> {
    const baseUrl = NUS_BASE_URL;
    const normalizedTitleId = replaceTitlePrefix(titleId, 'base');
    const commonKey = await readCommonKey().catch((error: unknown) => {
        throw new TitleMetadataError(
            'read_common_key',
            error instanceof Error ? error.message : 'Failed to read common key'
        );
    });

    const [tik, tmdBytes] = await Promise.all([
        downloadTicket(baseUrl, normalizedTitleId).catch((error: unknown) => {
            if (isHttpErrorStatus(error, 404)) {
                return null;
            }
            throw new TitleMetadataError(
                'download_ticket',
                error instanceof Error
                    ? error.message
                    : `Failed to download ticket for ${normalizedTitleId}`
            );
        }),
        downloadTmd(baseUrl, normalizedTitleId).catch((error: unknown) => {
            throw new TitleMetadataError(
                'download_tmd',
                error instanceof Error
                    ? error.message
                    : `Failed to download TMD for ${normalizedTitleId}`
            );
        }),
    ]);

    const tmd = readTmdFromBuffer(Buffer.from(tmdBytes));
    if (!tmd) {
        throw new TitleMetadataError(
            'parse_tmd',
            `Failed to parse TMD for ${normalizedTitleId}`
        );
    }

    const ticket = tik ? readTikFromBuffer(Buffer.from(tik)) : null;
    const fstContent = tmd.contents[0];
    if (!fstContent) {
        throw new TitleMetadataError(
            'missing_fst_content',
            `TMD has no first content entry for ${normalizedTitleId}`
        );
    }
    const encryptedFst = fstContent
        ? await downloadContent(
              baseUrl,
              normalizedTitleId,
              fstContent.id
          ).catch((error: unknown) => {
              throw new TitleMetadataError(
                  'download_fst_content',
                  error instanceof Error
                      ? error.message
                      : `Failed to download FST content for ${normalizedTitleId}`
              );
          })
        : null;

    const ticketTitleKey =
        ticket !== null
            ? decryptTitleKey(ticket.encryptedKey, commonKey, ticket.titleId)
            : null;
    const ticketDecryptedFst =
        encryptedFst && ticketTitleKey
            ? decryptContentWithBigIntIv(encryptedFst, ticketTitleKey, 0)
            : null;
    const generatedMatch =
        encryptedFst && !looksLikeFst(ticketDecryptedFst)
            ? (generateTitleKeyCandidates(tmd.header.titleId, commonKey).find(
                  (candidate) =>
                      looksLikeFst(
                          decryptContentWithBigIntIv(
                              encryptedFst,
                              candidate.titleKey,
                              0
                          )
                      )
              ) ?? null)
            : null;

    const titleKey = generatedMatch?.titleKey ?? ticketTitleKey;
    const decryptedFst =
        generatedMatch && encryptedFst
            ? decryptContentWithBigIntIv(
                  encryptedFst,
                  generatedMatch.titleKey,
                  0
              )
            : ticketDecryptedFst;
    if (!titleKey || !decryptedFst || !looksLikeFst(decryptedFst)) {
        throw new TitleMetadataError(
            'decrypt_fst',
            `No usable title key produced an FST for ${titleId}`
        );
    }

    const metaXml = await extractMetaXmlFromTitle(
        decryptedFst,
        tmd,
        titleKey,
        baseUrl,
        normalizedTitleId
    );
    if (!metaXml) {
        throw new TitleMetadataError(
            'extract_meta_xml',
            `Failed to extract meta.xml for ${normalizedTitleId}`
        );
    }
    const metaJson = metaXml ? readMetaXmlJson(metaXml) : null;
    const meta = metaXml ? readMetaXml(metaXml) : null;
    if (!metaJson) {
        throw new TitleMetadataError(
            'parse_meta_xml',
            `Failed to parse meta.xml for ${normalizedTitleId}`
        );
    }

    return {
        titleId: normalizedTitleId,
        titleVersion: tmd.header.titleVersion,
        name: meta?.name ?? null,
        region: meta?.region ?? null,
        productCode: meta?.productCode ?? null,
        companyCode: meta?.companyCode ?? null,
        titleKey,
        titleKeyPassword: generatedMatch?.password ?? null,
        metaJson,
    };
}

export async function getUpdateMetadata(
    baseTitleId: string
): Promise<ChildTitleMetadata> {
    return getChildTitleMetadata(
        baseTitleId,
        replaceTitlePrefix(baseTitleId, 'update')
    );
}

export async function getDlcMetadata(
    baseTitleId: string
): Promise<ChildTitleMetadata> {
    return getChildTitleMetadata(
        baseTitleId,
        replaceTitlePrefix(baseTitleId, 'dlc')
    );
}

export function readMetaXml(buffer: Uint8Array): NUSTitleInformation | null {
    const menu = readMetaXmlJson(buffer);
    const productCode = getMenuString(menu, 'product_code');
    const companyCode = getMenuString(menu, 'company_code');
    const name = getMenuString(menu, 'longname_en');
    const region = parseMetaRegion(getMenuString(menu, 'region'));
    const version = parseMetaUnsignedInt(getMenuString(menu, 'version'));
    const titleVersion = parseMetaUnsignedInt(
        getMenuString(menu, 'title_version')
    );

    if (
        !productCode &&
        !companyCode &&
        !name &&
        !region &&
        version === null &&
        titleVersion === null
    ) {
        return null;
    }

    return { productCode, companyCode, name, region, version, titleVersion };
}

export function readMetaXmlJson(
    buffer: Uint8Array
): Record<string, unknown> | null {
    const xml = Buffer.from(buffer)
        .toString('utf8')
        .replace(/^\uFEFF/, '');
    const normalized = normalizeXmlText(xml);
    if (!normalized) {
        return null;
    }
    const parsed = META_XML_PARSER.parse(normalized) as {
        menu?: Record<string, unknown>;
    };
    return parsed.menu ?? null;
}

export function readTikFromBuffer(buffer: Buffer): Tik | null {
    if (buffer.length < TIK_VERSION_OFFSET + TIK_VERSION_SIZE) {
        return null;
    }
    return {
        titleId: new Uint8Array(
            buffer.subarray(
                TIK_TITLE_ID_OFFSET,
                TIK_TITLE_ID_OFFSET + TIK_TITLE_ID_SIZE
            )
        ),
        titleVersion: buffer.readUintBE(TIK_VERSION_OFFSET, TIK_VERSION_SIZE),
        encryptedKey: new Uint8Array(
            buffer.subarray(
                TIK_ENCRYPTED_KEY_OFFSET,
                TIK_ENCRYPTED_KEY_OFFSET + TIK_ENCRYPTED_KEY_SIZE
            )
        ),
        cert0:
            buffer.length >= TIK_CERT_0_OFFSET + TIK_CERT_0_SIZE
                ? new Uint8Array(
                      buffer.subarray(
                          TIK_CERT_0_OFFSET,
                          TIK_CERT_0_OFFSET + TIK_CERT_0_SIZE
                      )
                  )
                : null,
        cert1:
            buffer.length >= TIK_CERT_1_OFFSET + TIK_CERT_1_SIZE
                ? new Uint8Array(
                      buffer.subarray(
                          TIK_CERT_1_OFFSET,
                          TIK_CERT_1_OFFSET + TIK_CERT_1_SIZE
                      )
                  )
                : null,
    };
}

export async function readTikHeader(dirPath: string): Promise<Tik | null> {
    try {
        const buffer = await readFile(path.join(dirPath, TITLE_TIK));
        return readTikFromBuffer(buffer);
    } catch {
        return null;
    }
}

export function readTmdFromBuffer(buffer: Buffer): Tmd | null {
    const header = readTmdHeader(buffer.subarray(0, TMD_CONTENT_OFFSET));
    if (!header) {
        return null;
    }
    const contents = readTmdContents(
        buffer.subarray(TMD_CONTENT_OFFSET),
        header.contentCount
    );
    const certificateOffset =
        TMD_CONTENT_OFFSET + header.contentCount * TMD_CONTENT_SIZE;
    const certificates = readTmdCertificates(
        buffer.subarray(certificateOffset)
    );
    return { header, contents, certificates };
}

export async function readTmd(dirPath: string): Promise<Tmd | null> {
    try {
        const buffer = await readFile(path.join(dirPath, TITLE_TMD));
        return readTmdFromBuffer(buffer);
    } catch {
        return null;
    }
}

export function readTmdHeader(buffer: Buffer): TmdHeader | null {
    if (buffer.length < TMD_CONTENT_COUNT_OFFSET + TMD_CONTENT_COUNT_SIZE) {
        return null;
    }
    const titleId = new Uint8Array(
        buffer.subarray(
            TMD_TITLE_ID_OFFSET,
            TMD_TITLE_ID_OFFSET + TMD_TITLE_ID_SIZE
        )
    );
    const systemType = getSystemType(titleId);
    if (!isWiiU(systemType)) {
        return null;
    }
    return {
        titleId,
        titleVersion: buffer.readUintBE(TMD_VERSION_OFFSET, TMD_VERSION_SIZE),
        region: getRegionName(
            buffer.readUintBE(TMD_REGION_OFFSET, TMD_REGION_SIZE)
        ),
        systemType,
        contentCount: buffer.readUIntBE(
            TMD_CONTENT_COUNT_OFFSET,
            TMD_CONTENT_COUNT_SIZE
        ),
    };
}

export function readTmdCertificate(buffer: Buffer): TmdCertificate | null {
    if (buffer.length < 4) {
        return null;
    }
    const signatureType = buffer.readUInt32BE(0);
    if (!isValidCertificateSignatureType(signatureType)) {
        return null;
    }
    const signatureSize = getCertificateSignatureSize(signatureType);
    const signatureOffset = 0x04;
    const issuerOffset = 0x40 + signatureSize;
    const keyTypeOffset = 0x80 + signatureSize;
    const nameOffset = 0x84 + signatureSize;
    const keyIdOffset = 0x0c4 + signatureSize;
    const publicKeyOffset = 0x0c8 + signatureSize;

    if (buffer.length < publicKeyOffset) {
        return null;
    }
    const keyType = buffer.readUInt32BE(keyTypeOffset);
    if (!isCertificateKeyType(keyType)) {
        return null;
    }
    const publicKeySize = getCertificatePublicKeySize(keyType);
    if (buffer.length < publicKeyOffset + publicKeySize) {
        return null;
    }
    return {
        signatureType,
        signature: new Uint8Array(
            buffer.subarray(signatureOffset, signatureOffset + signatureSize)
        ),
        issuer: buffer
            .toString('ascii', issuerOffset, issuerOffset + 64)
            .replace(/\0.*$/, ''),
        keyType,
        name: buffer
            .toString('ascii', nameOffset, nameOffset + 64)
            .replace(/\0.*$/, ''),
        keyId: buffer.readUInt32BE(keyIdOffset),
        publicKey: new Uint8Array(
            buffer.subarray(publicKeyOffset, publicKeyOffset + publicKeySize)
        ),
    };
}

export function getTitleIdHex(value: Uint8Array): string {
    return Buffer.from(value).toString('hex');
}

export function getTitleIdNumber(value: Uint8Array): bigint {
    return Buffer.from(value).readBigUInt64BE(0);
}

export async function readCommonKey(
    filePath = path.join(getAppRoot(), 'common.key')
): Promise<Uint8Array> {
    const raw = await readFile(filePath, 'utf8');
    const normalized = raw.replace(/\s+/g, '');
    if (!/^[\da-fA-F]+$/.test(normalized)) {
        throw new Error(`common key at ${filePath} is not valid hex`);
    }
    if (normalized.length !== COMMON_KEY_SIZE * 2) {
        throw new Error(
            `common key at ${filePath} must be ${COMMON_KEY_SIZE * 2} hex chars`
        );
    }
    return new Uint8Array(Buffer.from(normalized, 'hex'));
}

export async function downloadTicket(
    baseUrl: string,
    titleId: string
): Promise<Uint8Array> {
    return downloadBinary(getTicketUrl(baseUrl, titleId), 'ticket');
}

export async function downloadTmd(
    baseUrl: string,
    titleId: string
): Promise<Uint8Array> {
    return downloadBinary(getTmdUrl(baseUrl, titleId), 'tmd');
}

export async function downloadContent(
    baseUrl: string,
    titleId: string,
    contentId: number
): Promise<Uint8Array> {
    return downloadBinary(
        getContentUrl(baseUrl, titleId, contentId),
        `content ${formatContentId(contentId)}`
    );
}

export async function downloadContentH3(
    baseUrl: string,
    titleId: string,
    contentId: number
): Promise<Uint8Array> {
    return downloadBinary(
        getContentH3Url(baseUrl, titleId, contentId),
        `content ${formatContentId(contentId)}.h3`
    );
}

export function getTicketUrl(baseUrl: string, titleId: string): string {
    return buildDownloadUrl(baseUrl, titleId, CDN_TICKET_NAME);
}

export function getTmdUrl(baseUrl: string, titleId: string): string {
    return buildDownloadUrl(baseUrl, titleId, 'tmd');
}

export function getContentUrl(
    baseUrl: string,
    titleId: string,
    contentId: number
): string {
    return buildDownloadUrl(baseUrl, titleId, formatContentId(contentId));
}

export function getContentH3Url(
    baseUrl: string,
    titleId: string,
    contentId: number
): string {
    return buildDownloadUrl(
        baseUrl,
        titleId,
        `${formatContentId(contentId)}.h3`
    );
}

// -- Internal --

async function extractMetaXmlFromTitle(
    decryptedFst: Uint8Array,
    tmd: Tmd,
    titleKey: Uint8Array,
    baseUrl: string,
    titleId: string
): Promise<Uint8Array | null> {
    const entries = parseFstEntries(decryptedFst, tmd);
    const metaEntry =
        entries.find((entry) => entry.fullPath === 'meta/meta.xml') ??
        entries.find((entry) => entry.name === 'meta.xml');

    if (!metaEntry || metaEntry.isDirectory) {
        return null;
    }
    const content = tmd.contents[metaEntry.contentId];
    if (!content) {
        return null;
    }

    const encryptedContent = await downloadContent(
        baseUrl,
        titleId,
        content.id
    );
    const decryptedContent = decryptTitleContent(
        encryptedContent,
        titleKey,
        content.index,
        metaEntry.extractWithHash,
        tmd.header.titleId,
        metaEntry
    );
    const extracted = extractFileFromContent(decryptedContent, metaEntry);
    if (!extracted) {
        return null;
    }
    return extracted.slice(findXmlStartByte(extracted));
}

function decryptTitleContent(
    encryptedContent: Uint8Array,
    titleKey: Uint8Array,
    contentIndex: number,
    extractWithHash: boolean,
    titleId: Uint8Array,
    entry: FstEntry
): Uint8Array {
    const decrypt = (iv: Uint8Array) =>
        extractWithHash
            ? decryptHashedContent(encryptedContent, titleKey, iv)
            : decryptContentWithIv(encryptedContent, titleKey, iv);

    const candidates = [
        createContentIv(contentIndex),
        createTitleKeyIv(titleId),
        new Uint8Array(16),
    ];

    for (const iv of candidates) {
        const decrypted = decrypt(iv);
        if (startsWithXml(extractFileFromContent(decrypted, entry))) {
            return decrypted;
        }
    }

    // Fallback: use content index IV
    return extractWithHash
        ? decryptHashedContent(
              encryptedContent,
              titleKey,
              createContentIv(contentIndex)
          )
        : decryptContentWithIndex(encryptedContent, titleKey, contentIndex);
}

function decryptHashedContent(
    encryptedContent: Uint8Array,
    titleKey: Uint8Array,
    iv: Uint8Array
): Uint8Array {
    const output = new Uint8Array(encryptedContent.length);

    for (
        let blockOffset = 0;
        blockOffset < encryptedContent.length;
        blockOffset += HASHED_BLOCK_SIZE
    ) {
        const encryptedBlock = encryptedContent.slice(
            blockOffset,
            Math.min(blockOffset + HASHED_BLOCK_SIZE, encryptedContent.length)
        );
        if (encryptedBlock.length === 0) continue;

        // Decrypt the hash area (first 0x400 bytes) using the block IV
        const decryptedHashArea = decryptContentWithIv(
            encryptedBlock.slice(0, HASHED_BLOCK_DATA_OFFSET),
            titleKey,
            iv
        );

        // The data IV is the first 16 bytes of the decrypted hash area (H0[0])
        const dataIv = decryptedHashArea.slice(0x00, 0x10);

        // Decrypt the data area (0x400 onward) using the data IV
        const decryptedDataArea = decryptContentWithIv(
            encryptedBlock.slice(HASHED_BLOCK_DATA_OFFSET),
            titleKey,
            dataIv
        );

        output.set(decryptedHashArea, blockOffset);
        output.set(decryptedDataArea, blockOffset + HASHED_BLOCK_DATA_OFFSET);
    }

    return output;
}

function extractFileFromContent(
    decryptedContent: Uint8Array,
    entry: FstEntry
): Uint8Array | null {
    return entry.extractWithHash
        ? extractHashedContentSlice(
              decryptedContent,
              entry.shiftedFileOffset,
              entry.fileLength
          )
        : sliceRange(
              decryptedContent,
              entry.shiftedFileOffset,
              entry.fileLength
          );
}

function extractHashedContentSlice(
    buffer: Uint8Array,
    logicalOffset: number,
    length: number
): Uint8Array | null {
    if (logicalOffset < 0 || length < 0) {
        return null;
    }
    const output = new Uint8Array(length);
    let sourceOffset = logicalOffset;
    let targetOffset = 0;
    let remaining = length;

    while (remaining > 0) {
        const blockIndex = Math.floor(sourceOffset / HASHED_BLOCK_DATA_SIZE);
        const blockDataOffset = sourceOffset % HASHED_BLOCK_DATA_SIZE;
        const physicalOffset =
            blockIndex * HASHED_BLOCK_SIZE +
            HASHED_BLOCK_DATA_OFFSET +
            blockDataOffset;
        const chunkSize = Math.min(
            remaining,
            HASHED_BLOCK_DATA_SIZE - blockDataOffset
        );

        if (physicalOffset + chunkSize > buffer.length) {
            return null;
        }
        output.set(
            buffer.slice(physicalOffset, physicalOffset + chunkSize),
            targetOffset
        );
        sourceOffset += chunkSize;
        targetOffset += chunkSize;
        remaining -= chunkSize;
    }

    return output;
}

function parseFstEntries(decryptedFst: Uint8Array, tmd: Tmd): FstEntry[] {
    if (!looksLikeFst(decryptedFst)) {
        return [];
    }
    const buffer = Buffer.from(decryptedFst);
    const totalContentCount = buffer.readUInt32BE(8);
    const baseOffset = 0x20 + totalContentCount * 0x20;

    if (buffer.length < baseOffset + FST_ENTRY_SIZE) {
        return [];
    }
    const totalEntries = buffer.readUInt32BE(baseOffset + 8);
    const nameOffsetBase = baseOffset + totalEntries * 0x10;
    const directoryStack: Array<{ name: string; nextOffset: number }> = [];
    const entries: FstEntry[] = [];

    for (let i = 0; i < totalEntries; i += 1) {
        while (
            directoryStack.length > 0 &&
            directoryStack[directoryStack.length - 1].nextOffset === i
        ) {
            directoryStack.pop();
        }

        const offset = baseOffset + i * FST_ENTRY_SIZE;
        if (offset + FST_ENTRY_SIZE > buffer.length) {
            break;
        }

        const type = buffer[offset];
        const isDirectory = (type & 0x01) === 0x01;
        const nameOffset = buffer.readUInt32BE(offset) & 0x00ff_ffff;
        const name = readNullTerminatedString(
            buffer,
            nameOffsetBase + nameOffset
        );
        const fileOffset = buffer.readUInt32BE(offset + 4);
        const fileLength = buffer.readUInt32BE(offset + 8);
        const flags = buffer.readUInt16BE(offset + 12);
        const contentId = buffer.readUInt16BE(offset + 14);
        const content = tmd.contents[contentId];
        const dirPath = directoryStack
            .map((e) => e.name)
            .filter((n) => n.length > 0)
            .join('/');
        const fullPath = [dirPath, name].filter((n) => n.length > 0).join('/');

        entries.push({
            name,
            path: dirPath,
            fullPath,
            isDirectory,
            contentId,
            extractWithHash:
                content !== undefined && (content.type & 0x2003) === 0x2003,
            fileOffset,
            shiftedFileOffset:
                (flags & FST_CHANGE_OFFSET_FLAG) === 0
                    ? fileOffset << 5
                    : fileOffset,
            fileLength,
        });

        if (isDirectory) {
            directoryStack.push({ name, nextOffset: fileLength });
        }
    }

    return entries;
}

function readTmdContents(buffer: Buffer, contentCount: number): TmdContent[] {
    if (buffer.length < contentCount * TMD_CONTENT_SIZE) {
        throw new Error('Invalid TMD content table size');
    }
    const contents: TmdContent[] = [];
    for (let i = 0; i < contentCount; i += 1) {
        const offset = i * TMD_CONTENT_SIZE;
        contents.push(
            readTmdContent(buffer.subarray(offset, offset + TMD_CONTENT_SIZE))
        );
    }
    return contents;
}

function readTmdContent(buffer: Buffer): TmdContent {
    const hashSize = 32;
    if (buffer.length < hashSize + 16) {
        throw new Error('Invalid TMD content buffer size');
    }
    return {
        id: buffer.readUInt32BE(0),
        index: buffer.readUInt16BE(4),
        type: buffer.readUInt16BE(6),
        size: buffer.readBigUInt64BE(8),
        hash: new Uint8Array(buffer.subarray(16, 16 + hashSize)),
    };
}

function readTmdCertificates(buffer: Buffer): TmdCertificates {
    if (buffer.length < TMD_CERTIFICATE_1_SIZE + TMD_CERTIFICATE_2_SIZE) {
        return { certificate1: null, certificate2: null };
    }
    const cert1Raw = new Uint8Array(buffer.subarray(0, TMD_CERTIFICATE_1_SIZE));
    const cert2Raw = new Uint8Array(
        buffer.subarray(
            TMD_CERTIFICATE_1_SIZE,
            TMD_CERTIFICATE_1_SIZE + TMD_CERTIFICATE_2_SIZE
        )
    );
    return {
        certificate1: {
            raw: cert1Raw,
            parsed: readTmdCertificate(Buffer.from(cert1Raw)),
        },
        certificate2: {
            raw: cert2Raw,
            parsed: readTmdCertificate(Buffer.from(cert2Raw)),
        },
    };
}

function getCertificatePublicKeySize(keyType: CertificateKeyType): number {
    switch (keyType) {
        case CERT_KEY_RSA_4096:
            return 0x238;
        case CERT_KEY_RSA_2048:
            return 0x138;
        case CERT_KEY_ECC:
            return 0x78;
    }
}

function getCertificateSignatureSize(
    signatureType: CertificateSignatureType
): number {
    switch (signatureType) {
        case CERT_SIGNATURE_RSA_4096:
            return 0x200;
        case CERT_SIGNATURE_RSA_2048:
            return 0x100;
        case CERT_SIGNATURE_ECC:
            return 0x3c;
    }
}

function isValidCertificateSignatureType(
    value: number
): value is CertificateSignatureType {
    return (
        value === CERT_SIGNATURE_RSA_4096 ||
        value === CERT_SIGNATURE_RSA_2048 ||
        value === CERT_SIGNATURE_ECC
    );
}

function isCertificateKeyType(value: number): value is CertificateKeyType {
    return (
        value === CERT_KEY_RSA_4096 ||
        value === CERT_KEY_RSA_2048 ||
        value === CERT_KEY_ECC
    );
}

function getRegionName(region: number): string {
    switch (region) {
        case REGION_JPN:
            return REGION_JPN_NAME;
        case REGION_USA:
            return REGION_USA_NAME;
        case REGION_EUR:
            return REGION_EUR_NAME;
        case REGION_ALL:
            return REGION_ALL_NAME;
        case REGION_KOR:
            return REGION_KOR_NAME;
        default:
            return REGION_UNK_NAME;
    }
}

function getSystemType(titleId: Uint8Array): SYSTEM_TYPE {
    if (!titleId || titleId.length < 2) return SYSTEM_TYPE_UNKNOWN;
    if (titleId[0] === 0x00 && titleId[1] === 0x05) return SYSTEM_TYPE_WIIU;
    if (titleId[0] === 0x00 && titleId[1] === 0x01) return SYSTEM_TYPE_WII;
    return SYSTEM_TYPE_UNKNOWN;
}

function isWiiU(systemType: SYSTEM_TYPE): boolean {
    return systemType === SYSTEM_TYPE_WIIU;
}

function looksLikeFst(value: Uint8Array | null): boolean {
    return (
        value !== null &&
        value.length >= 3 &&
        Buffer.from(value.subarray(0, 3)).toString('ascii') === FST_MAGIC
    );
}

function startsWithXml(buffer: Uint8Array | null): boolean {
    if (!buffer || buffer.length === 0) return false;
    const text = Buffer.from(
        buffer.subarray(0, Math.min(buffer.length, 16))
    ).toString('latin1');
    return text.includes('<?xml') || text.includes('<menu');
}

function findXmlStartByte(buffer: Uint8Array): number {
    const source = Buffer.from(buffer);
    const xmlIndex = source.indexOf(Buffer.from('<?xml'));
    if (xmlIndex >= 0) return xmlIndex;
    const menuIndex = source.indexOf(Buffer.from('<menu'));
    return menuIndex >= 0 ? menuIndex : 0;
}

function normalizeXmlText(xml: string): string | null {
    return xml.startsWith('<?xml') || xml.startsWith('<menu') ? xml : null;
}

function sliceRange(
    buffer: Uint8Array,
    offset: number,
    length: number
): Uint8Array | null {
    if (offset < 0 || length < 0 || offset + length > buffer.length) {
        return null;
    }
    return buffer.slice(offset, offset + length);
}

function readNullTerminatedString(buffer: Buffer, offset: number): string {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
        end += 1;
    }
    return buffer.toString('utf8', offset, end);
}

function getMenuString(
    menu: Record<string, unknown> | null,
    key: string
): string | null {
    const value = menu?.[key];
    if (typeof value !== 'string') return null;
    return value.length > 0 ? value : null;
}

function parseMetaUnsignedInt(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseMetaRegion(value: string | null): string | null {
    if (!value) return null;
    const regionMask = Number.parseInt(value, 16);
    if (!Number.isFinite(regionMask)) return null;
    if (regionMask === 0x1) return 'JPN';
    if (regionMask === 0x2) return 'USA';
    if (regionMask === 0x4) return 'EUR';
    if (regionMask === 0x7) return 'ALL';
    return value;
}

async function getChildTitleMetadata(
    baseTitleId: string,
    titleId: string
): Promise<ChildTitleMetadata> {
    const baseUrl = NUS_BASE_URL;

    try {
        const tmdBytes = await downloadTmd(baseUrl, titleId);
        const tmd = readTmdFromBuffer(Buffer.from(tmdBytes));

        return {
            titleId: baseTitleId,
            childTitleId: titleId,
            exists: tmd !== null,
            titleVersion: tmd?.header.titleVersion ?? null,
        };
    } catch (error) {
        if (isHttpErrorStatus(error, 404)) {
            return {
                titleId: baseTitleId,
                childTitleId: titleId,
                exists: false,
                titleVersion: null,
            };
        }

        throw error;
    }
}

function replaceTitlePrefix(
    titleId: string,
    nextKind: 'base' | 'update' | 'dlc' | 'demo'
): string {
    const normalizedTitleId = titleId.toLowerCase();

    if (!/^[0-9a-f]{16}$/.test(normalizedTitleId)) {
        throw new Error(`Invalid titleId: ${titleId}`);
    }

    let normalizedPrefix: string;
    switch (nextKind) {
        case 'base':
            normalizedPrefix = '00050000';
            break;
        case 'update':
            normalizedPrefix = '0005000e';
            break;
        case 'dlc':
            normalizedPrefix = '0005000c';
            break;
        case 'demo':
            normalizedPrefix = '00050002';
            break;
    }

    if (!/^[0-9a-f]{8}$/.test(normalizedPrefix)) {
        throw new Error(`Invalid title kind: ${nextKind}`);
    }

    return `${normalizedPrefix}${normalizedTitleId.slice(8)}`;
}

function buildDownloadUrl(
    baseUrl: string,
    titleId: string,
    suffix: string
): string {
    const normalizedTitleId = titleId.replace(/^\/+|\/+$/g, '');
    return new URL(
        `${normalizedTitleId}/${suffix}`,
        ensureTrailingSlash(baseUrl)
    ).toString();
}

function formatContentId(contentId: number): string {
    if (
        !Number.isInteger(contentId) ||
        contentId < 0 ||
        contentId > 0xffffffff
    ) {
        throw new Error(`contentId must be a uint32, got ${contentId}`);
    }
    return contentId.toString(16).toUpperCase().padStart(8, '0');
}

async function downloadBinary(
    url: string,
    label = 'file'
): Promise<Uint8Array> {
    console.log(`[metadata] downloading ${label}: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`download failed for ${url}: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    console.log(
        `[metadata] downloaded ${label}: ${url} (${bytes.length} bytes)`
    );
    return bytes;
}

function ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
}

function isHttpErrorStatus(error: unknown, status: number): boolean {
    return error instanceof Error && error.message.includes(`: ${status}`);
}
