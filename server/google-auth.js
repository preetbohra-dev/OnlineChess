// "Continue with Google": the OpenID Connect authorization-code flow with PKCE, run by our server.
//   GET /auth/google/start    -> 302 to Google, with a random state (also in a short-lived cookie
//                                that ties the round trip to this browser), a nonce and a PKCE
//                                challenge
//   GET /auth/google/callback -> trade the code for Google's ID token, check it (signature against
//                                Google's published keys, issuer, audience, expiry, nonce), find or
//                                create the player, sign in, and go back to the app
// No library: node:crypto verifies the RS256 signature. The client id and secret come from the
// auth secrets file (server/mail.js loadAuthEnv).
import crypto from 'node:crypto';
import { normalizeEmail, validEmail } from './mail.js';
import { suggestUsername, NO_PASSWORD } from './email-auth.js';
import { readCookie } from './api.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const FLOW_TTL_MS = 10 * 60_000;
const MAX_FLOWS = 5_000;
const STATE_COOKIE = 'oc_google';
const TIMEOUT_MS = 10_000;
const MIN_REFETCH_MS = 60_000;
const APP_CODE_TTL_MS = 2 * 60_000;
export const APP_RETURN = 'com.solankidigitaldrafts.chess://auth'; // the apps' link scheme (AndroidManifest, Info.plist) // forced key refreshes (after an unknown key) at most this often

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const random = (n = 32) => b64url(crypto.randomBytes(n));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

// Checks a Google ID token. -> claims | null
export function verifyIdToken(idToken, { keys, clientId, nonce, now = Date.now() }) {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) return null;
  let ok = false;
  try {
    const key = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch {
    return null;
  }
  if (!ok) return null;
  const seconds = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss) || claims.aud !== clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp < seconds - 60) return null;
  if (typeof claims.iat !== 'number' || claims.iat > seconds + 300) return null;
  if (!nonce || claims.nonce !== nonce) return null;
  if (typeof claims.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(claims.sub)) return null;
  return claims;
}


