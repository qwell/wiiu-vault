import { build } from 'vite';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const root = process.cwd();
const execFileAsync = promisify(execFile);

type PackageJson = {
    version?: string;
};

async function readPackageVersion(): Promise<string> {
    const text = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const packageJson = JSON.parse(text) as PackageJson;

    return packageJson.version ?? '0.0.0';
}

async function readGitVersionSuffix(): Promise<string> {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd: root }
        );
        const hash = stdout.trim();
        if (!hash) {
            return '';
        }

        let dirty = false;
        try {
            await execFileAsync('git', ['diff', '--quiet'], { cwd: root });
        } catch {
            dirty = true;
        }

        return `+${hash}${dirty ? '.dirty' : ''}`;
    } catch {
        return '';
    }
}

async function readAppVersion(): Promise<string> {
    return `${await readPackageVersion()}${await readGitVersionSuffix()}`;
}

async function copyFileIntoDist(name: string) {
    await fs.copyFile(path.join(root, name), path.join(root, 'dist', name));
}

async function copyTitlesFileIntoDist(name: string) {
    await fs.mkdir(path.join(root, 'dist', 'titles'), { recursive: true });
    await fs.copyFile(
        path.join(root, 'titles', name),
        path.join(root, 'dist', 'titles', name)
    );
}

async function main() {
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    const version = await readAppVersion();

    // Server build
    await build({
        configFile: false,
        mode: 'production',
        build: {
            ssr: path.join(root, 'src/server/index.ts'),
            outDir: path.join(root, 'dist/server'),
            emptyOutDir: true,
            sourcemap: true,
        },
    });

    // Client build
    await build({
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
    });

    await copyFileIntoDist('config.json');
    await copyTitlesFileIntoDist('titles.json');
    await copyTitlesFileIntoDist('extra.json');
    await copyTitlesFileIntoDist('wiiutdb.json');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
