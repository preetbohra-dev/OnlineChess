import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { emptyProfile } from '../../public/js/core/progression.js';

let app, base, db;
test.before(async () => {
  db = openDatabase(':memory:');
  app = createAppServer({ db, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 } });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

const PW = 'correct horse battery';
async function call(method, path, { body, cookie, origin = base, csrf = true, type = 'application/json', raw } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (csrf) headers['X-OC-Request'] = '1';
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = type;
  const res = await fetch(base + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? null };
}

test('register, me, log out, log in', async () => {
  const r = await call('POST', '/api/register', { body: { username: 'erin', password: PW } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { user: { username: 'erin' } });
  assert.match(r.headers.get('set-cookie'), /^oc_session=[\w-]{40,}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(r.headers.get('content-security-policy'));
  assert.deepEqual((await call('GET', '/api/me', { cookie: r.cookie })).json, { user: { username: 'erin' } });
  const out = await call('POST', '/api/logout', { cookie: r.cookie });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual((await call('GET', '/api/me', { cookie: r.cookie })).json, { user: null });
  const back = await call('POST', '/api/login', { body: { username: 'ERIN', password: PW } });
  assert.equal(back.status, 200);
  assert.equal((await call('POST', '/api/login', { body: { username: 'erin', password: 'nope nope nope' } })).status, 401);
});

test('writes need the same origin and the X-OC-Request header', async () => {
  assert.equal((await call('POST', '/api/register', { body: { username: 'frank', password: PW }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/register', { body: { username: 'frank', password: PW }, origin: null })).status, 403);
  assert.equal((await call('POST', '/api/register', { body: { username: 'frank', password: PW }, csrf: false })).status, 403);
});

test('bodies must be small JSON', async () => {
  assert.equal((await call('POST', '/api/login', { raw: 'username=a', type: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await call('POST', '/api/login', { raw: '{bad json' })).status, 400);
  assert.equal((await call('POST', '/api/login', { raw: JSON.stringify({ username: 'x', password: 'y'.repeat(5000) }) })).status, 413);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  assert.equal((await call('DELETE', '/api/me')).status, 404);
});

test('state sync: needs a session, merges what each device sends, never trusts junk', async () => {
  const r = await call('POST', '/api/register', { body: { username: 'grace', password: PW } });
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('PUT', '/api/state', { body: { state: {} } })).status, 401);
  const empty = await call('GET', '/api/state', { cookie: r.cookie });
  assert.deepEqual(empty.json, { state: null, updatedAt: null });
  const one = await call('PUT', '/api/state', { cookie: r.cookie, body: { state: { profile: { ...emptyProfile(), xp: 120 }, 'lessons.completed': ['novice-board'] } } });
  assert.equal(one.status, 200);
  const two = await call('PUT', '/api/state', { cookie: r.cookie, body: { state: { profile: { ...emptyProfile(), xp: 50, achievements: { bogus: 'x' } }, 'lessons.completed': ['novice-pieces'], evil: 1 } } });
  assert.equal(two.json.state.profile.xp, 120);
  assert.deepEqual(two.json.state['lessons.completed'].sort(), ['novice-board', 'novice-pieces']);
  assert.deepEqual(two.json.state.profile.achievements, {});
  assert.equal(Object.hasOwn(two.json.state, 'evil'), false);
  const got = await call('GET', '/api/state', { cookie: r.cookie });
  assert.equal(got.json.state.profile.xp, 120);
  // Another account sees nothing of it.
  const other = await call('POST', '/api/register', { body: { username: 'heidi', password: PW } });
  assert.equal((await call('GET', '/api/state', { cookie: other.cookie })).json.state, null);
});

test('sign-in attempts are rate-limited per address', async () => {
  const limited = createAppServer({ db: openDatabase(':memory:'), authRate: { rate: 0.001, burst: 3 } });
  await new Promise((r) => limited.http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${limited.http.address().port}`;
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${url}/api/login`, { method: 'POST', headers: { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: '{"username":"x","password":"y"}' });
    statuses.push(res.status);
  }
  await limited.close();
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
});

test('state uploads are rate-limited per account', async () => {
  const limited = createAppServer({ db: openDatabase(':memory:'), authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 0.001, burst: 2 } });
  await new Promise((r) => limited.http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${limited.http.address().port}`;
  const headers = { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json' };
  const reg = await fetch(`${url}/api/register`, { method: 'POST', headers, body: JSON.stringify({ username: 'judy', password: PW }) });
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await fetch(`${url}/api/state`, { method: 'PUT', headers: { ...headers, Cookie: cookie }, body: '{"state":{}}' })).status);
  await limited.close();
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('without a database the API says so', async () => {
  const bare = createAppServer();
  await new Promise((r) => bare.http.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${bare.http.address().port}/api/me`);
  await bare.close();
  assert.equal(res.status, 503);
});