export function createGoogleAuth({ db, accounts, clientId, clientSecret, origin, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const redirectUri = `${origin}/auth/google/callback`;
  const flows = new Map(); // state -> { verifier, nonce, created, linkUserId }
  const linkTickets = new Map(); // one-time ticket -> { userId, created }: "Connect Google" from the page
  // The apps: Google's answer comes back to the app through its own link scheme as a one-time
  // code, which only the app that started (holding the PKCE verifier) can exchange for a session.
  const appCodes = new Map(); // sha256(code) -> { userId, challenge, created, isNew }
  let certs = { keys: [], until: 0, fetched: 0 };

  async function googleKeys(force = false) {
    if (!force && certs.until > now() && certs.keys.length) return certs.keys;
    if (force && now() - certs.fetched < MIN_REFETCH_MS) return certs.keys;
    const res = await fetchImpl(CERTS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Google keys: ${res.status}`);
    const json = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    certs = { keys: Array.isArray(json.keys) ? json.keys : [], until: now() + Math.min(maxAge, 86_400) * 1000, fetched: now() };
    return certs.keys;
  }

  function prune() {
    const t = now();
    for (const [state, f] of flows) if (t - f.created > FLOW_TTL_MS) flows.delete(state);
    for (const [ticket, l] of linkTickets) if (t - l.created > FLOW_TTL_MS) linkTickets.delete(ticket);
    for (const [code, c] of appCodes) if (t - c.created > APP_CODE_TTL_MS) appCodes.delete(code);
  }

  // The player for a Google account: already linked; else the signed-in player who asked to link
  // it (unless its verified email belongs to someone else); else the account with the same
  // Google-verified email; else a new account. -> { userId, created } | { conflict: true }
  function resolve(claims, linkUserId) {
    const email = claims.email_verified === true && validEmail(normalizeEmail(claims.email)) ? normalizeEmail(claims.email) : null;
    const t = now();
    return db.transaction(() => {
      const linked = db.q.identity.get('google', claims.sub);
      if (linkUserId && !db.q.userById.get(linkUserId)) return { conflict: true }; // deleted meanwhile
      if (linked && linkUserId && linked.user_id !== linkUserId) return { conflict: true }; // linked to someone else: never switch accounts
      if (linked) return { userId: linked.user_id, created: false };
      const byEmail = email ? db.q.userByEmail.get(email) : null;
      if (linkUserId && byEmail && byEmail.id !== linkUserId) return { conflict: true };
      if (linkUserId && db.q.identitiesForUser.all(linkUserId).some((i) => i.provider === 'google')) return { conflict: true }; // one Google account per player
      let userId = linkUserId ?? byEmail?.id ?? null;
      let created = false;
      if (!userId) {
        userId = Number(db.q.insertEmailUser.run(suggestUsername(db, null), NO_PASSWORD, t, email, email ? t : null).lastInsertRowid);
        created = true;
      } else if (email && !byEmail && !db.q.userById.get(userId).email) {
        db.q.setEmail.run(email, t, userId); // a linked account without an email takes Google's
      }
      db.q.addIdentity.run('google', claims.sub, userId, email, t);
      return { userId, created };
    });
  }

  return {
    // "Connect Google" for a signed-in player: a one-time ticket from a CSRF-checked API call, so
    // another site cannot start a link by sending the player to /auth/google/start.
    linkTicket(userId) {
      prune();
      if (linkTickets.size >= MAX_FLOWS) return null;
      const ticket = random();
      linkTickets.set(ticket, { userId, created: now() });
      return ticket;
    },
    useLinkTicket(ticket) {
      const l = typeof ticket === 'string' ? linkTickets.get(ticket) : null;
      linkTickets.delete(ticket);
      return l && now() - l.created <= FLOW_TTL_MS ? l.userId : null;
    },

    // -> { location, state } | null when too many sign-ins are under way (new ones wait; the ones
    // already started are never pushed out)
    start({ linkUserId = null, appChallenge = null } = {}) {
      prune();
      if (flows.size >= MAX_FLOWS) return null;
      if (appChallenge !== null && !/^[\w-]{43}$/.test(appChallenge)) return null;
      const state = random();
      const verifier = random(48);
      const nonce = random();
      flows.set(state, { verifier, nonce, created: now(), linkUserId, appChallenge });
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: b64url(sha256(verifier)),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { location: `${AUTH_URL}?${params}`, state };
    },

    // -> { ok: true, userId, token, created } | { ok: false, reason }
    // `sessionUserId`: who is signed in on this browser now (a link must still be for them).
    async callback(req, query, sessionUserId = null) {
      const state = query.get('state') ?? '';
      const flow = flows.get(state);
      flows.delete(state); // one use
      if (!flow || now() - flow.created > FLOW_TTL_MS) return { ok: false, reason: 'expired' };
      if (flow.linkUserId && flow.linkUserId !== sessionUserId) return { ok: false, reason: 'expired' };
      const cookieState = readCookie(req, STATE_COOKIE);
      if (!cookieState || !crypto.timingSafeEqual(sha256(cookieState), sha256(state))) return { ok: false, reason: 'browser' };
      if (query.get('error')) return { ok: false, reason: 'cancelled' };
      const code = query.get('code');
      if (!code || code.length > 2048) return { ok: false, reason: 'bad' };
      let idToken;
      try {
        const res = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, reason: 'google' };
        idToken = (await res.json()).id_token;
      } catch {
        return { ok: false, reason: 'google' };
      }
      let claims;
      try {
        claims = verifyIdToken(idToken, { keys: await googleKeys(), clientId, nonce: flow.nonce, now: now() });
        if (!claims) claims = verifyIdToken(idToken, { keys: await googleKeys(true), clientId, nonce: flow.nonce, now: now() }); // keys rotate
      } catch {
        return { ok: false, reason: 'google' };
      }
      if (!claims) return { ok: false, reason: 'bad' };
      const found = resolve(claims, flow.linkUserId);
      if (found.conflict) return { ok: false, reason: 'taken' };
      if (flow.appChallenge) {
        if (appCodes.size >= MAX_FLOWS) return { ok: false, reason: 'busy' };
        const code = random();
        appCodes.set(sha256(code).toString('hex'), { userId: found.userId, challenge: flow.appChallenge, created: now(), isNew: found.created });
        return { ok: true, app: true, appCode: code };
      }
      return { ok: true, userId: found.userId, token: accounts.startSession(found.userId), created: found.created };
    },

    // The app trades its one-time code and PKCE verifier for a session. -> { userId, token, isNew } | null
    exchangeAppCode(code, verifier) {
      if (typeof code !== 'string' || typeof verifier !== 'string' || !/^[\w-]{43,128}$/.test(verifier)) return null;
      const key = sha256(code).toString('hex');
      const entry = appCodes.get(key);
      appCodes.delete(key); // one try, right or wrong
      if (!entry || now() - entry.created > APP_CODE_TTL_MS) return null;
      if (!crypto.timingSafeEqual(Buffer.from(b64url(sha256(verifier))), Buffer.from(entry.challenge))) return null;
      return { userId: entry.userId, token: accounts.startSession(entry.userId), isNew: entry.isNew };
    },

    stateCookie(state, secure) {
      return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=600${secure ? '; Secure' : ''}`;
    },
    clearStateCookie(secure) {
      return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}
