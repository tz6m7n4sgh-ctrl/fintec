/**
 * Minimal static file server for the exported site.
 *
 * The app is a static export, so `next start` does not apply — the end-to-end
 * tests need something that serves `out/` the way a static host does. This is
 * deliberately dependency-free: adding a server package to devDependencies to
 * serve ten HTML files would be more supply chain than the job needs.
 *
 * It mirrors GitHub Pages behaviour in the two ways that matter:
 *   - the site can be mounted under a sub-path (BASE_PATH), as a project site is
 *   - a directory request resolves to its index.html, with no extension rewriting
 *
 * Usage:  PORT=3210 BASE_PATH=/fintec node scripts/serve-out.mjs
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'out');
const PORT = Number(process.env.PORT ?? 3210);
const BASE_PATH = process.env.BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

if (!existsSync(ROOT)) {
  console.error(`No export found at ${ROOT}. Run \`npm run build\` first.`);
  process.exit(1);
}

/** Maps a request path to a file inside out/, or null if it escapes the root. */
function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);

  if (BASE_PATH) {
    if (p === BASE_PATH) p = '/';
    else if (p.startsWith(`${BASE_PATH}/`)) p = p.slice(BASE_PATH.length);
    else return null; // outside the mount — a real host would 404 too
  }

  // Contain the path: normalize then reject anything climbing out of out/.
  const candidate = resolve(join(ROOT, normalize(p)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + '/')) return null;

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const index = join(candidate, 'index.html');
    return existsSync(index) ? index : null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;

  // Extensionless request → try the directory index, as Pages does.
  const asIndex = join(candidate, 'index.html');
  if (existsSync(asIndex)) return asIndex;

  const asHtml = `${candidate}.html`;
  if (existsSync(asHtml)) return asHtml;

  return null;
}

const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');

  if (!file) {
    const notFound = join(ROOT, '404', 'index.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    if (existsSync(notFound)) createReadStream(notFound).pipe(res);
    else res.end('404');
    return;
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}${BASE_PATH || '/'}`);
});
