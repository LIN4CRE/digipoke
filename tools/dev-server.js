/**
 * dev-server.js — Zero-dependency static file server for the DigiPoke PWA.
 *
 *   node tools/dev-server.js [port]
 *
 * Why not `npx serve`? A tiny in-repo server keeps the project installable
 * offline, sets the correct MIME types (including .webmanifest), disables
 * caching during development, and binds 0.0.0.0 so it works inside containers
 * and remote sandboxes.
 *
 * @module tools/dev-server
 */

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'apps', 'web');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

/** MIME map — .webmanifest and .svg are the two that trip up naive servers. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Resolve a URL path to a file inside ROOT, blocking traversal.
 * @returns {Promise<string|null>}
 */
async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = path.normalize(path.join(ROOT, decoded));
  if (!candidate.startsWith(ROOT)) return null; // path traversal guard
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      const index = path.join(candidate, 'index.html');
      await fs.access(index);
      return index;
    }
    return candidate;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();

  // /single serves the self-contained one-file build (see tools/build-single.mjs)
  // so it can be downloaded straight from the running server.
  if (req.url.split('?')[0].replace(/\/$/, '') === '/single') {
    const single = path.join(ROOT, '..', '..', 'dist', 'digipoke.html');
    try {
      await fs.access(single);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="digipoke.html"',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(single).pipe(res);
      console.log(`200 /single → dist/digipoke.html`);
      return;
    } catch (err) {
      console.log(`/single: cannot read ${single} (${err.code || err.message})`);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found — run `npm run build:single` first.');
      return;
    }
  }

  let target = await resolveFile(req.url === '/' ? '/index.html' : req.url);

  // SPA fallback: unknown paths return the shell, which owns client routing.
  if (!target && !path.extname(req.url.split('?')[0])) {
    target = await resolveFile('/index.html');
  }

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    console.log(`404 ${req.url}`);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // Development: never cache, so a reload always shows the latest code.
    'Cache-Control': 'no-store, must-revalidate',
    // Allow the PWA/service worker to be registered over the preview origin.
    'Service-Worker-Allowed': '/',
    'X-Content-Type-Options': 'nosniff',
  });

  const stream = createReadStream(target);
  stream.pipe(res);
  stream.on('close', () => {
    console.log(`${res.statusCode} ${req.url} (${Date.now() - started}ms)`);
  });
  stream.on('error', () => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`DigiPoke PWA serving ${ROOT}`);
  console.log(`  Local:   http://localhost:${PORT}/`);
  console.log(`  Network: http://0.0.0.0:${PORT}/ (bind: ${HOST})`);
});
