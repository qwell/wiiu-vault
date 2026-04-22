import path from 'node:path';

process.env.APP_ROOT = path.resolve('dist');

await import('../dist/server/index.js');
