// Challenges between friends: ask, answer, and both players land in the same game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { CHALLENGE_TTL_MS } from '../../server/friend-challenges.js';

let app, base, db;
test.before(async () => {
  db = openDatabase(':memory:');
  app = createAppServer({ usernameSignup: true, db, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 }, connectRate: { rate: 1000, burst: 1000 }, maxConnectionsPerIp: 100 });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

const PW = 'correct horse battery';


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


// Takes a reserved seat over the game socket (/ws). -> the 'joined' message
function takeSeat(game) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { Origin: base } });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'resume', room: game.room, token: game.token })));
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'joined') { resolve({ ...m, ws }); } if (m.type === 'error') reject(new Error(m.code)); });
  });
}

test('challenge a friend: they get it live, accept, and both are seated in the same game', async () => {
  const ana = await player('chana');
  const ben = await player('chben');
  await befriend(ana, ben);
  const b = live({ cookie: ben.cookie });
  await b.next('hello');
  const a = live({ cookie: ana.cookie });
  await a.next('hello');

  const sent = await call('POST', '/api/challenges', { cookie: ana.cookie, body: { code: ben.code, tc: '5+0', color: 'w' } });
  assert.equal(sent.status, 200);
  const notice = await b.next('notice', (m) => m.kind === 'challenge');
  assert.equal(notice.challenge.with.username, 'chana');
  assert.equal(notice.challenge.tc, '5+0');
  assert.ok(notice.challenge.expiresAt > Date.now() + CHALLENGE_TTL_MS - 5000);
  assert.deepEqual((await call('GET', '/api/challenges', { cookie: ben.cookie })).json.incoming.map((c) => c.id), [notice.challenge.id]);
  assert.equal((await call('POST', '/api/challenges', { cookie: ana.cookie, body: { code: ben.code } })).status, 409, 'one open challenge per pair');

  const yes = await call('POST', '/api/challenges/answer', { cookie: ben.cookie, body: { id: notice.challenge.id, accept: true } });
  assert.equal(yes.status, 200);
  const forAna = (await a.next('notice', (m) => m.kind === 'game-ready')).challenge.game;
  const forBen = (await b.next('notice', (m) => m.kind === 'game-ready')).challenge.game;
  assert.equal(forAna.room, forBen.room);
  assert.deepEqual([forAna.color, forBen.color], ['w', 'b'], 'the challenger chose white');
  assert.deepEqual((await call('GET', '/api/challenges', { cookie: ana.cookie })).json.ready[0].game, forAna, 'listed for a challenger who was away');
  const seatA = await takeSeat(forAna);
  const seatB = await takeSeat(forBen);
  assert.deepEqual([seatA.color, seatB.color], ['w', 'b']);
  seatA.ws.close();
  seatB.ws.close();
  a.close();
  b.close();
});

test('decline and cancel; only friends; answers only from the one challenged', async () => {
  const cal = await player('chcal');
  const dee = await player('chdee');
  const eve = await player('cheve');
  await befriend(cal, dee);
  assert.equal((await call('POST', '/api/challenges', { cookie: cal.cookie, body: { code: eve.code } })).status, 404, 'not friends');
  assert.equal((await call('POST', '/api/challenges', { cookie: cal.cookie, body: { code: dee.code, tc: 'bogus' } })).status, 400);
  const c = live({ cookie: cal.cookie });
  await c.next('hello');
  const one = (await call('POST', '/api/challenges', { cookie: cal.cookie, body: { code: dee.code } })).json.challenge;
  assert.equal((await call('POST', '/api/challenges/answer', { cookie: cal.cookie, body: { id: one.id, accept: true } })).status, 404, 'the challenger cannot accept their own');
  assert.equal((await call('POST', '/api/challenges/answer', { cookie: eve.cookie, body: { id: one.id, accept: true } })).status, 404);
  await call('POST', '/api/challenges/answer', { cookie: dee.cookie, body: { id: one.id, accept: false } });
  assert.equal((await c.next('notice', (m) => m.kind === 'challenge-declined')).with.username, 'chdee');
  const two = (await call('POST', '/api/challenges', { cookie: cal.cookie, body: { code: dee.code } })).json.challenge;
  assert.equal((await call('POST', '/api/challenges/cancel', { cookie: dee.cookie, body: { id: two.id } })).status, 404, 'only the challenger cancels');
  assert.equal((await call('POST', '/api/challenges/cancel', { cookie: cal.cookie, body: { id: two.id } })).status, 200);
  assert.deepEqual((await call('GET', '/api/challenges', { cookie: dee.cookie })).json.incoming, []);
  c.close();
});

