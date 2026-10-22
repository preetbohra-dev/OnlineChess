// "Continue with Google" against a stand-in for Google: our own RSA key signs the ID tokens, and
// the token and key endpoints are answered by a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { createMailer } from '../../server/mail.js';
import { verifyIdToken } from '../../server/google-auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims, { key = privateKey, kid = 'k1' } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (nonce, extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1001', email: 'gina@gmail.com', email_verified: true, nonce, iat: now(), exp: now() + 3600, ...extra });

// What the fake Google answers with next (a function of the nonce the flow sent).
let nextToken = (nonce) => idToken(claimsFor(nonce));
let lastNonce = null;
const googleFetch = async (url, init) => {
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') return new Response(JSON.stringify({ keys: [JWK] }), { headers: { 'cache-control': 'public, max-age=3600' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('client_id'), CLIENT_ID);
    assert.equal(form.get('client_secret'), 'secret');
    assert.match(form.get('code_verifier'), /^[\w-]{43,128}$/, 'PKCE verifier sent');
    return new Response(JSON.stringify({ id_token: nextToken(lastNonce) }));
  }
  throw new Error(`unexpected fetch ${url}`);
};

let app, base, db;
test.before(async () => {
  db = openDatabase(':memory:');
  app = createAppServer({ db, mailer: createMailer({ mode: 'dry' }), googleKeys: { clientId: CLIENT_ID, clientSecret: 'secret' }, googleFetch, publicOrigin: 'https://chess.example', authRate: { rate: 1000, burst: 1000 } });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

// Runs the round trip: start -> (Google) -> callback. -> { location, session }
async function viaGoogle({ cookie = '', keepState = true, link = false } = {}) {
  let path = '/auth/google/start';
  if (link) {
    const r = await fetch(`${base}/api/auth/google/link`, { method: 'POST', headers: { Origin: base, 'X-OC-Request': '1', Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    path = (await r.json()).url;
  }
  const start = await fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://chess.example/auth/google/callback');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('scope'), 'openid email profile');
  lastNonce = to.searchParams.get('nonce');
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  assert.match(start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\/auth\/google; Max-Age=600/);
  const back = await fetch(`${base}/auth/google/callback?code=4%2Fabc&state=${to.searchParams.get('state')}`, {
    redirect: 'manual',
    headers: { Cookie: [keepState ? stateCookie : '', cookie].filter(Boolean).join('; ') },
  });
  assert.equal(back.status, 302);
  const session = back.headers.getSetCookie().find((c) => c.startsWith('oc_session='))?.split(';')[0] ?? null;
  return { location: back.headers.get('location'), session };
}
const me = async (cookie) => (await (await fetch(`${base}/api/account`, { headers: { Cookie: cookie } })).json());

test('a new Google account: signed in, the verified email kept, a name to choose', async () => {
  const { location, session } = await viaGoogle();
  assert.equal(location, '/#/welcome?new=1');
  const account = await me(session);
  assert.match(account.username, /^player\d+$/);
  assert.equal(account.email, 'gina@gmail.com');
  assert.equal(account.google, true);
  assert.equal(account.hasPassword, false);
});

test('the same Google account later: the same player, not a new one', async () => {
  const { location, session } = await viaGoogle();
  assert.equal(location, '/#/welcome');
  assert.equal((await me(session)).email, 'gina@gmail.com');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('an existing account with that verified email gets Google linked', async () => {
  db.q.insertEmailUser.run('EmailFirst', '!', Date.now(), 'ed@example.com', Date.now());
  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '2002', email: 'Ed@Example.com' }));
  const { location, session } = await viaGoogle();
  assert.equal(location, '/#/welcome');
  assert.equal((await me(session)).username, 'EmailFirst');
  // An unverified Google email never links to someone's account.
  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '3003', email: 'ed@example.com', email_verified: false }));
  const other = await viaGoogle();
  assert.equal(other.location, '/#/welcome?new=1');
  assert.equal((await me(other.session)).email, null);
});

test('a signed-in player links Google; a Google email that is someone else\'s is refused', async () => {
  db.q.insertUser.run('Linker', '!', Date.now());
  const session = `oc_session=${app.accounts.startSession(db.q.userByName.get('Linker').id)}`;
  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '4004', email: 'linker@gmail.com' }));
  const linked = await viaGoogle({ cookie: session, link: true });
  assert.equal(linked.location, '/#/welcome');
  assert.equal((await me(linked.session)).username, 'Linker');
  assert.equal((await me(linked.session)).email, 'linker@gmail.com', 'takes the Google email when it had none');

  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '5005', email: 'ed@example.com' }));
  const clash = await viaGoogle({ cookie: session, link: true });
  assert.equal(clash.location, '/#/welcome?error=taken');
  assert.equal(clash.session, null);
});

