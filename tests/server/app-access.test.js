// The iPhone and Android apps load their pages from the app itself (capacitor://localhost on iOS,
// https://localhost on Android) and call the API across origins with a bearer token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { emptyProfile } from '../../public/js/core/progression.js';

const IOS = 'capacitor://localhost';
const ANDROID = 'https://localhost';
const PW = 'correct horse battery';
let app, base, db;
test.before(async () => {
  db = openDatabase(':memory:');
  app = createAppServer({ db, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 } });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

async function call(method, path, { origin = IOS, body, token, app: isApp = true, csrf = true, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (csrf) h['X-OC-Request'] = '1';
  if (isApp) h['X-OC-Client'] = 'app';
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

test('preflight: only the two app origins, no credentials, the headers the app sends', async () => {
  for (const origin of [IOS, ANDROID]) {
    const r = await fetch(`${base}/api/login`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-oc-request,x-oc-client' } });
    assert.equal(r.status, 204, origin);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
    assert.match(r.headers.get('access-control-allow-methods'), /PUT/);
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
    assert.match(r.headers.get('vary'), /Origin/);
  }
  const evil = await fetch(`${base}/api/login`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('an app signs up and in with a token in the body, never a cookie', async () => {
  const reg = await call('POST', '/api/register', { body: { username: 'appuser', password: PW } });
  assert.equal(reg.status, 201);
  assert.equal(reg.headers.get('set-cookie'), null);
  assert.equal(reg.headers.get('access-control-allow-origin'), IOS);
  assert.equal(reg.json.user.username, 'appuser');
  assert.match(reg.json.token, /^[\w-]{40,}$/);

  const login = await call('POST', '/api/login', { origin: ANDROID, body: { username: 'appuser', password: PW } });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('set-cookie'), null);
  assert.notEqual(login.json.token, reg.json.token);

  assert.deepEqual((await call('GET', '/api/me', { token: login.json.token })).json, { user: { username: 'appuser' } });
  assert.deepEqual((await call('GET', '/api/me')).json, { user: null });
  assert.deepEqual((await call('GET', '/api/me', { token: 'x'.repeat(43) })).json, { user: null });
  for (const bad of ['short', `${login.json.token}!`, 'x'.repeat(101)]) {
    assert.deepEqual((await call('GET', '/api/me', { token: bad })).json, { user: null }, bad);
  }
});

test('the website still gets a cookie and no token; app pages never use a cookie', async () => {
  const r = await call('POST', '/api/register', { origin: base, app: false, body: { username: 'webuser', password: PW } });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /^oc_session=/);
  assert.equal(r.json.token, undefined);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await call('GET', '/api/me', { origin: base, app: false, headers: { Cookie: cookie } })).json, { user: { username: 'webuser' } });
  assert.deepEqual((await call('GET', '/api/me', { origin: IOS, headers: { Cookie: cookie } })).json, { user: null });
});

test('app writes need the app origin and X-OC-Request; tokens work for sync, logout ends them', async () => {
  const { token } = (await call('POST', '/api/register', { body: { username: 'syncapp', password: PW } })).json;
  const state = { state: { profile: emptyProfile() } };
  assert.equal((await call('PUT', '/api/state', { token, body: state })).status, 200);
  assert.equal((await call('PUT', '/api/state', { token, body: state, csrf: false })).status, 403);
  assert.equal((await call('PUT', '/api/state', { token, body: state, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('PUT', '/api/state', { token, body: state, origin: null })).status, 403);

  assert.equal((await call('POST', '/api/logout', { token, body: {} })).status, 200);
  assert.deepEqual((await call('GET', '/api/me', { token })).json, { user: null });
  assert.equal((await call('PUT', '/api/state', { token, body: state })).status, 401);
});

test('online play accepts the app origins', async () => {
  const open = (origin) => new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { Origin: origin } });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
  assert.equal(await open(IOS), 'open');
  assert.equal(await open(ANDROID), 'open');
  assert.equal(await open('https://evil.example'), 403);
});
