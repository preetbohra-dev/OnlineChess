// Daily-puzzle reminders over Web Push. The server keeps one VAPID key pair (outside the
// repository), stores each signed-in player's subscriptions, and every few minutes sends one
// reminder per day to players whose chosen hour has come in their time zone and whose daily
// puzzle is still unsolved.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';

export const DEFAULT_VAPID_FILE = path.join(os.homedir(), '.jodhpur-studio', 'secrets', 'chess-vapid.json');
export const MAX_SUBSCRIPTIONS_PER_USER = 5;
export const MAX_SUBSCRIPTIONS = 5000; // for the whole server
const MAX_FAILURES = 3; // consecutive failed days before a subscription is dropped
const SEND_CONCURRENCY = 5;
const SEND_TIMEOUT_MS = 15_000;
const MAX_SENDS_PER_PASS = 1000;

// Only the browsers' own push services may receive our requests (no requests to arbitrary hosts).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

// VAPID keys: read from the secrets file, or generated (and saved, readable by this user only).
// A damaged key file is an error, never silently replaced: new keys would cut off every subscriber.
export function loadVapidKeys(file = process.env.VAPID_FILE || DEFAULT_VAPID_FILE) {
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (text !== null) {
    const keys = JSON.parse(text);
    if (!keys.publicKey || !keys.privateKey) throw new Error(`${file} does not hold VAPID keys`);
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
    return keys;
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

// A subscription as sent by the browser: { endpoint, keys: { p256dh, auth } }. -> cleaned | null
export function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return null;
  let url;
  try { url = new URL(sub.endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  const { p256dh, auth } = sub.keys ?? {};
  const b64url = /^[A-Za-z0-9_-]+=*$/;
  if (typeof p256dh !== 'string' || !b64url.test(p256dh) || p256dh.length < 80 || p256dh.length > 120) return null;
  if (typeof auth !== 'string' || !b64url.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

// The local date (YYYY-MM-DD) and hour for an instant in a time zone.
export function localDayHour(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// The reminder text, using the synced streak when there is one. daily: { last, streak } or null.
export function reminderFor(daily, day) {
  if (daily?.last === day) return null; // already solved today
  const yesterday = new Date(`${day}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const alive = daily?.last === yesterday.toISOString().slice(0, 10) && daily.streak > 0;
  return {
    title: alive ? `🔥 Keep your ${daily.streak}-day streak` : '🧩 Your daily puzzle is waiting',
    body: alive ? 'Today\'s puzzle takes a minute — don\'t break the chain!' : 'A new puzzle, picked for your rating. Can you solve it?',
    url: '/#/daily',
  };
}

// A send that gives up after SEND_TIMEOUT_MS, whatever the push service does.
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('push timeout')), ms); })])
    .finally(() => clearTimeout(timer));
}

// One pass of the scheduler. send(subscription, payloadJson) -> Promise; errors with statusCode
// 404/410 mean the subscription is gone. A subscription that fails on MAX_FAILURES days in a row
// (bad keys, an unreachable service) is dropped too. Returns { sent, removed, failed }.
export async function sendDueReminders(db, { now = Date.now(), send, timeoutMs = SEND_TIMEOUT_MS }) {
  const out = { sent: 0, removed: 0, failed: 0 };
  const due = [];
  for (const row of db.q.allPush.all()) {
    const { day, hour } = localDayHour(now, row.tz);
    if (row.last_sent_day === day || hour < row.hour) continue;
    db.q.markPushSent.run(day, row.id); // at most once a day, whatever happens below
    const message = reminderFor(row.daily_last ? { last: row.daily_last, streak: row.daily_streak ?? 0 } : null, day);
    if (message) due.push({ row, message });
    if (due.length >= MAX_SENDS_PER_PASS) break; // the rest wait for the next pass
  }
  const drop = (row) => { db.q.deletePushEndpoint.run(row.endpoint); out.removed++; };
  async function worker() {
    for (let item = due.shift(); item; item = due.shift()) {
      const { row, message } = item;
      try {
        await withTimeout(send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(message)), timeoutMs);
        db.q.pushOk.run(row.id);
        out.sent++;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410 || row.failures + 1 >= MAX_FAILURES) drop(row);
        else { db.q.pushFailed.run(row.id); out.failed++; }
      }
    }
  }
  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));
  return out;
}

// Production sender and timer.
// dryRun (tests): nothing leaves the machine.
export function startReminders(db, { keys = loadVapidKeys(), subject, intervalMs = 10 * 60 * 1000, dryRun = false } = {}) {
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const send = dryRun ? async () => {} : (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 12 * 60 * 60, timeout: 10_000 });
  let running = false; // never two passes at once
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sendDueReminders(db, { send }); } catch (err) { console.error('Push reminders failed:', err.message); } finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return { publicKey: keys.publicKey, stop: () => clearInterval(timer) };
}
