import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validSubscription, validTimeZone, localDayHour, reminderFor, sendDueReminders, loadVapidKeys } from '../../server/push.js';
import { openDatabase } from '../../server/db.js';

const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
const sub = (endpoint) => ({ endpoint, keys: KEYS });

test('only real push services are accepted as endpoints', () => {
  assert.ok(validSubscription(sub('https://fcm.googleapis.com/fcm/send/abc')));
  assert.ok(validSubscription(sub('https://updates.push.services.mozilla.com/wpush/v2/x')));
  assert.ok(validSubscription(sub('https://web.push.apple.com/QGx')));
  assert.ok(validSubscription(sub('https://push.services.mozilla.com/wpush/v2/x')));
  assert.equal(validSubscription(sub('https://fcm.googleapis.com./x')), null, 'trailing dot');
  assert.equal(validSubscription(sub('https://evilpush.apple.com/x')), null);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x',
    'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'javascript:alert(1)', 'not a url']) {
    assert.equal(validSubscription(sub(bad)), null, bad);
  }
  assert.equal(validSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'short', auth: KEYS.auth } }), null);
  assert.equal(validSubscription(null), null);
});

test('time zones and local hours', () => {
  assert.ok(validTimeZone('Asia/Kolkata'));
  assert.ok(!validTimeZone('Nowhere/Land'));
  assert.ok(!validTimeZone({}));
  assert.deepEqual(localDayHour(Date.UTC(2026, 9, 11, 13, 30), 'Asia/Kolkata'), { day: '2026-10-11', hour: 19 });
  assert.deepEqual(localDayHour(Date.UTC(2026, 9, 11, 2, 0), 'America/New_York'), { day: '2026-10-10', hour: 22 });
});

test('the reminder mentions a live streak, and is skipped once today is solved', () => {
  assert.equal(reminderFor({ last: '2026-10-11', streak: 4 }, '2026-10-11'), null);
  assert.match(reminderFor({ last: '2026-10-10', streak: 4 }, '2026-10-11').title, /4-day streak/);
  assert.match(reminderFor(null, '2026-10-11').title, /daily puzzle is waiting/);
  assert.equal(reminderFor({ last: '2026-10-01', streak: 2 }, '2026-10-11').url, '/#/daily');
});

test('the scheduler sends once a day after the chosen hour, skips solved days, and drops dead subscriptions', async () => {
  const db = openDatabase(':memory:');
  const uid = Number(db.q.insertUser.run('kim', 'x', 0).lastInsertRowid);
  const uid2 = Number(db.q.insertUser.run('lee', 'x', 0).lastInsertRowid);
  db.q.upsertPush.run(uid, 'https://fcm.googleapis.com/a', KEYS.p256dh, KEYS.auth, 'Asia/Kolkata', 19, 0);
  db.q.upsertPush.run(uid2, 'https://fcm.googleapis.com/gone', KEYS.p256dh, KEYS.auth, 'Asia/Kolkata', 8, 0);
  db.q.putState.run(uid2, JSON.stringify({ profile: { daily: { last: '2026-10-10', streak: 2 } } }), 0);
  const sent = [];
  const send = async (s, payload) => {
    if (s.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push(JSON.parse(payload));
  };
  const at = (h, m = 0) => Date.UTC(2026, 9, 11, h - 5, m - 30); // IST = UTC+5:30
  let r = await sendDueReminders(db, { now: at(18), send });
  assert.deepEqual(r, { sent: 0, removed: 1, failed: 0 }, 'kim not yet due; lee due but gone');
  r = await sendDueReminders(db, { now: at(19, 10), send });
  assert.deepEqual(r, { sent: 1, removed: 0, failed: 0 });
  r = await sendDueReminders(db, { now: at(21), send });
  assert.equal(r.sent, 0, 'once a day');
  assert.equal(db.q.allPush.all().length, 1);
  // Solved today: no reminder the next day either until a new day without a solve.
  db.q.putState.run(uid, JSON.stringify({ profile: { daily: { last: '2026-10-12', streak: 1 } } }), 0);
  r = await sendDueReminders(db, { now: at(19) + 86_400_000, send });
  assert.equal(r.sent, 0);
  assert.match(sent[0].title, /daily puzzle/);
});

test('VAPID keys are created once and kept private', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vapid-')), 'k.json');
  const a = loadVapidKeys(file);
  const b = loadVapidKeys(file);
  assert.deepEqual(a, b);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('failing subscriptions are dropped after three days; slow sends time out; another account cannot take an endpoint', async () => {
  const db = openDatabase(':memory:');
  const a = Number(db.q.insertUser.run('ann', 'x', 0).lastInsertRowid);
  const b = Number(db.q.insertUser.run('ben', 'x', 0).lastInsertRowid);
  db.q.upsertPush.run(a, 'https://fcm.googleapis.com/bad', KEYS.p256dh, KEYS.auth, 'UTC', 0, 0);
  db.q.upsertPush.run(b, 'https://fcm.googleapis.com/bad', 'C'.repeat(87), KEYS.auth, 'UTC', 0, 0);
  assert.equal(db.q.pushForUser.all(b).length, 0, 'the endpoint stays with its first owner');
  const failing = async () => { throw new Error('bad key'); };
  for (let d = 0; d < 3; d++) await sendDueReminders(db, { now: Date.UTC(2026, 9, 11 + d, 12), send: failing });
  assert.equal(db.q.allPush.all().length, 0, 'dropped on the third failing day');
  db.q.upsertPush.run(a, 'https://fcm.googleapis.com/slow', KEYS.p256dh, KEYS.auth, 'UTC', 0, 0);
  const r = await sendDueReminders(db, { now: Date.UTC(2026, 9, 20, 12), send: () => new Promise(() => {}), timeoutMs: 50 });
  assert.equal(r.failed, 1);
});

test('a damaged key file is an error, not silently replaced', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vapid-')), 'k.json');
  fs.writeFileSync(file, '{not json');
  assert.throws(() => loadVapidKeys(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json');
});
