import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readAppVersion } from '../src/shared/scripts.js';

const projectRoot = process.cwd();

async function copyTitlesFileIntoDist(name: string) {
    await fs.mkdir(path.join(projectRoot, 'dist', 'titles'), {
        recursive: true,
    });
    await fs.copyFile(
        path.join(projectRoot, 'titles', name),
        path.join(projectRoot, 'dist', 'titles', name)
    );
}

async function copyFilesIntoDist() {
    await copyTitlesFileIntoDist('titles.json');
    await copyTitlesFileIntoDist('extra.json');
    await copyTitlesFileIntoDist('wiiutdb.json');
}

function isElectronExternal(id: string): boolean {
    return id === 'electron' || id === '#server' || id.startsWith('node:');
}

async function main() {
    await fs.rm(path.join(projectRoot, 'dist'), {
        recursive: true,
        force: true,
    });
    await fs.mkdir(path.join(projectRoot, 'dist'), { recursive: true });

    const version = await readAppVersion(projectRoot);

    await Promise.all([
        // server
        build({
            configFile: false,
            mode: 'production',
            define: {
                __APP_VERSION__: JSON.stringify(version),
            },
            ssr: {
                noExternal: true,
            },
            build: {
                ssr: path.join(projectRoot, 'src/server/index.ts'),
                outDir: path.join(projectRoot, 'dist/server'),
                emptyOutDir: false,
                sourcemap: true,
            },
        }),

        // client
        build({
            configFile: false,
            mode: 'production',
            root: path.join(projectRoot, 'src/client'),
            publicDir: false,
            define: {
                __APP_VERSION__: JSON.stringify(version),
            },
            build: {
                outDir: path.join(projectRoot, 'dist/client'),
                emptyOutDir: true,
                sourcemap: true,
            },
        }),

        // electron
        build({
            configFile: false,
            mode: 'production',
            define: {
                __APP_VERSION__: JSON.stringify(version),
            },
            ssr: {
                noExternal: true,
            },
            build: {
                ssr: path.join(projectRoot, 'electron/main.ts'),
                outDir: path.join(projectRoot, 'dist'),
                emptyOutDir: false,
                sourcemap: true,
                rollupOptions: {
                    external: isElectronExternal,
                    output: {
                        format: 'es',
                        entryFileNames: 'main.js',
                        chunkFileNames: 'chunks/[name].[hash].js',
                    },
                },
            },
        }),

        build({
            configFile: false,
            mode: 'production',
            build: {
                ssr: path.join(projectRoot, 'electron/preload.ts'),
                outDir: path.join(projectRoot, 'dist'),
                emptyOutDir: false,
                sourcemap: true,
                minify: false,
                rollupOptions: {
                    external: (id) =>
                        id === 'electron' || id.startsWith('node:'),
                    output: {
                        format: 'es',
                        entryFileNames: 'preload.js',
                        chunkFileNames: 'chunks/[name]-[hash].js',
                    },
                },
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
