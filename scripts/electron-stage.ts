import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const electronDist = path.join(projectRoot, 'dist');

type PackageJson = {
    name?: string;
    version?: string;
    description?: string;
    author?: string | { name?: string; email?: string; url?: string };
    main?: string;
    type: string;
    private?: boolean;
    imports?: Record<string, string>;
};

async function assertExists(label: string, filePath: string): Promise<void> {
    try {
        await access(filePath);
    } catch {
        throw new Error(
            `Missing ${label}: ${path.relative(projectRoot, filePath)}`
        );
    }
}

const rootPackageJson = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8')
) as PackageJson;

const electronPackageJson: PackageJson = {
    name: rootPackageJson.name ?? 'wiiu-vault',
    version: rootPackageJson.version ?? '0.0.0',
    description: rootPackageJson.description ?? 'Wii U Vault',
    author: rootPackageJson.author ?? '',
    main: 'main.js',
    type: 'module',
    private: true,
    imports: {
        '#server': './server/index.js',
    },
};

await assertExists(
    'Electron main build output',
    path.join(electronDist, 'main.js')
);

await assertExists(
    'Electron preload build output',
    path.join(electronDist, 'preload.js')
);

await copyFile(
    path.join(projectRoot, 'electron', 'electron-builder.yml'),
    path.join(electronDist, 'electron-builder.yml')
);

await writeFile(
    path.join(electronDist, 'package.json'),
    `${JSON.stringify(electronPackageJson, null, 2)}\n`
);

await writeFile(path.join(electronDist, 'yarn.lock'), '');

console.log('Staged Electron package metadata:');
console.log(
    `  ${path.relative(projectRoot, path.join(electronDist, 'electron-builder.yml'))}`
);
console.log(
    `  ${path.relative(projectRoot, path.join(electronDist, 'package.json'))}`
);
console.log(
    `  ${path.relative(projectRoot, path.join(electronDist, 'yarn.lock'))}`
);
