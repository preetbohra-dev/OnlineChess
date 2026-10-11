// OnlineChess server: serves public/, hosts online rooms over WebSocket at /ws, and (with a
// database) accounts and cloud sync under /api/.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import { createStaticHandler, SECURITY_HEADERS } from './static.js';
import { createApi } from './api.js';
import { createAccounts } from './auth.js';
import { openDatabase, DEFAULT_DB_PATH } from './db.js';
import { startReminders } from './push.js';
import { createRoomManager } from './rooms.js';
import { parseClientMessage, MAX_MESSAGE_BYTES } from './protocol.js';
import { createTokenBucket, createConnectionCounter } from './rate-limit.js';

// A daily snapshot of the accounts database (VACUUM INTO), keeping the newest seven.
function scheduleBackups(db, dir, keep = 7) {
  const run = () => {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);
      const file = path.join(dir, `chess-${new Date().toISOString().slice(0, 10)}.db`);
      if (!fs.existsSync(file)) db.backup(file);
      const old = fs.readdirSync(dir).filter((f) => /^chess-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
      for (const f of old) fs.rmSync(path.join(dir, f));
    } catch (err) {
      console.error('Database backup failed:', err.message);
    }
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref(); // checks four times a day; writes once per day
}

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
  db = null, // accounts database (server/db.js); without it /api/ answers 503
  authRate,
  syncRate,
  push = null, // { publicKey } when daily reminders are running
} = {}) {
  const hosts = new Set([...LOCAL_HOSTS, ...allowedHosts]);
  const serveStatic = createStaticHandler(publicDir);
  const accounts = db ? createAccounts(db) : null;
  const api = createApi({ db, accounts, originAllowed: (req) => originAllowed(req, hosts), clientAddress, ...(authRate ? { authRate } : {}), ...(syncRate ? { syncRate } : {}), push });
  const fail = (res) => { if (!res.headersSent) res.writeHead(500); res.end(); };
  const server = http.createServer((req, res) => {
    const pathname = req.url.split(/[?#]/)[0];
    if (pathname.startsWith('/api/')) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      api(req, res, pathname).catch(() => fail(res));
      return;
    }
    serveStatic(req, res).catch(() => fail(res));
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
    accounts?.pruneSessions();
  }, GC_MS);
  heartbeat.unref();
  gc.unref();

  return {
    http: server,
    rooms: manager,
    accounts,
    serviceWorker: serveStatic.serviceWorker,
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
  // Accounts live in SQLite outside the repository; DB_PATH=off runs without them.
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  const db = dbPath === 'off' ? null : openDatabase(dbPath);
  if (db && dbPath !== ':memory:') scheduleBackups(db, path.join(path.dirname(dbPath), 'backups'));
  // Daily reminders need accounts (to know whether today's puzzle is solved). PUSH=off disables them.
  const firstHost = (process.env.ALLOWED_HOSTS ?? '').split(',').map((x) => x.trim()).find(Boolean);
  const reminders = db && process.env.PUSH !== 'off'
    ? startReminders(db, { subject: process.env.VAPID_SUBJECT || (firstHost ? `https://${firstHost}` : 'mailto:onlinechess@localhost'), dryRun: process.env.PUSH === 'dry' })
    : null;
  const app = createAppServer({
    db,
    push: reminders ? { publicKey: reminders.publicKey } : null,
    rooms: { maxRoomsPerAddress: intEnv('ROOMS_PER_ADDRESS', 5), createsPerHour: intEnv('ROOM_CREATES_PER_HOUR', 20) },
    connectRate: { rate: 1, burst: intEnv('WS_CONNECT_BURST', 10) },
    maxConnectionsPerIp: intEnv('WS_CONNECTIONS_PER_ADDRESS', 8),
  });
  app.http.listen(port, host, () => {
    const { port: actual } = app.http.address();
    console.log(`OnlineChess running at http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}`);
    console.log(`Offline app version ${app.serviceWorker.version} (${app.serviceWorker.files} files). Restart after deploying new files.`);
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