test('the round trip must come back to the same browser, and the token must be genuine', async () => {
  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '6006', email: 'x6@gmail.com' }));
  assert.equal((await viaGoogle({ keepState: false })).location, '/#/welcome?error=browser');
  const { privateKey: other } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '7007' }), { key: other });
  assert.equal((await viaGoogle()).location, '/#/welcome?error=bad');
  nextToken = () => idToken(claimsFor('another-nonce', { sub: '8008' }));
  assert.equal((await viaGoogle()).location, '/#/welcome?error=bad');
  const replay = await fetch(`${base}/auth/google/callback?code=x&state=unknown`, { redirect: 'manual' });
  assert.equal(replay.headers.get('location'), '/#/welcome?error=expired');
});

test('Google says no or fails: a clear reason, nobody signed in', async () => {
  const start = await fetch(`${base}/auth/google/start`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const denied = await fetch(`${base}/auth/google/callback?error=access_denied&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(denied.headers.get('location'), '/#/welcome?error=cancelled');
  assert.equal((await fetch(`${base}/auth/google/callback?code=x&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie } })).headers.get('location'), '/#/welcome?error=expired', 'a state works once');

  nextToken = () => { throw new Error('token endpoint down'); };
  const failing = await viaGoogle().catch(() => null);
  assert.equal(failing?.location, '/#/welcome?error=google');
  const odd = await fetch(`${base}/auth/google/callback?code=x&state=${state}`, { redirect: 'manual', headers: { Cookie: 'oc_google=\u00e9\u00e9' } });
  assert.equal(odd.status, 302, 'a strange cookie is an error page, not a crash');
});

test('linking needs a fresh ticket from the page; a ticket is for one player and one use', async () => {
  const session = `oc_session=${app.accounts.startSession(db.q.userByName.get('Linker').id)}`;
  assert.equal((await fetch(`${base}/auth/google/start?link=1`, { redirect: 'manual', headers: { Cookie: session } })).headers.get('location'), '/#/welcome?error=expired', 'a made-up ticket');
  const r = await fetch(`${base}/api/auth/google/link`, { method: 'POST', headers: { Origin: base, 'X-OC-Request': '1', Cookie: session, 'Content-Type': 'application/json' }, body: '{}' });
  const { url } = await r.json();
  assert.equal((await fetch(`${base}${url}`, { redirect: 'manual' })).headers.get('location'), '/#/welcome?error=expired', 'without the session it was issued to');
  assert.equal((await fetch(`${base}${url}`, { redirect: 'manual', headers: { Cookie: session } })).headers.get('location'), '/#/welcome?error=expired', 'and only once');
  assert.equal((await fetch(`${base}/api/auth/google/link`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-OC-Request': '1', Cookie: session } })).status, 403);
});

test('connecting a Google account that is already another player\'s never switches accounts', async () => {
  db.q.insertUser.run('Third', '!', Date.now());
  const session = `oc_session=${app.accounts.startSession(db.q.userByName.get('Third').id)}`;
  nextToken = (nonce) => idToken(claimsFor(nonce)); // sub 1001: the first test's player
  assert.equal((await viaGoogle({ cookie: session, link: true })).location, '/#/welcome?error=taken');
});

test('a player links only one Google account', async () => {
  const session = `oc_session=${app.accounts.startSession(db.q.userByName.get('Linker').id)}`;
  nextToken = (nonce) => idToken(claimsFor(nonce, { sub: '9009', email: 'second@gmail.com' }));
  assert.equal((await viaGoogle({ cookie: session, link: true })).location, '/#/welcome?error=taken');
});

test('ID token checks: issuer, audience, expiry, nonce, algorithm', () => {
  const keys = [JWK];
  const ok = (claims, opts = {}) => verifyIdToken(idToken(claims), { keys, clientId: CLIENT_ID, nonce: 'n', ...opts });
  assert.ok(ok(claimsFor('n')));
  assert.equal(ok(claimsFor('n', { iss: 'https://evil.example' })), null);
  assert.equal(ok(claimsFor('n', { aud: 'other-client' })), null);
  assert.equal(ok(claimsFor('n', { exp: now() - 3600 })), null);
  assert.equal(ok(claimsFor('n'), { nonce: 'm' }), null);
  const none = `${b64({ alg: 'none', kid: 'k1' })}.${b64(claimsFor('n'))}.`;
  assert.equal(verifyIdToken(none, { keys, clientId: CLIENT_ID, nonce: 'n' }), null);
  assert.equal(verifyIdToken('not.a.jwt', { keys, clientId: CLIENT_ID, nonce: 'n' }), null);
});

test('without Google keys the buttons lead to a clear message', async () => {
  const off = createAppServer({ db: openDatabase(':memory:'), mailer: createMailer({ mode: 'off' }), googleKeys: null });
  await new Promise((r) => off.http.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${off.http.address().port}`;
    assert.equal((await fetch(`${url}/auth/google/start`, { redirect: 'manual' })).headers.get('location'), '/#/welcome?error=off');
    assert.deepEqual(await (await fetch(`${url}/api/auth/providers`)).json(), { email: false, google: false });
  } finally {
    await off.close();
  }
});
