// OnlineChess server: serves public/ and hosts online rooms over WebSocket at /ws.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createStaticHandler } from './static.js';
import { createRoomManager } from './rooms.js';
import { parseClientMessage, MAX_MESSAGE_BYTES } from './protocol.js';
import { createTokenBucket, createConnectionCounter } from './rate-limit.js';

const DEFAULT_PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const HEARTBEAT_MS = 30_000;
const GC_MS = 60_000;

function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// Behind the Cloudflare tunnel every connection comes from loopback. Only then, and only when it
// looks like Cloudflare's own headers (a real IP plus a CF-Ray id), is CF-Connecting-IP trusted.
function clientAddress(req) {
  const remote = req.socket.remoteAddress ?? '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const forwarded = req.headers['cf-connecting-ip'];
  const fromCloudflare = typeof forwarded === 'string' && net.isIP(forwarded) && typeof req.headers['cf-ray'] === 'string';
  return loopback && fromCloudflare ? forwarded : remote;
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// Same-origin, and only for hosts this server is meant to be reached on (blocks DNS rebinding).
function originAllowed(req, allowedHosts) {
  const { origin, host } = req.headers;
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.host === host && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

// allowedHosts: hostnames allowed to open the socket besides localhost (ALLOWED_HOSTS env, comma separated).
export function createAppServer({
  publicDir = DEFAULT_PUBLIC,
  rooms = {},
  maxConnectionsPerIp = 8,
  rate = {},
  connectRate = { rate: 1, burst: 10 }, // new sockets per second per address
  unboundTimeoutMs = 30_000, // sockets that never create/join/resume are closed
  allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
} = {}) {
  const hosts = new Set([...LOCAL_HOSTS, ...allowedHosts]);
  const serveStatic = createStaticHandler(publicDir);
  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.maxConnections = 2_000;

  const manager = createRoomManager(rooms);
  const connections = createConnectionCounter(maxConnectionsPerIp);
  const attempts = new Map(); // address -> token bucket for new connections
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (req.url.split('?')[0] !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
    if (!originAllowed(req, hosts)) return rejectUpgrade(socket, 403, 'Forbidden');
    const address = clientAddress(req);
    if (!attempts.has(address)) attempts.set(address, createTokenBucket(connectRate));
    if (!attempts.get(address).take()) return rejectUpgrade(socket, 429, 'Too Many Requests');
    if (!connections.tryAcquire(address)) return rejectUpgrade(socket, 429, 'Too Many Requests');
    // Release the slot whenever this socket closes — including handshakes that never complete.
    socket.once('close', () => connections.release(address));
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, address));
  });

  wss.on('connection', (ws, address) => {
    const bucket = createTokenBucket(rate);
    const conn = {
      send: (message) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); },
      close: (code, reason) => ws.close(code, reason),
    };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const unbound = setTimeout(() => { if (!manager.isBound(conn)) ws.close(4001, 'idle'); }, unboundTimeoutMs);
    ws.on('message', (data, isBinary) => {
      if (!bucket.take()) return ws.close(1008, 'rate limit');
      if (isBinary) return conn.send({ type: 'error', code: 'bad_message' });
      const parsed = parseClientMessage(data);
      if (!parsed.ok) return conn.send({ type: 'error', code: parsed.code });
      try {
        manager.handle(conn, parsed.msg, { address });
      } catch (err) {
        console.error('room handler failed:', err);
        conn.send({ type: 'error', code: 'server_error' });
      }
      return undefined;
    });
    ws.on('close', () => {
      clearTimeout(unbound);
      manager.disconnect(conn);
    });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  const gc = setInterval(() => {
    manager.gc();
    attempts.clear(); // buckets refill within seconds; dropping them bounds memory
  }, GC_MS);
  heartbeat.unref();
  gc.unref();

  return {
    http: server,
    rooms: manager,
    close() {
      clearInterval(heartbeat);
      clearInterval(gc);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 3200, not 3000: other local apps (e.g. OnlineTambola) already use 3000, and on macOS a
  // 127.0.0.1 listener silently shadows a wildcard listener on the same port.
  const port = Number(process.env.PORT) || 3200;
  const host = process.env.HOST || '127.0.0.1';
  // Abuse limits can be raised for test runs, where every browser shares one address.
  const intEnv = (name, fallback) => {
    const v = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const app = createAppServer({
    rooms: { maxRoomsPerAddress: intEnv('ROOMS_PER_ADDRESS', 5), createsPerHour: intEnv('ROOM_CREATES_PER_HOUR', 20) },
    connectRate: { rate: 1, burst: intEnv('WS_CONNECT_BURST', 10) },
    maxConnectionsPerIp: intEnv('WS_CONNECTIONS_PER_ADDRESS', 8),
  });
  app.http.listen(port, host, () => {
    const { port: actual } = app.http.address();
    console.log(`OnlineChess running at http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`);
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
