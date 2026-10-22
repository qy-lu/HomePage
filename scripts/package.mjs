import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let result = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const names = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'release/manifest.json'))));
const output = path.join(root, 'release/homepage.tar.gz');
result = spawnSync('tar', ['-czf', output, '-C', path.join(root, 'dist'), ...names,
  '-C', path.join(root, 'release'), 'manifest.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(output);
