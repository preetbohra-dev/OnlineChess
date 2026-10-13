// The accounts and sync API under /api/. JSON only, no caching, strict limits:
//   POST /api/register {username, password} · POST /api/login {username, password}
//   POST /api/logout · GET /api/me · GET /api/state · PUT /api/state {state}
//   GET /api/push/key · POST /api/push/subscribe {subscription, tz, hour} · POST /api/push/unsubscribe {endpoint}
//   GET /api/challenge · POST /api/challenge/answer {index, move} · POST /api/challenge/game {slot, moves}
//   GET /api/challenge/leaderboard
//   POST /api/account/delete {password | code} · POST /api/report {username}
//   Email accounts (email-auth.js): POST /api/signup {email, username, password?} ·
//   POST /api/auth/request {email} · POST /api/auth/code {email, code, password?} ·
//   POST /api/auth/link {token, password?} · GET /api/account · POST /api/account/email {email, password | code} ·
//   POST /api/account/name {username} · POST /api/account/password {current | code, password}
// Writes need a same-origin request with the X-OC-Request header (CSRF protection on top of the
// SameSite=Lax session cookie). The apps call from their own origins (allowed by index.js) and
// authenticate with `Authorization: Bearer <token>`, which no other site can send. Sign-in
// attempts are rate-limited per address; accounts lock after repeated wrong passwords (auth.js).
import { createTokenBucket, createBucketMap, addressKey } from './rate-limit.js';
import { mergeStates, normalizeState, MAX_STATE_BYTES } from '../public/js/core/sync.js';
import { validSubscription, validTimeZone, MAX_SUBSCRIPTIONS_PER_USER, MAX_SUBSCRIPTIONS } from './push.js';
import { challengeWeek, weeklySet, isCorrect, scoreGame, publicView, PUZZLE_POINTS, MIN_MS_PER_PLY } from './challenge.js';
import { USERNAME } from './auth.js';
import { nameProblem } from './names.js';