test('removing a friend withdraws open challenges', async () => {
  const fay = await player('chfay');
  const gus = await player('chgus');
  await befriend(fay, gus);
  await call('POST', '/api/challenges', { cookie: fay.cookie, body: { code: gus.code } });
  await call('POST', '/api/friends/remove', { cookie: gus.cookie, body: { code: fay.code } });
  assert.deepEqual((await call('GET', '/api/challenges', { cookie: gus.cookie })).json.incoming, []);
});

test('a challenge to a friend who is away is emailed (once they have an email and want it)', async () => {
  const { createMailer } = await import('../../server/mail.js');
  const mdb = openDatabase(':memory:');
  const mailer = createMailer({ mode: 'dry' });
  const mapp = createAppServer({ usernameSignup: true, db: mdb, mailer, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 }, publicOrigin: 'https://chess.example' });
  await new Promise((r) => mapp.http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${mapp.http.address().port}`;
  const req = async (path, body, cookie) => (await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const reg = async (name) => {
    const r = await fetch(`${url}/api/register`, { method: 'POST', headers: { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'correct horse battery' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return { cookie, code: (await req('/api/friends', null, cookie)).code };
  };
  try {
    const ann = await reg('mailann');
    const bob = await reg('mailbob');
    await req('/api/friends/request', { code: bob.code }, ann.cookie);
    await req('/api/friends/accept', { code: ann.code }, bob.cookie);
    mdb.q.setEmail.run('bob@example.com', Date.now(), mdb.q.userByName.get('mailbob').id);
    await req('/api/challenges', { code: bob.code, tc: '5+0' }, ann.cookie);
    await new Promise((r) => setImmediate(r));
    const mail = mailer.outbox.at(-1);
    assert.equal(mail.to, 'bob@example.com');
    assert.equal(mail.subject, 'mailann challenged you to a game of chess');
    assert.match(mail.text, /5 min/);
    assert.match(mail.text, /https:\/\/chess\.example\/#\/friends/);

    // Bob turns these emails off: no more.
    await req('/api/account/presence', { emails: false }, bob.cookie);
    const ch = await req('/api/challenges', null, bob.cookie);
    await req('/api/challenges/answer', { id: ch.incoming[0].id, accept: false }, bob.cookie);
    await req('/api/challenges', { code: bob.code }, ann.cookie);
    await new Promise((r) => setImmediate(r));
    assert.equal(mailer.outbox.length, 1);
  } finally {
    await mapp.close();
  }
});

test('at most three accepted games waiting per player; deleting an account withdraws its challenges', async () => {
  const hub = await player('chhub');
  const pals = [];
  for (let i = 0; i < 4; i++) { const p = await player(`chpal${i}`); await befriend(hub, p); pals.push(p); }
  for (const p of pals.slice(0, 3)) {
    const c = (await call('POST', '/api/challenges', { cookie: hub.cookie, body: { code: p.code } })).json.challenge;
    assert.equal((await call('POST', '/api/challenges/answer', { cookie: p.cookie, body: { id: c.id, accept: true } })).status, 200);
  }
  assert.equal((await call('POST', '/api/challenges', { cookie: hub.cookie, body: { code: pals[3].code } })).status, 429);

  const leaver = await player('chleaver');
  const stayer = await player('chstayer');
  await befriend(leaver, stayer);
  await call('POST', '/api/challenges', { cookie: leaver.cookie, body: { code: stayer.code } });
  assert.equal((await call('POST', '/api/account/delete', { cookie: leaver.cookie, body: { password: PW } })).status, 200);
  assert.deepEqual((await call('GET', '/api/challenges', { cookie: stayer.cookie })).json.incoming, []);
});
