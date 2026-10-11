// The accounts and sync API under /api/. JSON only, no caching, strict limits:
//   POST /api/register {username, password} · POST /api/login {username, password}
//   POST /api/logout · GET /api/me · GET /api/state · PUT /api/state {state}
//   GET /api/push/key · POST /api/push/subscribe {subscription, tz, hour} · POST /api/push/unsubscribe {endpoint}
// Writes need a same-origin request with the X-OC-Request header (CSRF protection on top of the
// SameSite=Lax session cookie). Sign-in attempts are rate-limited per address; accounts lock
// after repeated wrong passwords (see auth.js).
import { createTokenBucket, createBucketMap, addressKey } from './rate-limit.js';
import { mergeStates, normalizeState, MAX_STATE_BYTES } from '../public/js/core/sync.js';
import { validSubscription, validTimeZone, MAX_SUBSCRIPTIONS_PER_USER, MAX_SUBSCRIPTIONS } from './push.js';

export const SESSION_COOKIE = 'oc_session';
const AUTH_BODY_BYTES = 2 * 1024;

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(json);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Reads a JSON body up to `limit` bytes. -> { ok, value } | { ok: false, status, error }
function readJson(req, limit) {
  return new Promise((resolve) => {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return resolve({ ok: false, status: 415, error: 'Send JSON.' });
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return resolve({ ok: false, status: 413, error: 'Too large.' });
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit && !done) { done = true; resolve({ ok: false, status: 413, error: 'Too large.' }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try { resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ ok: false, status: 400, error: 'Bad JSON.' }); }
    });
    req.on('error', () => { if (!done) { done = true; resolve({ ok: false, status: 400, error: 'Bad request.' }); } });
  });
}

export function createApi({
  db, accounts, originAllowed, clientAddress, now = () => Date.now(),
  authRate = { rate: 0.2, burst: 10 }, // sign-in attempts per address (IPv6: per /64)
  hashRate = { rate: 30, burst: 60 }, // password hashes per second for the whole server (CPU guard)
  syncRate = { rate: 0.5, burst: 5 }, // state uploads per account and per address
  push = null, // { publicKey } when reminders are running
}) {
  const authBuckets = createBucketMap(authRate);
  const syncBuckets = createBucketMap(syncRate);
  const hashBucket = createTokenBucket(hashRate);
  const addressOf = (req) => addressKey(clientAddress(req));

  // Secure cookies everywhere except plain-http local development.
  const cookie = (req, token, maxAge) => {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
  };
  const signedIn = (req, res, result, status = 200) => send(res, status, { user: { username: result.user.username } }, { 'Set-Cookie': cookie(req, result.token, 30 * 86_400) });

  return async function handleApi(req, res, pathname) {
    if (!db) return send(res, 503, { error: 'Accounts are not available on this server.' });
    const route = `${req.method} ${pathname}`;
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write && (!originAllowed(req) || req.headers['x-oc-request'] !== '1')) return send(res, 403, { error: 'Forbidden.' });
    const token = readCookie(req, SESSION_COOKIE);
    const user = token ? accounts.userForToken(token) : null;

    switch (route) {
      case 'GET /api/me':
        return send(res, 200, { user: user ? { username: user.username } : null });

      case 'POST /api/register':
      case 'POST /api/login': {
        if (!authBuckets.take(addressOf(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' }, { 'Retry-After': '60' });
        if (!hashBucket.take()) return send(res, 503, { error: 'The server is busy. Try again in a moment.' }, { 'Retry-After': '5' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const { username, password } = body.value ?? {};
        const result = route.endsWith('register') ? await accounts.register(username, password) : await accounts.login(username, password, addressOf(req));
        if (!result.ok) return send(res, result.status, { error: result.error }, result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {});
        return signedIn(req, res, result, route.endsWith('register') ? 201 : 200);
      }

      case 'POST /api/logout':
        if (token) accounts.logout(token);
        return send(res, 200, { user: null }, { 'Set-Cookie': cookie(req, '', 0) });

      case 'GET /api/state': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        const row = db.q.state.get(user.id);
        return send(res, 200, { state: row ? normalizeState(JSON.parse(row.data)) : null, updatedAt: row?.updated_at ?? null });
      }

      case 'PUT /api/state': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        if (!syncBuckets.take(`u${user.id}`) || !syncBuckets.take(`a${addressOf(req)}`)) {
          return send(res, 429, { error: 'Syncing too often. Try again shortly.' }, { 'Retry-After': '10' });
        }
        const body = await readJson(req, MAX_STATE_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const row = db.q.state.get(user.id);
        const merged = mergeStates(row ? JSON.parse(row.data) : {}, body.value?.state);
        const json = JSON.stringify(merged);
        if (Buffer.byteLength(json) > MAX_STATE_BYTES) return send(res, 413, { error: 'Too large.' });
        const at = now();
        db.q.putState.run(user.id, json, at);
        return send(res, 200, { state: merged, updatedAt: at });
      }

      case 'GET /api/push/key':
        return push ? send(res, 200, { publicKey: push.publicKey }) : send(res, 503, { error: 'Reminders are not available.' });

      case 'POST /api/push/subscribe': {
        if (!push) return send(res, 503, { error: 'Reminders are not available.' });
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        if (!syncBuckets.take(`u${user.id}`)) return send(res, 429, { error: 'Too many requests.' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const sub = validSubscription(body.value?.subscription);
        const { tz, hour } = body.value ?? {};
        if (!sub || !validTimeZone(tz) || !Number.isInteger(hour) || hour < 0 || hour > 23) return send(res, 400, { error: 'Invalid subscription.' });
        if (db.q.countAllPush.get().n >= MAX_SUBSCRIPTIONS) return send(res, 503, { error: 'Reminders are full right now. Try again later.' });
        db.transaction(() => {
          db.q.upsertPush.run(user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, tz, hour, now());
          while (db.q.countPush.get(user.id).n > MAX_SUBSCRIPTIONS_PER_USER) db.q.oldestPush.run(user.id);
        });
        return send(res, 200, { ok: true });
      }

      case 'POST /api/push/unsubscribe': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        if (typeof body.value?.endpoint === 'string') db.q.deletePush.run(body.value.endpoint, user.id);
        return send(res, 200, { ok: true });
      }

      default:
        return send(res, 404, { error: 'Not found.' });
    }
  };
}
