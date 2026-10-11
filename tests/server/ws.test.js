// End-to-end over real WebSockets against the real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createAppServer } from '../../server/index.js';

let app;
let base;
test.before(async () => {
  app = createAppServer({ maxConnectionsPerIp: 6, rate: { rate: 20, burst: 30 }, connectRate: { rate: 100, burst: 100 }, unboundTimeoutMs: 400 });
  await new Promise((resolve) => app.http.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${app.http.address().port}`;
});
test.after(() => app.close());

function client({ origin = `http://${base}`, path = '/ws', host } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (host) headers.Host = host;
  const ws = new WebSocket(`ws://${base}${path}`, { headers });
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    inbox.push(msg);
    for (const w of [...waiters]) if (w.match(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  const api = {
    ws,
    inbox,
    open: () => new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('unexpected-response', (_, res) => reject(new Error(String(res.statusCode)))); }),
    send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    next: (match) => {
      const found = inbox.find(match);
      if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
      return new Promise((resolve) => waiters.push({ match: (m) => { if (match(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, resolve }));
    },
    close: () => ws.close(),
  };
  return api;
}
const type = (t, extra = () => true) => (m) => m.type === t && extra(m);

async function pair() {
  const host = client();
  const guest = client();
  await Promise.all([host.open(), guest.open()]);
  host.send({ type: 'create', name: 'Ann', tc: 'none', color: 'w' });
  const { room } = await host.next(type('joined'));
  guest.send({ type: 'join', room, name: 'Bob' });
  await guest.next(type('joined'));
  await host.next(type('state', (s) => s.players.b));
  return { host, guest, room };
}

test('two players play a full game to checkmate', async () => {
  const { host, guest } = await pair();
  const moves = [[host, 'f2', 'f3'], [guest, 'e7', 'e5'], [host, 'g2', 'g4'], [guest, 'd8', 'h4']];
  for (let ply = 0; ply < moves.length; ply++) {
    const [c, from, to] = moves[ply];
    c.send({ type: 'move', from, to, ply });
    await host.next(type('state', (s) => s.ply === ply + 1));
  }
  const final = await guest.next(type('state', (s) => s.status.over));
  assert.equal(final.status.reason, 'checkmate');
  assert.equal(final.status.winner, 'b');
  host.close();
  guest.close();
});

test('malformed, oversized and illegal input is rejected without hurting the server', async () => {
  const { host, guest } = await pair();
  host.send('not json');
  assert.equal((await host.next(type('error'))).code, 'bad_json');
  host.send({ type: 'move', from: 'e2', to: 'e9', ply: 0 });
  assert.equal((await host.next(type('error'))).code, 'invalid_field');
  host.send({ type: 'move', from: 'e2', to: 'e5', ply: 0 });
  assert.equal((await host.next(type('error'))).code, 'illegal_move');
  guest.send({ type: 'move', from: 'e7', to: 'e5', ply: 0 });
  assert.equal((await guest.next(type('error'))).code, 'not_your_turn');
  const closed = new Promise((resolve) => guest.ws.once('close', (code) => resolve(code)));
  guest.send(JSON.stringify({ type: 'resign', pad: 'x'.repeat(10_000) }));
  assert.equal(await closed, 1009, 'oversized frames close the socket');
  host.send({ type: 'move', from: 'e2', to: 'e4', ply: 0 });
  assert.equal((await host.next(type('state', (s) => s.ply === 1))).ply, 1, 'server still healthy');
  host.close();
});

test('cross-origin and wrong-path upgrades are refused', async () => {
  await assert.rejects(client({ origin: 'https://evil.example' }).open(), /403/);
  await assert.rejects(client({ origin: null }).open(), /403/);
  await assert.rejects(client({ path: '/other' }).open(), /404/);
});

test('a flood of messages closes the connection', async () => {
  const c = client();
  await c.open();
  const closed = new Promise((resolve) => c.ws.once('close', (code) => resolve(code)));
  for (let i = 0; i < 100; i++) c.send({ type: 'ping', t: i });
  assert.equal(await closed, 1008);
});

test('too many connections from one address are refused', async () => {
  const sockets = Array.from({ length: 6 }, () => client());
  await Promise.all(sockets.map((s) => s.open()));
  await assert.rejects(client().open(), /429/);
  for (const s of sockets) s.close();
});

test('DNS-rebinding style origins for unknown hosts are refused', async () => {
  const port = base.split(':')[1];
  await assert.rejects(client({ origin: `http://evil.example:${port}`, host: `evil.example:${port}` }).open(), /403/);
});

test('failed handshakes do not leak connection slots', async () => {
  const net = await import('node:net');
  const [hostname, port] = base.split(':');
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => {
      const s = net.connect(Number(port), hostname, () => {
        s.write(`GET /ws HTTP/1.1\r\nHost: ${base}\r\nOrigin: http://${base}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: bad\r\n\r\n`);
      });
      s.on('data', () => s.destroy());
      s.on('close', resolve);
    });
  }
  await new Promise((r) => setTimeout(r, 50));
  const c = client();
  await c.open(); // would be 429 if the 10 broken handshakes had kept their slots
  c.close();
});

test('sockets that never join a room are closed', async () => {
  const c = client();
  await c.open();
  const code = await new Promise((resolve) => c.ws.once('close', resolve));
  assert.equal(code, 4001);
});
