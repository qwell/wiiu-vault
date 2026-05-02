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
        const { stdout: statusStdout } = await execFileAsync(
            'git',
            ['status', '--porcelain'],
            { cwd: root }
        );

        const dirty = statusStdout.trim().length > 0;

        let onExactTag = false;
        try {
            const { stdout } = await execFileAsync(
                'git',
                ['describe', '--tags', '--exact-match', 'HEAD'],
                { cwd: root }
            );

            onExactTag = stdout.trim().length > 0;
        } catch {
            onExactTag = false;
        }

        if (onExactTag && !dirty) {
            return '';
        }

        const { stdout: hashStdout } = await execFileAsync(
            'git',
            ['rev-parse', '--short', 'HEAD'],
            { cwd: root }
        );

        const hash = hashStdout.trim();
        if (!hash) {
            return '';
        }

        return `+${hash}${dirty ? '.dirty' : ''}`;
    } catch {
        return '';
    }
}

export async function readAppVersion(root: string): Promise<string> {
    return `${await readPackageVersion(root)}${await readGitVersionSuffix(root)}`;
}