export const SESSION_COOKIE = 'oc_session';
const AUTH_BODY_BYTES = 2 * 1024;
// Different players (with accounts at least REPORTER_MIN_AGE_MS old) who must report a username
// before it leaves the leaderboard, and how many players one account may report per day.
export const HIDE_AFTER_REPORTS = 3;
export const REPORTER_MIN_AGE_MS = 86_400_000;
const REPORTS_PER_DAY = 10;

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
  appOrigin = () => false, // a request from an app page (capacitor://localhost, https://localhost)
  isApp = () => false, // ... that also says it is the app (bearer tokens instead of cookies)
  authRate = { rate: 0.2, burst: 10 }, // sign-in attempts per address (IPv6: per /64)
  hashRate = { rate: 30, burst: 60 }, // password hashes per second for the whole server (CPU guard)
  syncRate = { rate: 0.5, burst: 5 }, // state uploads per account and per address
  push = null, // { publicKey } when reminders are running
  puzzles = null, // the puzzle library (rows parsed) for the weekly challenge
  emailAuth = null, // email sign-up and sign-in (email-auth.js), when email is set up
  outbox = null, // test runs only: the dry-run mailer's outbox, readable at /api/_test/outbox
}) {
  // The week's set is chosen once, when the week is first served, and stored: later changes to
  // the pool (or a server restart) never change a week that has started.
  let cachedSet = null;
  const thisWeek = () => {
    const week = challengeWeek(now());
    if (cachedSet?.week !== week) {
      const stored = db.q.weekSet.get(week);
      if (stored) cachedSet = JSON.parse(stored.data);
      else {
        db.q.addWeekSet.run(week, JSON.stringify(weeklySet(week, puzzles)), now());
        cachedSet = JSON.parse(db.q.weekSet.get(week).data);
      }
    }
    return cachedSet;
  };
  const leaderboard = (week, limit) => db.q.leaderboard.all(PUZZLE_POINTS, week, week, limit);
  // The public part of the leaderboard is cached briefly; it is the same for every visitor.
  let boardCache = { at: 0, week: null, top: [], lastWeek: [] };
  const cachedBoard = (week) => {
    if (boardCache.week !== week || now() - boardCache.at > 15_000) {
      boardCache = { at: now(), week, top: leaderboard(week, 50).map(({ rank, username, score }) => ({ rank, username, score })), lastWeek: leaderboard(lastWeekOf(week), 3).map(({ rank, username, score }) => ({ rank, username, score })) };
    }
    return boardCache;
  };
  const gameBucket = createTokenBucket({ rate: 20, burst: 40 }); // reported games checked per second, server-wide
  const lastWeekOf = (week) => new Date(Date.parse(`${week}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const authBuckets = createBucketMap(authRate);
  const syncBuckets = createBucketMap(syncRate);
  const hashBucket = createTokenBucket(hashRate);
  const addressOf = (req) => addressKey(clientAddress(req));

  // Secure cookies everywhere except plain-http local development.
  const cookie = (req, token, maxAge) => {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
  };
  // The website gets an HttpOnly cookie; an app gets the token in the body and keeps it itself.
  const signedIn = (req, res, result, status = 200) => (isApp(req)
    ? send(res, status, { user: { username: result.user.username }, token: result.token })
    : send(res, status, { user: { username: result.user.username } }, { 'Set-Cookie': cookie(req, result.token, 30 * 86_400) }));
  const signedOut = (req, res) => send(res, 200, { user: null }, isApp(req) ? {} : { 'Set-Cookie': cookie(req, '', 0) });

  return async function handleApi(req, res, pathname) {
    if (!db) return send(res, 503, { error: 'Accounts are not available on this server.' });
    const route = `${req.method} ${pathname}`;
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write && (!originAllowed(req) || req.headers['x-oc-request'] !== '1')) return send(res, 403, { error: 'Forbidden.' });
    const bearer = /^Bearer ([\w-]{20,100})$/.exec(req.headers.authorization ?? '');
    // App pages authenticate with the bearer token only, never a cookie (one more layer against
    // cross-site use of a website session).
    const token = bearer ? bearer[1] : appOrigin(req) ? null : readCookie(req, SESSION_COOKIE);
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
        return signedOut(req, res);

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

      case 'GET /api/challenge': {
        if (!puzzles) return send(res, 503, { error: 'The weekly challenge is not available.' });
        if (!user) return send(res, 401, { error: 'Sign in to take part.' });
        const set = thisWeek();
        return send(res, 200, publicView(set, db.q.answers.all(user.id, set.week), db.q.gamesPlayed.all(user.id, set.week)));
      }

      case 'POST /api/challenge/start':
      case 'POST /api/challenge/answer':
      case 'POST /api/challenge/game': {
        if (!puzzles) return send(res, 503, { error: 'The weekly challenge is not available.' });
        if (!user) return send(res, 401, { error: 'Sign in to take part.' });
        if (!syncBuckets.take(`c${user.id}`)) return send(res, 429, { error: 'Too many requests.' });
        const body = await readJson(req, route.endsWith('game') ? 8 * 1024 : AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const set = thisWeek();
        // Every request names the week it was made for, so nothing lands on the next week's set.
        if (body.value?.week !== set.week) return send(res, 409, { error: 'A new week has started. Reload to see this week\'s challenge.', week: set.week });
        if (route.endsWith('start')) {
          const slot = set.games[body.value?.slot];
          if (!Number.isInteger(body.value?.slot) || !slot) return send(res, 400, { error: 'No such game.' });
          db.q.startGame.run(user.id, set.week, slot.slot, now());
          return send(res, 200, { ok: true });
        }
        if (route.endsWith('answer')) {
          const p = set.puzzles[body.value?.index];
          if (!Number.isInteger(body.value?.index) || !p) return send(res, 400, { error: 'No such puzzle.' });
          if (typeof body.value.move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.value.move)) return send(res, 400, { error: 'Bad move.' });
          const correct = isCorrect(p, body.value.move);
          // One attempt: a second answer for the same puzzle is ignored.
          const added = db.q.addAnswer.run(user.id, set.week, p.index, body.value.move, correct ? 1 : 0, now()).changes;
          const stored = db.q.answers.all(user.id, set.week).find((a) => a.idx === p.index);
          return send(res, 200, { correct: Boolean(stored.correct), best: p.answer, first: added === 1 });
        }
        const slot = set.games[body.value?.slot];
        if (!Number.isInteger(body.value?.slot) || !slot) return send(res, 400, { error: 'No such game.' });
        if (!gameBucket.take()) return send(res, 503, { error: 'The server is busy. Try again in a moment.' });
        const started = db.q.gameStart.get(user.id, set.week, slot.slot);
        if (!started) return send(res, 400, { error: 'Start challenge games from the weekly challenge page.' });
        const scored = scoreGame(slot, body.value.moves);
        if (!scored.ok) return send(res, 400, { error: scored.error });
        // A real game takes time: reject results that arrive faster than the moves could be played.
        if (now() - started.at < scored.plies * MIN_MS_PER_PLY) return send(res, 400, { error: 'That game was too quick to count.' });
        const added = db.q.addGame.run(user.id, set.week, slot.slot, scored.outcome, scored.points, scored.plies, now()).changes;
        return send(res, 200, { outcome: scored.outcome, points: scored.points, first: added === 1 });
      }

      case 'GET /api/challenge/leaderboard': {
        if (!puzzles) return send(res, 503, { error: 'The weekly challenge is not available.' });
        if (!syncBuckets.take(`l${addressOf(req)}`)) return send(res, 429, { error: 'Too many requests.' });
        const week = thisWeek().week;
        const board = cachedBoard(week);
        const row = user ? db.q.myRank.get(PUZZLE_POINTS, week, week, user.id, user.id) : null;
        return send(res, 200, {
          week,
          top: board.top,
          me: user ? { username: user.username, rank: row?.score > 0 ? row.rank : null, score: row?.score ?? 0 } : null,
          lastWeek: board.lastWeek,
        });
      }

      case 'POST /api/account/delete': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        if (!authBuckets.take(addressOf(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' }, { 'Retry-After': '60' });
        if (!hashBucket.take()) return send(res, 503, { error: 'The server is busy. Try again in a moment.' }, { 'Retry-After': '5' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        // With a password, the password; without one, a sign-in code sent to the account's email.
        const passwordLess = !db.q.userById.get(user.id)?.has_password;
        const result = passwordLess && emailAuth
          ? (emailAuth.proveEmail(user, body.value?.code) ? (db.q.deleteUser.run(user.id), { ok: true }) : { ok: false, status: 401, error: 'That code is wrong or has expired.' })
          : await accounts.deleteAccount(user.id, body.value?.password, addressOf(req));
        if (!result.ok) return send(res, result.status, { error: result.error });
        boardCache.at = 0; // the player leaves the leaderboard at once
        return signedOut(req, res);
      }

      // A signed-in player reports another player's username. Enough different established reporters hide it
      // from the leaderboard until an admin looks (scripts/admin.mjs reports | hide | unhide).
      case 'POST /api/report': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        if (!syncBuckets.take(`r${user.id}`)) return send(res, 429, { error: 'Too many requests.' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const name = body.value?.username;
        const target = typeof name === 'string' && USERNAME.test(name) ? db.q.userByName.get(name) : null;
        if (!target) return send(res, 404, { error: 'No such player.' });
        if (target.id === user.id) return send(res, 400, { error: 'You cannot report yourself.' });
        if (db.q.reportsBy.get(user.id, now() - 86_400_000).n >= REPORTS_PER_DAY) return send(res, 429, { error: 'You have sent a lot of reports today. Try again tomorrow.' });
        db.q.addReport.run(user.id, target.id, now());
        if (!target.hidden && db.q.countReports.get(target.id, now() - REPORTER_MIN_AGE_MS).n >= HIDE_AFTER_REPORTS) {
          db.q.setHidden.run(1, target.id);
          boardCache.at = 0;
        }
        return send(res, 200, { ok: true });
      }

      case 'GET /api/account': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        const row = db.q.userById.get(user.id);
        return send(res, 200, { username: row.username, email: row.email ?? null, hasPassword: Boolean(row.has_password) });
      }

      case 'POST /api/signup':
      case 'POST /api/auth/request':
      case 'POST /api/auth/code':
      case 'POST /api/auth/link':
      case 'POST /api/account/email': {
        if (!emailAuth) return send(res, 503, { error: 'Email sign-in is not available yet.' });
        if (!authBuckets.take(addressOf(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' }, { 'Retry-After': '60' });
        const hashes = route !== 'POST /api/auth/request'; // these may hash a password
        if (hashes && !hashBucket.take()) return send(res, 503, { error: 'The server is busy. Try again in a moment.' }, { 'Retry-After': '5' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const v = body.value ?? {};
        const address = addressOf(req);
        if (route === 'POST /api/account/email') {
          if (!user) return send(res, 401, { error: 'Sign in first.' });
          const r = await emailAuth.addEmail(user, v, address);
          return r.ok ? send(res, 202, { ok: true }) : send(res, r.status, { error: r.error });
        }
        if (route === 'POST /api/signup' || route === 'POST /api/auth/request') {
          const r = route === 'POST /api/signup' ? emailAuth.signup(v, address) : emailAuth.request(v, address);
          // The same answer whether or not the email has an account: "check your email".
          return r.ok ? send(res, 202, { ok: true }) : send(res, r.status, { error: r.error });
        }
        const r = route === 'POST /api/auth/code' ? await emailAuth.useCode(v, user) : await emailAuth.useLink(v, user);
        if (!r.ok) return send(res, r.status, { error: r.error });
        if (!r.token) return send(res, 200, { user: { username: r.user.username }, emailAdded: true });
        boardCache.at = 0;
        return isApp(req)
          ? send(res, 200, { user: { username: r.user.username }, token: r.token, created: r.created, suggestedName: r.suggestedName })
          : send(res, 200, { user: { username: r.user.username }, created: r.created, suggestedName: r.suggestedName }, { 'Set-Cookie': cookie(req, r.token, 30 * 86_400) });
      }

      case 'POST /api/account/name': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        if (!syncBuckets.take(`n${user.id}`)) return send(res, 429, { error: 'Too many requests.' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        const name = body.value?.username;
        if (typeof name !== 'string' || !USERNAME.test(name)) return send(res, 400, { error: 'Names are 3–20 letters, digits, - or _.' });
        if (nameProblem(name)) return send(res, 400, { error: 'Please choose a different name.' });
        const taken = db.q.userByName.get(name);
        if (taken && taken.id !== user.id) return send(res, 409, { error: 'That name is taken.' });
        db.q.setUsername.run(name, user.id);
        boardCache.at = 0;
        return send(res, 200, { user: { username: name } });
      }

      case 'POST /api/account/password': {
        if (!user) return send(res, 401, { error: 'Sign in first.' });
        if (!authBuckets.take(addressOf(req))) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' }, { 'Retry-After': '60' });
        if (!hashBucket.take()) return send(res, 503, { error: 'The server is busy. Try again in a moment.' }, { 'Retry-After': '5' });
        const body = await readJson(req, AUTH_BODY_BYTES);
        if (!body.ok) return send(res, body.status, { error: body.error });
        // An account without a password sets its first one with a code sent to its email.
        const proven = typeof body.value?.code === 'string' && Boolean(emailAuth?.proveEmail(user, body.value.code));
        const result = await accounts.changePassword(user.id, body.value?.current, body.value?.password, addressOf(req), { proven });
        if (!result.ok) return send(res, result.status, { error: result.error });
        accounts.endOtherSessions(user.id, token);
        return send(res, 200, { ok: true });
      }

      case 'GET /api/_test/outbox': {
        // Test runs only (MAIL=dry with TEST_HOOKS=1): the emails "sent" to one address.
        if (!outbox) return send(res, 404, { error: 'Not found.' });
        const to = new URL(req.url, 'http://x').searchParams.get('to') ?? '';
        return send(res, 200, { emails: outbox.filter((m) => m.to === to.toLowerCase()).slice(-5) });
      }

      default:
        return send(res, 404, { error: 'Not found.' });
    }
  };
}
