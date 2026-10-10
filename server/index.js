// OnlineChess server: serves public/ (and, from slice 5, online rooms over WebSocket).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStaticHandler } from './static.js';

const DEFAULT_PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createAppServer({ publicDir = DEFAULT_PUBLIC } = {}) {
  const serveStatic = createStaticHandler(publicDir);
  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  return {
    http: server,
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const app = createAppServer();
  app.http.listen(port, host, () => {
    const { port: actual } = app.http.address();
    console.log(`OnlineChess running at http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`);
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
