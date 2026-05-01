import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type PackageJson = {
    version?: string;
};

export async function readPackageVersion(root: string): Promise<string> {
    const text = await fs.readFile(path.join(root, 'package.json'), 'utf8');
    const packageJson = JSON.parse(text) as PackageJson;

    return packageJson.version ?? '0.0.0';
}

async function readGitVersionSuffix(root: string): Promise<string> {
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

export async function readAppVersion(root: string): Promise<string> {
    return `${await readPackageVersion(root)}${await readGitVersionSuffix(root)}`;
}
