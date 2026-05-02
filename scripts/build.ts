import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readAppVersion } from '../src/shared/scripts.js';

const root = process.cwd();

async function copyTitlesFileIntoDist(name: string) {
    await fs.mkdir(path.join(root, 'dist', 'titles'), { recursive: true });
    await fs.copyFile(
        path.join(root, 'titles', name),
        path.join(root, 'dist', 'titles', name)
    );
}

async function copyFilesIntoDist() {
    await copyTitlesFileIntoDist('titles.json');
    await copyTitlesFileIntoDist('extra.json');
    await copyTitlesFileIntoDist('wiiutdb.json');
}

async function main() {
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    const version = await readAppVersion(root);

    await Promise.all([
        // server
        build({
            configFile: false,
            mode: 'production',
            ssr: {
                noExternal: true,
            },
            build: {
                ssr: path.join(root, 'src/server/index.ts'),
                outDir: path.join(root, 'dist/server'),
                emptyOutDir: true,
                sourcemap: true,
            },
        }),

        // client
        build({
            configFile: false,
            mode: 'production',
            root: path.join(root, 'src/client'),
            publicDir: false,
            define: {
                __APP_VERSION__: JSON.stringify(version),
            },
            build: {
                outDir: path.join(root, 'dist/client'),
                emptyOutDir: false,
                sourcemap: true,
            },
        }),

        // other
        copyFilesIntoDist(),
    ]);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
