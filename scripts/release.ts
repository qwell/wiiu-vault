import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { readAppVersion } from '../src/shared/scripts.js';

const execFileAsync = promisify(execFile);

const RELEASE_NAME = 'wiiu-vault';

const ROOT_DIR = process.cwd();
const RELEASE_ROOT = path.join(ROOT_DIR, 'release');
const LAUNCHER_DIR = path.join(ROOT_DIR, 'scripts', 'launcher');

type ReleaseTarget = {
    name: string;
    goos: string;
    goarch: string;
    launcherFileName: string;
};

const RELEASE_TARGETS: ReleaseTarget[] = [
    {
        name: 'windows-x64',
        goos: 'windows',
        goarch: 'amd64',
        launcherFileName: `${RELEASE_NAME}.exe`,
    },
    {
        name: 'windows-arm64',
        goos: 'windows',
        goarch: 'arm64',
        launcherFileName: `${RELEASE_NAME}.exe`,
    },
    {
        name: 'macos-x64',
        goos: 'darwin',
        goarch: 'amd64',
        launcherFileName: RELEASE_NAME,
    },
    {
        name: 'macos-arm64',
        goos: 'darwin',
        goarch: 'arm64',
        launcherFileName: RELEASE_NAME,
    },
    {
        name: 'linux-x64',
        goos: 'linux',
        goarch: 'amd64',
        launcherFileName: RELEASE_NAME,
    },
    {
        name: 'linux-arm64',
        goos: 'linux',
        goarch: 'arm64',
        launcherFileName: RELEASE_NAME,
    },
];

async function copyAppFiles(outputDir: string): Promise<void> {
    const appDir = path.join(outputDir, 'app');

    await fs.mkdir(appDir, { recursive: true });

    await fs.cp(path.join(ROOT_DIR, 'dist'), appDir, {
        recursive: true,
    });

    await fs.writeFile(
        path.join(appDir, 'package.json'),
        `${JSON.stringify({ type: 'module' }, null, 4)}\n`
    );
}

async function copyRootFiles(outputDir: string): Promise<void> {
    await fs.cp(
        path.join(ROOT_DIR, 'README.md'),
        path.join(outputDir, 'README.md')
    );
}

async function buildLauncher(
    target: ReleaseTarget,
    outputDir: string
): Promise<void> {
    const outputPath = path.join(outputDir, target.launcherFileName);

    console.log(`[release] building ${target.name} launcher`);

    const { stdout, stderr } = await execFileAsync(
        'go',
        ['build', '-o', outputPath, '.'],
        {
            cwd: LAUNCHER_DIR,
            env: {
                ...process.env,
                GOOS: target.goos,
                GOARCH: target.goarch,
            },
        }
    );

    if (stdout) {
        process.stdout.write(stdout);
    }

    if (stderr) {
        process.stderr.write(stderr);
    }

    if (target.goos !== 'windows') {
        await fs.chmod(outputPath, 0o755);
    }
}

async function createReleaseZip(
    outputDir: string,
    zipPath: string
): Promise<void> {
    await fs.rm(zipPath, { force: true });

    const zip = new AdmZip();
    zip.addLocalFolder(outputDir);
    zip.writeZip(zipPath);

    console.log(`[release] wrote ${zipPath}`);
}

async function createTargetRelease(
    version: string,
    target: ReleaseTarget
): Promise<void> {
    const outputDir = path.join(RELEASE_ROOT, `${RELEASE_NAME}-${target.name}`);
    const zipPath = path.join(
        RELEASE_ROOT,
        `${RELEASE_NAME}-${version}-${target.name}.zip`
    );

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(path.join(outputDir, 'runtime'), { recursive: true });

    await copyAppFiles(outputDir);
    await copyRootFiles(outputDir);
    await buildLauncher(target, outputDir);

    console.log(`[release] staged ${outputDir}`);

    await createReleaseZip(outputDir, zipPath);
}

async function main(): Promise<void> {
    const version = await readAppVersion(ROOT_DIR);

    await fs.mkdir(RELEASE_ROOT, { recursive: true });

    for (const target of RELEASE_TARGETS) {
        await createTargetRelease(version, target);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
