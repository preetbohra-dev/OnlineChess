// Static file handler: serves only regular files inside publicDir, GET/HEAD only,
// with strict security headers. Rejects traversal, dotfiles, NUL bytes and backslashes.
import fs from 'node:fs';
import path from 'node:path';
import { buildServiceWorker } from './service-worker.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function reply(res, status, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders });
  res.end(status === 404 ? 'Not found' : status === 400 ? 'Bad request' : '');
}

export function createStaticHandler(publicDir) {
  const root = fs.realpathSync(publicDir);
  const inside = (p) => p.startsWith(root + path.sep);
  // The service worker is generated once at start-up from the files being served.
  // (Restart the server to publish changed files to installed apps: the version is fixed here.)
  const serviceWorker = buildServiceWorker(root);

  async function handleStatic(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { Allow: 'GET, HEAD' });

    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split(/[?#]/)[0]);
    } catch {
      return reply(res, 400);
    }
    if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\')) return reply(res, 400);
    if (pathname.split('/').some((segment) => segment.startsWith('.'))) return reply(res, 404);

    if (pathname === '/sw.js') {
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Content-Length': Buffer.byteLength(serviceWorker.body), 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : serviceWorker.body);
    }

    const requested = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!inside(requested)) return reply(res, 404);

    let real, stat;
    try {
      real = await fs.promises.realpath(requested);
      stat = await fs.promises.stat(real);
    } catch {
      return reply(res, 404);
    }
    if (!inside(real) || !stat.isFile()) return reply(res, 404);

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  }
  handleStatic.serviceWorker = { version: serviceWorker.version, files: serviceWorker.assets.length };
  return handleStatic;
}
