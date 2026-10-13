import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { createMailer, createMailLimits } from '../../server/mail.js';
import { suggestUsername } from '../../server/email-auth.js';

const PW = 'correct horse battery';
let app, base, db, mailer;
test.before(async () => {
  db = openDatabase(':memory:');
  mailer = createMailer({ mode: 'dry' });
  app = createAppServer({ usernameSignup: true, db, mailer, mailLimits: createMailLimits({ perInbox: 100, perAddress: 1000 }), publicOrigin: 'https://chess.example', authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 } });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

async function call(method, path, { body, cookie } = {}) {
  const headers = { Origin: base, 'X-OC-Request': '1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), cookie: res.headers.get('set-cookie')?.split(';')[0] ?? null };
}
const flush = () => new Promise((r) => setImmediate(r));
async function lastMail(to) {
  await flush();
  const mail = mailer.outbox.filter((m) => m.to === to).at(-1);
  assert.ok(mail, `an email to ${to}`);
  return { mail, code: /\b(\d{6})\b/.exec(mail.subject)[1], token: /#\/auth\?t=([\w-]+)/.exec(mail.text)[1] };
}

test('sign up with email: confirm with the code (choosing a password there), then sign in with the password', async () => {
  const r = await call('POST', '/api/signup', { body: { email: 'Ana@Example.com', username: 'AnaPlays', password: 'ignored here' } });
  assert.equal(r.status, 202);
  assert.equal(r.cookie, null, 'not signed in until the email is confirmed');
  assert.equal(db.q.userByEmail.get('ana@example.com'), undefined, 'no account before confirmation');
  const { mail, code } = await lastMail('ana@example.com');
  assert.match(mail.subject, /confirmation code/);
  assert.match(mail.text, /https:\/\/chess\.example\/#\/auth\?t=/, 'links use the configured origin, never the request Host');

  const done = await call('POST', '/api/auth/code', { body: { email: 'ana@example.com', code, password: PW } });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json, { user: { username: 'AnaPlays' }, created: true, suggestedName: false });
  assert.match(done.cookie, /^oc_session=/);
  assert.deepEqual((await call('GET', '/api/account', { cookie: done.cookie })).json, { username: 'AnaPlays', email: 'ana@example.com', hasPassword: true, google: false });
  assert.equal((await call('POST', '/api/auth/code', { body: { email: 'ana@example.com', code } })).status, 400, 'a code works once');

  assert.equal((await call('POST', '/api/login', { body: { username: 'ANA@example.com', password: PW } })).status, 200, 'sign in with the email');
  assert.equal((await call('POST', '/api/login', { body: { username: 'AnaPlays', password: PW } })).status, 200, 'or the name');
});

test('the same answer whether or not an email has an account; an existing account gets a sign-in code', async () => {
  const fresh = await call('POST', '/api/signup', { body: { email: 'new@example.com', username: 'Newbie', password: PW } });
  const again = await call('POST', '/api/signup', { body: { email: 'ana@example.com', username: 'Someone', password: PW } });
  assert.deepEqual([fresh.status, fresh.json], [again.status, again.json]);
  const { mail } = await lastMail('ana@example.com');
  assert.match(mail.subject, /sign-in code/);
  const unknown = await call('POST', '/api/auth/request', { body: { email: 'nobody@example.com' } });
  const known = await call('POST', '/api/auth/request', { body: { email: 'ana@example.com' } });
  assert.deepEqual([unknown.status, unknown.json], [known.status, known.json]);
});

test('sign in (and sign up) with just an emailed code: no password, a suggested name', async () => {
  await call('POST', '/api/auth/request', { body: { email: 'casual.player@example.com' } });
  const { code } = await lastMail('casual.player@example.com');
  const r = await call('POST', '/api/auth/code', { body: { email: 'casual.player@example.com', code } });
  assert.equal(r.status, 200);
  assert.equal(r.json.created, true);
  assert.equal(r.json.suggestedName, true);
  assert.match(r.json.user.username, /^player\d+$/, 'never the email\'s own name (it would be public)');
  const name = r.json.user.username;
  assert.deepEqual((await call('GET', '/api/account', { cookie: r.cookie })).json, { username: name, email: 'casual.player@example.com', hasPassword: false, google: false });
  assert.equal((await call('POST', '/api/login', { body: { username: name, password: '!' } })).status, 401, 'no password matches a password-less account');
  assert.equal((await call('POST', '/api/login', { body: { username: 'casual.player@example.com', password: 'anything at all' } })).status, 401);

  // A first password needs a code sent to the account's email, not just the session.
  assert.equal((await call('POST', '/api/account/password', { cookie: r.cookie, body: { password: 'my first password' } })).status, 401);
  await call('POST', '/api/auth/request', { body: { email: 'casual.player@example.com' } });
  const proof = await lastMail('casual.player@example.com');
  assert.equal((await call('POST', '/api/account/password', { cookie: r.cookie, body: { code: proof.code, password: 'my first password' } })).status, 200);
  assert.equal((await call('POST', '/api/login', { body: { username: 'casual.player@example.com', password: 'my first password' } })).status, 200);

  const named = await call('POST', '/api/account/name', { cookie: r.cookie, body: { username: 'KnightRider' } });
  assert.deepEqual(named.json, { user: { username: 'KnightRider' } });
  assert.equal((await call('POST', '/api/account/name', { cookie: r.cookie, body: { username: 'AnaPlays' } })).status, 409);
  assert.equal((await call('POST', '/api/account/name', { cookie: r.cookie, body: { username: 'sh1thead' } })).status, 400);
});

test('the link shows nothing by GET and signs in by POST; then every other code is void', async () => {
  await call('POST', '/api/auth/request', { body: { email: 'ana@example.com' } });
  const first = await lastMail('ana@example.com');
  await call('POST', '/api/auth/request', { body: { email: 'ana@example.com' } });
  const second = await lastMail('ana@example.com');
  const r = await call('POST', '/api/auth/link', { body: { token: second.token } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.username, 'AnaPlays');
  assert.equal((await call('POST', '/api/auth/code', { body: { email: 'ana@example.com', code: first.code } })).status, 400, 'older codes are void');
  assert.equal((await call('POST', '/api/auth/link', { body: { token: second.token } })).status, 400, 'the link works once');
});

test('forgot password: the emailed code sets a new one and signs out everywhere else', async () => {
  const old = await call('POST', '/api/login', { body: { username: 'ana@example.com', password: PW } });
  await call('POST', '/api/auth/request', { body: { email: 'ana@example.com' } });
  const { code } = await lastMail('ana@example.com');
  assert.equal((await call('POST', '/api/auth/code', { body: { email: 'ana@example.com', code, password: 'short' } })).status, 400);
  const r = await call('POST', '/api/auth/code', { body: { email: 'ana@example.com', code, password: 'a brand new password' } });
  assert.equal(r.status, 200);
  assert.deepEqual((await call('GET', '/api/me', { cookie: old.cookie })).json, { user: null }, 'other sessions ended');
  assert.deepEqual((await call('GET', '/api/me', { cookie: r.cookie })).json, { user: { username: 'AnaPlays' } });
  assert.equal((await call('POST', '/api/login', { body: { username: 'ana@example.com', password: PW } })).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { username: 'ana@example.com', password: 'a brand new password' } })).status, 200);
});

test('wrong guesses pause typed codes for that email but void nothing: the emailed link still works', async () => {
  await call('POST', '/api/auth/request', { body: { email: 'target@example.com' } });
  const { code, token } = await lastMail('target@example.com');
  assert.equal((await call('POST', '/api/auth/code', { body: { email: 'other@example.com', code } })).status, 400, 'a code only works for its own email');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/code', { body: { email: 'target@example.com', code: wrong } })).status, 400);
  assert.equal((await call('POST', '/api/auth/code', { body: { email: 'target@example.com', code } })).status, 400, 'typed codes are paused for 15 minutes');
  assert.equal((await call('POST', '/api/auth/link', { body: { token } })).status, 200, 'but the link was not voided');
});

test('a sign-up for someone else\'s email cannot plant a password', async () => {
  await call('POST', '/api/signup', { body: { email: 'victim@example.com', username: 'Squatter', password: 'attacker password' } });
  const { code } = await lastMail('victim@example.com');
  const r = await call('POST', '/api/auth/code', { body: { email: 'victim@example.com', code } }); // the victim confirms, choosing no password
  assert.equal(r.status, 200);
  assert.equal((await call('POST', '/api/login', { body: { username: 'Squatter', password: 'attacker password' } })).status, 401);
  assert.equal((await call('GET', '/api/account', { cookie: r.cookie })).json.hasPassword, false);
});

test('legacy accounts add an email with their password and a code; changing a password needs the current one', async () => {
  const reg = await call('POST', '/api/register', { body: { username: 'oldtimer', password: PW } });
  assert.equal((await call('POST', '/api/account/email', { body: { email: 'old@example.com' } })).status, 401);
  assert.equal((await call('POST', '/api/account/email', { cookie: reg.cookie, body: { email: 'old@example.com' } })).status, 401, 'a session alone cannot change the email');
  assert.equal((await call('POST', '/api/account/email', { cookie: reg.cookie, body: { email: 'old@example.com', password: PW } })).status, 202);
  const { code } = await lastMail('old@example.com');
  assert.equal((await call('POST', '/api/auth/code', { body: { email: 'old@example.com', code } })).status, 403, 'only the account that asked');
  const r = await call('POST', '/api/auth/code', { cookie: reg.cookie, body: { email: 'old@example.com', code } });
  assert.deepEqual(r.json, { user: { username: 'oldtimer' }, emailAdded: true });
  assert.equal((await call('GET', '/api/account', { cookie: reg.cookie })).json.email, 'old@example.com');

  assert.equal((await call('POST', '/api/account/password', { cookie: reg.cookie, body: { current: 'nope nope nope', password: 'another good password' } })).status, 401);
  assert.equal((await call('POST', '/api/account/password', { cookie: reg.cookie, body: { current: PW, password: 'another good password' } })).status, 200);
  assert.equal((await call('POST', '/api/login', { body: { username: 'old@example.com', password: 'another good password' } })).status, 200);
});

test('an account with a password is never deleted by an emailed code', async () => {
  const login = await call('POST', '/api/login', { body: { username: 'ana@example.com', password: 'a brand new password' } });
  await call('POST', '/api/auth/request', { body: { email: 'ana@example.com' } });
  const { code } = await lastMail('ana@example.com');
  assert.equal((await call('POST', '/api/account/delete', { cookie: login.cookie, body: { code } })).status, 401);
  assert.ok(db.q.userByEmail.get('ana@example.com'));
});

test('an account without a password is deleted with an emailed code', async () => {
  await call('POST', '/api/auth/request', { body: { email: 'leaving@example.com' } });
  const signIn = await call('POST', '/api/auth/code', { body: { email: 'leaving@example.com', code: (await lastMail('leaving@example.com')).code } });
  await call('POST', '/api/auth/request', { body: { email: 'leaving@example.com' } });
  const { code } = await lastMail('leaving@example.com');
  assert.equal((await call('POST', '/api/account/delete', { cookie: signIn.cookie, body: { code: '000000' === code ? '999999' : '000000' } })).status, 401);
  assert.equal((await call('POST', '/api/account/delete', { cookie: signIn.cookie, body: { code } })).status, 200);
  assert.equal(db.q.userByEmail.get('leaving@example.com'), undefined);
});

test('suggested names are allowed, free and plain', () => {
  assert.equal(suggestUsername(db, 'zed.zebra+chess@x.com'), 'zedzebrachess');
  assert.match(suggestUsername(db, 'ab@x.com'), /^player\d+$/);
  assert.match(suggestUsername(db, 'sh1thead@x.com'), /^player\d+$/);
  assert.match(suggestUsername(db, 'AnaPlays'), /^AnaPlays\d+$/);
});

test('the inbox cool-down: the fourth email in a few minutes is not sent, the earlier code still works', async () => {
  const limited = createAppServer({ usernameSignup: true, db: openDatabase(':memory:'), mailer: createMailer({ mode: 'dry' }), authRate: { rate: 1000, burst: 1000 } });
  await new Promise((r) => limited.http.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${limited.http.address().port}`;
    const ask = () => fetch(`${url}/api/auth/request`, { method: 'POST', headers: { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: '{"email":"busy@example.com"}' });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await ask()).status);
    assert.deepEqual(statuses, [202, 202, 202, 202], 'the same answer every time');
    await flush();
    assert.equal(limited.mailer.outbox.length, 3);
  } finally {
    await limited.close();
  }
});

test('without email set up the routes say so', async () => {
  const off = createAppServer({ usernameSignup: true, db: openDatabase(':memory:'), mailer: createMailer({ mode: 'off' }) });
  await new Promise((r) => off.http.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${off.http.address().port}`;
    const r = await fetch(`${url}/api/auth/request`, { method: 'POST', headers: { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: '{"email":"a@b.co"}' });
    assert.equal(r.status, 503);
    assert.equal((await fetch(`${url}/api/_test/outbox?to=a@b.co`)).status, 404, 'no outbox outside test runs');
  } finally {
    await off.close();
  }
});
