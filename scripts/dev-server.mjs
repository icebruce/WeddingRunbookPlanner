import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import login from '../api/login.js';
import logout from '../api/logout.js';
import session from '../api/session.js';
import plan from '../api/plan.js';
import versions from '../api/versions.js';
import exportPlan from '../api/export.js';
import template from '../api/template.js';
import share from '../api/share.js';
import shared from '../api/shared.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only this directory is ever served. Server code, tests and package metadata
// live outside it and are therefore unreachable over HTTP (F8), matching the
// `outputDirectory: "public"` setting Vercel uses in production.
const publicRoot = path.join(root, 'public');
const port = Number(process.env.PORT || 4173);

const apiRoutes = new Map([
  ['/api/login', login],
  ['/api/logout', logout],
  ['/api/session', session],
  ['/api/plan', plan],
  ['/api/versions', versions],
  ['/api/export', exportPlan],
  ['/api/template', template],
  ['/api/share', share],
  ['/api/shared', shared]
]);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

async function readStatic(pathname) {
  // `cleanUrls` in production also resolves /foo to /foo.html.
  const candidates = pathname.endsWith('/')
    ? [path.join(pathname, 'index.html')]
    : [pathname, `${pathname}.html`];
  for (const candidate of candidates) {
    const filePath = path.resolve(publicRoot, `.${candidate}`);
    if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) continue;
    try {
      const data = await fs.readFile(filePath);
      return { filePath, data };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const handler = apiRoutes.get(url.pathname);
    if (handler) return void await handler(req, res);

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = await readStatic(pathname);
    if (!file) return notFound(res);

    res.setHeader('Content-Type', mime.get(path.extname(file.filePath)) || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.end(file.data);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
});

// PORT=0 lets the OS pick a free port; the real one is printed so callers
// (the e2e harness) can read it back instead of guessing.
server.listen(port, '127.0.0.1', () => console.log(`Wedding planner running at http://127.0.0.1:${server.address().port}`));
