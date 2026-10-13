// The live channel (/live): signed-in players see their friends come and go, and get notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';

const PW = 'correct horse battery';
let app, base, db;
test.before(async () => {
  db = openDatabase(':memory:');
  app = createAppServer({ usernameSignup: true, db, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 }, connectRate: { rate: 1000, burst: 1000 }, maxConnectionsPerIp: 100 });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

const call = async (method, path, { body, cookie } = {}) => {
  const res = await fetch(base + path, { method, headers: { Origin: base, 'X-OC-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
async function player(name) {
  const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { Origin: base, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: PW }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { name, cookie, token: cookie.split('=')[1], code: (await call('GET', '/api/friends', { cookie })).json.code };
}
async function befriend(a, b) {
  await call('POST', '/api/friends/request', { cookie: a.cookie, body: { code: b.code } });
  await call('POST', '/api/friends/accept', { cookie: b.cookie, body: { code: a.code } });
}

// A live connection that records messages; next(type) waits for the next one of that type.
function live({ cookie, token, origin = base } = {}) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/live`, { headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const i = waiters.findIndex((w) => w.match(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  const opened = new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('unexpected-response', (_q, res) => reject(new Error(String(res.statusCode)))); });
  if (token) opened.then(() => ws.send(JSON.stringify({ type: 'auth', token })));
  const next = (type, pred = () => true, ms = 2000) => {
    const match = (m) => m.type === type && pred(m);
    const i = inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); reject(new Error(`no ${type} within ${ms} ms`)); } }, ms);
    });
  };
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  return { ws, opened, next, closed, send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() };
}

test('a signed-in player gets a hello with their friends\' status; friends see each other come, play and go', async () => {
  const ana = await player('liveana');
  const ben = await player('liveben');
  await befriend(ana, ben);
  const a = live({ cookie: ana.cookie });
  const hello = await a.next('hello');
  assert.deepEqual(hello.you, { username: 'liveana', code: ana.code });
  assert.deepEqual(hello.friends, [{ code: ben.code, online: false, playing: false }]);

  const b = live({ cookie: ben.cookie });
  await b.next('hello');
  assert.deepEqual(await a.next('presence', (m) => m.code === ben.code), { type: 'presence', code: ben.code, online: true, playing: false });
  b.send({ type: 'status', playing: true });
  assert.equal((await a.next('presence', (m) => m.playing)).playing, true);
  b.close();
  assert.equal((await a.next('presence', (m) => !m.online)).online, false);
  a.close();
});

test('the apps sign in with their token as the first message; no session, no channel', async () => {
  const cal = await player('livecal');
  const c = live({ token: cal.token, origin: 'capacitor://localhost' });
  assert.equal((await c.next('hello')).you.username, 'livecal');
  c.close();
  const guest = live({});
  await guest.opened;
  guest.send({ type: 'auth', token: 'x'.repeat(43) });
  assert.equal(await guest.closed, 4401, 'a bad token closes the channel');
  const slow = live({});
  await slow.opened;
  slow.send({ type: 'status', playing: true });
  assert.equal(await slow.closed, 4401, 'anything before signing in closes it');
  await assert.rejects(live({ cookie: cal.cookie, origin: 'https://evil.example' }).opened, /403/);
});

test('hidden players look offline to their friends', async () => {
  const dee = await player('livedee');
  const eli = await player('liveeli');
  await befriend(dee, eli);
  assert.equal((await call('POST', '/api/account/presence', { cookie: eli.cookie, body: { show: false } })).status, 200);
  const d = live({ cookie: dee.cookie });
  await d.next('hello');
  const e = live({ cookie: eli.cookie });
  const eliHello = await e.next('hello');
  assert.equal(eliHello.showPresence, false);
  await assert.rejects(d.next('presence', () => true, 400), /no presence/);
  d.close();
  e.close();
});

test('friend requests and acceptances arrive as notices', async () => {
  const fay = await player('livefay');
  const gil = await player('livegil');
  const f = live({ cookie: fay.cookie });
  await f.next('hello');
  await call('POST', '/api/friends/request', { cookie: gil.cookie, body: { code: fay.code } });
  assert.deepEqual(await f.next('notice'), { type: 'notice', kind: 'friend-request', from: { username: 'livegil', code: gil.code } });
  const g = live({ cookie: gil.cookie });
  await g.next('hello');
  await call('POST', '/api/friends/accept', { cookie: fay.cookie, body: { code: gil.code } });
  assert.deepEqual(await g.next('notice'), { type: 'notice', kind: 'friend-accepted', from: { username: 'livefay', code: fay.code } });
  assert.equal((await g.next('presence', (m) => m.code === fay.code)).online, true, 'new friends see each other at once');
  f.close();
  g.close();
});

test('flooding the channel closes it; a seventh connection waits instead of pushing others out', async () => {
  const hal = await player('livehal');
  const h = live({ cookie: hal.cookie });
  await h.next('hello');
  for (let i = 0; i < 30; i++) h.send({ type: 'status', playing: i % 2 === 0 });
  assert.equal(await h.closed, 1008);

  const conns = [];
  for (let i = 0; i < 6; i++) { const c = live({ cookie: hal.cookie }); await c.next('hello'); conns.push(c); }
  const seventh = live({ cookie: hal.cookie });
  assert.equal(await seventh.closed, 4008);
  for (const c of conns) assert.equal(c.ws.readyState, WebSocket.OPEN, 'nobody was pushed out');
  for (const c of conns) c.close();
});

test('signing out closes the live channel at the next check; removed friends stop seeing each other', async () => {
  const ivy = await player('liveivy');
  const jon = await player('livejon');
  await befriend(ivy, jon);
  const i = live({ cookie: ivy.cookie });
  await i.next('hello');
  const j = live({ cookie: jon.cookie });
  await j.next('hello');
  await i.next('presence', (m) => m.code === jon.code && m.online);
  await call('POST', '/api/friends/remove', { cookie: jon.cookie, body: { code: ivy.code } });
  assert.deepEqual(await i.next('presence', (m) => m.removed), { type: 'presence', code: jon.code, online: false, playing: false, removed: true });

  await call('POST', '/api/logout', { cookie: ivy.cookie, body: {} });
  app.live.recheck();
  assert.equal(await i.closed, 4401);
  j.close();
});

test('a cookie from another site does not sign the channel in', async () => {
  const kim = await player('livekim');
  const k = live({ cookie: kim.cookie, origin: 'capacitor://localhost' }); // app origin: the cookie is ignored
  await k.opened;
  await assert.rejects(k.next('hello', () => true, 400), /no hello/, 'not signed in by the cookie');
  k.send({ type: 'status', playing: true });
  assert.equal(await k.closed, 4401, 'and anything but the token closes it');
});
