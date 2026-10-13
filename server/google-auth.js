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

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const FLOW_TTL_MS = 10 * 60_000;
const MAX_FLOWS = 5_000;
const STATE_COOKIE = 'oc_google';
const TIMEOUT_MS = 10_000;

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

const readCookie = (req, name) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
};

export function createGoogleAuth({ db, accounts, clientId, clientSecret, origin, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const redirectUri = `${origin}/auth/google/callback`;
  const flows = new Map(); // state -> { verifier, nonce, created, linkUserId }
  let certs = { keys: [], until: 0 };

  async function googleKeys(force = false) {
    if (!force && certs.until > now() && certs.keys.length) return certs.keys;
    const res = await fetchImpl(CERTS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Google keys: ${res.status}`);
    const json = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    certs = { keys: Array.isArray(json.keys) ? json.keys : [], until: now() + Math.min(maxAge, 86_400) * 1000 };
    return certs.keys;
  }

  function prune() {
    const t = now();
    for (const [state, f] of flows) if (t - f.created > FLOW_TTL_MS) flows.delete(state);
    while (flows.size > MAX_FLOWS) flows.delete(flows.keys().next().value);
  }

  // The player for a Google account: already linked; else the signed-in player who asked to link
  // it (unless its verified email belongs to someone else); else the account with the same
  // Google-verified email; else a new account. -> { userId, created } | { conflict: true }
  function resolve(claims, linkUserId) {
    const email = claims.email_verified === true && validEmail(normalizeEmail(claims.email)) ? normalizeEmail(claims.email) : null;
    const t = now();
    return db.transaction(() => {
      const linked = db.q.identity.get('google', claims.sub);
      if (linked) return { userId: linked.user_id, created: false };
      const byEmail = email ? db.q.userByEmail.get(email) : null;
      if (linkUserId && byEmail && byEmail.id !== linkUserId) return { conflict: true };
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
    // -> { location, cookie }
    start({ linkUserId = null } = {}) {
      prune();
      const state = random();
      const verifier = random(48);
      const nonce = random();
      flows.set(state, { verifier, nonce, created: now(), linkUserId });
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
    async callback(req, query) {
      const state = query.get('state') ?? '';
      const flow = flows.get(state);
      flows.delete(state); // one use
      if (!flow || now() - flow.created > FLOW_TTL_MS) return { ok: false, reason: 'expired' };
      const cookieState = readCookie(req, STATE_COOKIE);
      if (!cookieState || cookieState.length !== state.length || !crypto.timingSafeEqual(Buffer.from(cookieState), Buffer.from(state))) return { ok: false, reason: 'browser' };
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
      return { ok: true, userId: found.userId, token: accounts.startSession(found.userId), created: found.created };
    },

    stateCookie(state, secure) {
      return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=600${secure ? '; Secure' : ''}`;
    },
    clearStateCookie(secure) {
      return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0${secure ? '; Secure' : ''}`;
    },
  };
}
