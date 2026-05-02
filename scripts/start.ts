import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'dist');

process.env.APP_ROOT = appRoot;

await import('../src/server/index.js');
