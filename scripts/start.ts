import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'dist');

await fs.copyFile(
    path.join(root, 'config.json'),
    path.join(appRoot, 'config.json')
);

process.env.APP_ROOT = appRoot;

await import('../src/server/index.js');
