// Accounts: username + password, scrypt hashes, random session tokens stored as SHA-256 hashes.
// All checks run in constant time where secrets are compared; errors never reveal whether a
// username exists.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const SESSION_DAYS = 30;
export const MAX_SESSIONS_PER_USER = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
// Lockout: 5 failed attempts from one address against one account within 15 minutes lock that
// address out of that account for 15 minutes. (Per address, so nobody can lock others out.)
const LOCK_AFTER = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 50_000;

// A short list of the most common passwords (all ten characters or longer).
const COMMON = new Set([
  '1234567890', '0123456789', 'qwertyuiop', 'password1234', 'password123', 'passwordpassword', '1q2w3e4r5t',
  'qwerty12345', 'iloveyou123', 'abcdefghij', 'abcd123456', '1111111111', '0000000000', 'aaaaaaaaaa', 'chesschess',
  'chess12345', 'onlinechess', 'checkmate1', 'letmein123', 'welcome123', 'football12', 'qwertyuiop1', 'asdfghjkl1',
  'zxcvbnm123', '9876543210', 'superman12', 'administrator', 'princess12', 'trustno1234', 'sunshine12',
]);

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME.test(username)) return 'Usernames are 3–20 letters, digits, - or _.';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  if (password.toLowerCase().includes(username.toLowerCase())) return 'Your password must not contain your username.';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common — pick something harder to guess.';
  return null;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A hash that verifyPassword can run against when the username does not exist, so a login for an
// unknown user takes as long as one for a real user.
let dummyHash = null;
const dummy = async () => (dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex')));

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createAccounts(db, { now = () => Date.now() } = {}) {
  const attempts = new Map(); // `${userId}|${address}` -> { count, first, lockedUntil }
  function attemptRecord(key) {
    let rec = attempts.get(key);
    const t = now();
    if (!rec || (rec.lockedUntil < t && t - rec.first > LOCK_WINDOW_MS)) rec = { count: 0, first: t, lockedUntil: 0 };
    attempts.delete(key);
    attempts.set(key, rec);
    while (attempts.size > MAX_TRACKED) attempts.delete(attempts.keys().next().value);
    return rec;
  }

  function newSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const created = now();
    db.transaction(() => {
      while (db.q.countUserSessions.get(userId).n >= MAX_SESSIONS_PER_USER) db.q.oldestUserSession.run(userId);
      db.q.insertSession.run(tokenHash(token), userId, created, created + SESSION_DAYS * 86_400_000);
    });
    return token;
  }

  return {
    // -> { ok: true, user, token } | { ok: false, status, error }
    async register(username, password) {
      const problem = validateCredentials(username, password);
      if (problem) return { ok: false, status: 400, error: problem };
      if (db.q.userByName.get(username)) return { ok: false, status: 409, error: 'That username is taken.' };
      const hash = await hashPassword(password);
      let id;
      try {
        id = Number(db.q.insertUser.run(username, hash, now()).lastInsertRowid);
      } catch {
        return { ok: false, status: 409, error: 'That username is taken.' };
      }
      return { ok: true, user: { id, username }, token: newSession(id) };
    },

    // The answer is the same — and takes as long — for an unknown user, a wrong password and a
    // locked-out address. Attempts are counted before the (slow) check, so parallel guesses count.
    async login(username, password, address = 'local') {
      const generic = { ok: false, status: 401, error: 'Wrong username or password.' };
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > PASSWORD_MAX) return generic;
      const user = USERNAME.test(username) ? db.q.userByName.get(username) : null;
      if (!user) { await verifyPassword(password, await dummy()); return generic; }
      const key = `${user.id}|${address}`;
      const rec = attemptRecord(key);
      if (rec.lockedUntil > now()) { await verifyPassword(password, await dummy()); return generic; }
      rec.count++;
      if (rec.count >= LOCK_AFTER) rec.lockedUntil = now() + LOCK_WINDOW_MS;
      if (!(await verifyPassword(password, user.pass_hash))) return generic;
      attempts.delete(key);
      return { ok: true, user: { id: user.id, username: user.username }, token: newSession(user.id) };
    },

    // The signed-in user for a session token, or null (expired sessions are removed).
    userForToken(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
      const row = db.q.session.get(tokenHash(token));
      if (!row) return null;
      if (row.expires_at < now()) { db.q.deleteSession.run(tokenHash(token)); return null; }
      return { id: row.user_id, username: row.username };
    },

    logout(token) {
      if (typeof token === 'string') db.q.deleteSession.run(tokenHash(token));
    },

    pruneSessions() {
      return db.q.deleteExpired.run(now()).changes;
    },

    // Admin: set a new password (and sign the user out everywhere), or delete the account.
    async resetPassword(username, password) {
      const user = db.q.userByName.get(username);
      if (!user) return false;
      const problem = validateCredentials(user.username, password);
      if (problem) throw new Error(problem);
      db.q.setPassword.run(await hashPassword(password), user.id);
      db.q.deleteUserSessions.run(user.id);
      return true;
    },
    deleteUser(username) {
      const user = db.q.userByName.get(username);
      return user ? db.q.deleteUser.run(user.id).changes === 1 : false;
    },
  };
}
