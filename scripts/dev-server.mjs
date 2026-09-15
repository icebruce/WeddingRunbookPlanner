import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import login from '../api/login.js';
import logout from '../api/logout.js';
import session from '../api/session.js';
import plan from '../api/plan.js';
import versions from '../api/versions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);

const apiRoutes = new Map([
  ['/api/login', login],
  ['/api/logout', logout],
  ['/api/session', session],
  ['/api/plan', plan],
  ['/api/versions', versions]
]);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const handler = apiRoutes.get(url.pathname);
    if (handler) return void await handler(req, res);

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(root) || filePath.includes(`${path.sep}api${path.sep}`) || filePath.includes(`${path.sep}lib${path.sep}`) || filePath.includes(`${path.sep}tests${path.sep}`)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const data = await fs.readFile(filePath);
    res.setHeader('Content-Type', mime.get(path.extname(filePath)) || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404); res.end('Not found'); return;
    }
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Wedding planner running at http://127.0.0.1:${port}`));
