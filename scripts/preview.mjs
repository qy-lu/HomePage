import './build.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const lan = process.argv.includes('--lan');
const portIndex = process.argv.indexOf('--port');
const port = portIndex === -1 ? 8080 : Number(process.argv[portIndex + 1]);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__review') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(fs.readFileSync(new URL('./review.html', import.meta.url)));
      return;
    }
    const file = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Local: http://localhost:${port}/`);
  console.log(`Review: http://localhost:${port}/__review`);
  if (lan) {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) console.log(`LAN: http://${address.address}:${port}/`);
      }
    }
  }
  console.log('Local review only. No production deployment is performed.');
});
