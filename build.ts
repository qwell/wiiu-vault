import { build } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

async function copyFileIntoDist(name: string) {
    await fs.copyFile(path.join(root, name), path.join(root, 'dist', name));
}

async function main() {
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });

    // Server build
    await build({
        configFile: false,
        mode: 'production',
        build: {
            ssr: path.join(root, 'src/server/index.ts'),
            outDir: path.join(root, 'dist/server'),
            emptyOutDir: true,
            sourcemap: true,
            target: 'node18',
            rollupOptions: {
                // Add packages here if they should stay external at runtime
                external: [],
            },
        },
    });

    // Client build
    await build({
        configFile: false,
        mode: 'production',
        root: path.join(root, 'src/client'),
        publicDir: false,
        build: {
            outDir: path.join(root, 'dist/client'),
            emptyOutDir: false,
            sourcemap: true,
        },
    });

    await copyFileIntoDist('config.json');
    await copyFileIntoDist('titles.json');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
