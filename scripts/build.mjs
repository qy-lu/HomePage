import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const dist = path.join(root, 'dist');
function files(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error('Symlinks are not allowed');
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(path.join(dir, entry.name), name + '/') : [name];
  }).sort();
}
const names = files(source);
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/production-baseline/live-manifest.json')));
for (const name of names) {
  if (!(name in baseline)) throw Error('Review the deployment allowlist before adding: ' + name);
  if (name.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', path.join(source, name)], { stdio: 'inherit' });
    if (check.status !== 0) throw Error('JavaScript syntax check failed');
  }
}
const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="((?:assets|css|js)\/[^"?#]+|icon\.png)"/g)) {
  if (!names.includes(match[1])) throw Error('Missing referenced resource: ' + match[1]);
}
// dist belongs exclusively to this local build. Server directories are never synced/deleted.
if (fs.lstatSync(dist, { throwIfNoEntry: false })?.isSymbolicLink()) throw Error('dist must not be a symlink');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(source, dist, { recursive: true });
const version = name => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(dist, name))).digest('hex').slice(0, 12);
// Version the dependency chain from leaves to entrypoint, so old browser caches
// cannot combine a fresh page with an incompatible script or stylesheet.
const backgroundPath = path.join(dist, 'js/background.js');
fs.writeFileSync(backgroundPath, fs.readFileSync(backgroundPath, 'utf8')
  .replace("'assets/background.png'", `'assets/background.png?v=${version('assets/background.png')}'`));
const mainPath = path.join(dist, 'js/main.js');
fs.writeFileSync(mainPath, fs.readFileSync(mainPath, 'utf8')
  .replace("import('./background.js')", `import('./background.js?v=${version('js/background.js')}')`));
fs.writeFileSync(path.join(dist, 'index.html'), html.replace(
  /((?:src|href)=")((?:assets|css|js)\/[^"?#]+|icon\.png)(")/g,
  (_, prefix, name, suffix) => `${prefix}${name}?v=${version(name)}${suffix}`));
const manifest = Object.fromEntries(names.map(name => [name,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, name))).digest('hex')]));
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
fs.writeFileSync(path.join(root, 'release/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${names.length} static files. No external runtime dependencies.`);
