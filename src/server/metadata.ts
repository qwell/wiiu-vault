import path from 'path';
import { readFile } from 'node:fs/promises';

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

type CertificateKeyType = typeof CERT_KEY_RSA_4096 | typeof CERT_KEY_RSA_2048 | typeof CERT_KEY_ECC;

export type Tik = {
    titleId: Uint8Array;
    titleVersion: number | null;
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

type SYSTEM_TYPE = typeof SYSTEM_TYPE_WIIU | typeof SYSTEM_TYPE_WII | typeof SYSTEM_TYPE_UNKNOWN;

const SYSTEM_TYPE_WIIU = 'wiiu';
const SYSTEM_TYPE_WII = 'wii';
const SYSTEM_TYPE_UNKNOWN = 'unknown';

export const TITLE_TIK = 'title.tik';
export const TITLE_TMD = 'title.tmd';
export const TITLE_CERT = 'title.cert';

const TIK_TITLE_ID_OFFSET = 0x1dc;
const TIK_TITLE_ID_SIZE = 8;
const TIK_VERSION_OFFSET = 0x1e6;
const TIK_VERSION_SIZE = 2;

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
const TMD_CONTENT_SIZE = 48; // 0x30

const TMD_CERTIFICATE_1_SIZE = 1024; // 0x400
const TMD_CERTIFICATE_2_SIZE = 768; // 0x300

export async function readTikHeader(dirPath: string): Promise<Tik | null> {
    try {
        const buffer = await readFile(path.join(dirPath, TITLE_TIK));
        const titleId = buffer.subarray(TIK_TITLE_ID_OFFSET, TIK_TITLE_ID_OFFSET + TIK_TITLE_ID_SIZE);

        return {
            titleId,
            titleVersion: buffer.readUintBE(TIK_VERSION_OFFSET, TIK_VERSION_SIZE),
        };
    } catch {
        return null;
    }
}

export async function readTmd(dirPath: string): Promise<Tmd | null> {
    try {
        const buffer = await readFile(path.join(dirPath, TITLE_TMD));

        const tmdHeader = readTmdHeader(buffer.subarray(0, TMD_CONTENT_OFFSET));
        if (!tmdHeader) {
            return null;
        }

        const tmdContents = readTmdContents(buffer.subarray(TMD_CONTENT_OFFSET), tmdHeader.contentCount);

        const certificateOffset = TMD_CONTENT_OFFSET + tmdHeader.contentCount * TMD_CONTENT_SIZE;
        const certificates = readTmdCertificates(buffer.subarray(certificateOffset));

        return {
            header: tmdHeader,
            contents: tmdContents,
            certificates: certificates,
        };
    } catch {
        return null;
    }
}

export function readTmdHeader(buffer: Buffer): TmdHeader | null {
    if (buffer.length < TMD_CONTENT_COUNT_OFFSET + TMD_CONTENT_COUNT_SIZE) {
        return null;
    }

    const titleId = new Uint8Array(buffer.subarray(TMD_TITLE_ID_OFFSET, TMD_TITLE_ID_OFFSET + TMD_TITLE_ID_SIZE));
    const titleVersion = buffer.readUintBE(TMD_VERSION_OFFSET, TMD_VERSION_SIZE);

    const region = getRegionName(buffer.readUintBE(TMD_REGION_OFFSET, TMD_REGION_SIZE));

    const systemType = getSystemType(titleId);

    if (isWiiU(systemType)) {
        const header: TmdHeader = {
            titleId,
            titleVersion,
            region,
            systemType,
            contentCount: buffer.readUIntBE(TMD_CONTENT_COUNT_OFFSET, TMD_CONTENT_COUNT_SIZE),
        };
        return header;
    }

    return null;
}

function readTmdContents(buffer: Buffer, contentCount: number): TmdContent[] {
    if (buffer.length < contentCount * TMD_CONTENT_SIZE) {
        throw new Error('Invalid TMD content table size');
    }

    const contents: TmdContent[] = [];

    let offset = 0;

    for (let i = 0; i < contentCount; i += 1) {
        const content: TmdContent = readTmdContent(buffer.subarray(offset, offset + TMD_CONTENT_SIZE));
        contents.push(content);

        offset += TMD_CONTENT_SIZE;
    }
    return contents;
}

function readTmdContent(buffer: Buffer): TmdContent {
    const hashSize = 32;

    if (buffer.length < hashSize + 16) {
        throw new Error('Invalid TMD content buffer size');
    }

    const content: TmdContent = {
        id: buffer.readUInt32BE(0),
        index: buffer.readUInt16BE(4),
        type: buffer.readUInt16BE(6),
        size: buffer.readBigUInt64BE(8),
        hash: new Uint8Array(buffer.subarray(16, 16 + hashSize)),
    };

    return content;
}

function readTmdCertificates(buffer: Buffer): TmdCertificates {
    if (buffer.length < TMD_CERTIFICATE_1_SIZE + TMD_CERTIFICATE_2_SIZE) {
        return {
            certificate1: null,
            certificate2: null,
        };
    }

    const certificate1Raw = new Uint8Array(buffer.subarray(0, TMD_CERTIFICATE_1_SIZE));
    const certificate2Raw = new Uint8Array(
        buffer.subarray(TMD_CERTIFICATE_1_SIZE, TMD_CERTIFICATE_1_SIZE + TMD_CERTIFICATE_2_SIZE)
    );

    return {
        certificate1: {
            raw: certificate1Raw,
            parsed: readTmdCertificate(Buffer.from(certificate1Raw)),
        },
        certificate2: {
            raw: certificate2Raw,
            parsed: readTmdCertificate(Buffer.from(certificate2Raw)),
        },
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

    const signature = new Uint8Array(buffer.subarray(signatureOffset, signatureOffset + signatureSize));
    const issuer = buffer.toString('ascii', issuerOffset, issuerOffset + 64);
    const name = buffer.toString('ascii', nameOffset, nameOffset + 64);
    const keyId = buffer.readUInt32BE(keyIdOffset);
    const publicKey = new Uint8Array(buffer.subarray(publicKeyOffset, publicKeyOffset + publicKeySize));

    return {
        signatureType,
        signature,
        issuer: issuer.replace(/\0.*$/, ''),
        keyType,
        name: name.replace(/\0.*$/, ''),
        keyId,
        publicKey,
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

function getCertificateSignatureSize(signatureType: CertificateSignatureType): number {
    switch (signatureType) {
        case CERT_SIGNATURE_RSA_4096:
            return 0x200;
        case CERT_SIGNATURE_RSA_2048:
            return 0x100;
        case CERT_SIGNATURE_ECC:
            return 0x3c;
    }
}

function isValidCertificateSignatureType(value: number): value is CertificateSignatureType {
    return value === CERT_SIGNATURE_RSA_4096 || value === CERT_SIGNATURE_RSA_2048 || value === CERT_SIGNATURE_ECC;
}

function isCertificateKeyType(value: number): value is CertificateKeyType {
    return value === CERT_KEY_RSA_4096 || value === CERT_KEY_RSA_2048 || value === CERT_KEY_ECC;
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
    if (!titleId || titleId.length < 2) {
        return SYSTEM_TYPE_UNKNOWN;
    }

    if (titleId[0] === 0x00 && titleId[1] === 0x05) {
        return SYSTEM_TYPE_WIIU;
    } else if (titleId[0] === 0x00 && titleId[1] === 0x01) {
        return SYSTEM_TYPE_WII;
    }
    return SYSTEM_TYPE_UNKNOWN;
}

function isWiiU(systemType: SYSTEM_TYPE): boolean {
    return systemType === SYSTEM_TYPE_WIIU;
}
