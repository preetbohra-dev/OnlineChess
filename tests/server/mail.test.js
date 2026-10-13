import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMailer, loadAuthEnv, validEmail, normalizeEmail, signInEmail, confirmEmail, FROM } from '../../server/mail.js';

test('email addresses: a plain check, lower-cased, no header tricks', () => {
  for (const ok of ['a@b.co', 'First.Last+tag@Example.com', 'x_y-z@sub.domain.org']) assert.ok(validEmail(ok), ok);
  for (const bad of ['', 'no-at', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b.com\r\nBcc: x@y.z', `${'a'.repeat(250)}@b.com`, `${'a'.repeat(65)}@b.com`,
    'a@b.c,evil@x.yz', '"x"<y>@z.com', 'a;b@c.com', 'ü@example.com', 'a@exämple.com', 'a@-b.com', 'a@b.123', null, 42]) assert.equal(validEmail(bad), false, String(bad));
  assert.equal(normalizeEmail('  First.Last@Example.COM '), 'first.last@example.com');
});

test('the auth secrets file: KEY=VALUE lines, missing file is empty, comments ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-auth-'));
  try {
    const file = path.join(dir, 'chess-auth.env');
    assert.deepEqual(loadAuthEnv(file), {});
    fs.writeFileSync(file, '# keys\nRESEND_API_KEY=re_abc=123\n\nGOOGLE_CLIENT_ID = id.apps.googleusercontent.com \nGOOGLE_CLIENT_SECRET="quoted"\nbroken line\n', { mode: 0o644 });
    assert.deepEqual(loadAuthEnv(file), { RESEND_API_KEY: 're_abc=123', GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'quoted' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'made private');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('templates: the sign-in email has the link and the code, escaped in HTML', () => {
  const m = signInEmail({ code: '123456', link: 'https://chess.example/auth/link?t=a&b=c' });
  assert.match(m.subject, /123456/);
  assert.match(m.text, /123456/);
  assert.match(m.text, /https:\/\/chess\.example\/auth\/link\?t=a&b=c/);
  assert.match(m.html, /t=a&amp;b=c/);
  assert.throws(() => signInEmail({ code: '12345', link: 'https://x/l' }), /bad code/);
  assert.throws(() => signInEmail({ code: '123456', link: 'javascript:alert(1)' }), /bad link/);
  assert.throws(() => confirmEmail({ code: '123456', link: 'https://x/l"><script>' }), /bad link/);
  const v = confirmEmail({ code: '654321', link: 'https://chess.example/#/auth?t=1' });
  assert.match(v.subject, /654321 is your OnlineChess confirmation code/);
  assert.match(v.html, /#\/auth\?t=1/);
});

test('dry run keeps the last emails in an outbox and sends nothing', async () => {
  let called = false;
  const mailer = createMailer({ mode: 'dry', fetchImpl: () => { called = true; } });
  assert.equal(mailer.enabled, true);
  const r = await mailer.send({ to: 'Player@Example.com', ...signInEmail({ code: '111222', link: 'https://x/l' }) });
  assert.equal(r.ok, true);
  assert.equal(called, false);
  assert.equal(mailer.outbox.at(-1).to, 'player@example.com');
  assert.match(mailer.outbox.at(-1).text, /111222/);
  for (let i = 0; i < 250; i++) await mailer.send({ to: 'a@b.co', subject: 's', text: 't', html: 'h' });
  assert.equal(mailer.outbox.length, 200, 'bounded');
});

test('live mode posts to Resend with the key; failures are reported, not thrown', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }); };
  const mailer = createMailer({ mode: 'live', apiKey: 're_test_key', fetchImpl });
  const r = await mailer.send({ to: 'p@example.com', subject: 'Hi', text: 'T', html: '<p>T</p>' });
  assert.deepEqual(r, { ok: true, id: 'em_1' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_key');
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: FROM, to: ['p@example.com'], subject: 'Hi', text: 'T', html: '<p>T</p>' });

  const failing = createMailer({ mode: 'live', apiKey: 'k', fetchImpl: async () => new Response('{"message":"bad"}', { status: 422 }) });
  assert.deepEqual(await failing.send({ to: 'p@example.com', subject: 'S', text: 'T', html: 'H' }), { ok: false, error: 'send failed (422)' });
  const offline = createMailer({ mode: 'live', apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await offline.send({ to: 'p@example.com', subject: 'S', text: 'T', html: 'H' })).ok, false);
});

test('bad recipients are refused before anything is sent; without a key mail is off', async () => {
  const mailer = createMailer({ mode: 'dry' });
  assert.deepEqual(await mailer.send({ to: 'not an email', subject: 'S', text: 'T', html: 'H' }), { ok: false, error: 'bad recipient' });
  assert.equal(mailer.outbox.length, 0);
  const off = createMailer({ mode: 'live', apiKey: '' });
  assert.equal(off.enabled, false);
  assert.deepEqual(await off.send({ to: 'p@example.com', subject: 'S', text: 'T', html: 'H' }), { ok: false, error: 'email is not set up' });
});

test('limits: per inbox, per address and for the whole server, refilling over the hour', async () => {
  const { createMailLimits } = await import('../../server/mail.js');
  let t = 0;
  const limits = createMailLimits({ perInbox: 3, inboxWindowMs: 900_000, perAddress: 5, total: 8, now: () => t });
  const ok = (inbox, address) => limits.take(inbox, address);
  assert.deepEqual([ok('a@x.co', '1'), ok('A@X.co', '1'), ok('a@x.co', '1'), ok('a@x.co', '1')], [true, true, true, false], 'per inbox, case-insensitive');
  assert.deepEqual([ok('b@x.co', '1'), ok('c@x.co', '1'), ok('d@x.co', '1')], [true, true, false], 'per address');
  assert.equal(ok('z@x.co', '9'), true, 'the address refusal did not use z@x.co\'s inbox allowance');
  assert.deepEqual([ok('e@x.co', '2'), ok('f@x.co', '3'), ok('h@x.co', '5')], [true, true, false], 'whole server');
  t += 300_000;
  assert.equal(ok('a@x.co', '7'), false, 'the whole server is still capped');
  t += 3_600_000;
  assert.equal(ok('a@x.co', '1'), true, 'refilled');
});
