import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const root = process.cwd();
const inputPath = path.resolve(root, process.argv[2] ?? 'titles/wiiutdb.xml');
const outputPath = path.resolve(root, process.argv[3] ?? 'titles/wiiutdb.json');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
});

type ParsedDatafile = {
    datafile?: {
        game?: unknown;
    };
};

async function main() {
    const xml = await fs.readFile(inputPath, 'utf8');
    const json = parser.parse(xml) as ParsedDatafile;

    const games = json?.datafile?.game ?? [];

    await fs.writeFile(
        outputPath,
        JSON.stringify({ games }, null, 4) + '\n',
        'utf8'
    );

    console.log(`Converted ${inputPath} -> ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
