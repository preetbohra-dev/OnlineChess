// Email accounts: sign up with an email (and a password if you like), sign in with a one-time
// link or 6-digit code, and reset a forgotten password with the same code. An email is stored on
// an account only once its owner has used a code or link sent to it.
//
// The rules (docs/PLAN-4.md §7): only hashes of links and codes are stored; codes expire after
// 15 minutes, are bound to their email and allow five wrong tries; every answer is the same
// whether or not the email has an account, and emails are sent in the background; using a link or
// code voids the others for that email.
import crypto from 'node:crypto';
import { validEmail, normalizeEmail, signInEmail, confirmEmail } from './mail.js';
import { USERNAME, PASSWORD_MIN, PASSWORD_MAX, hashPassword } from './auth.js';
import { nameProblem } from './names.js';

export const NO_PASSWORD = '!'; // pass_hash of an account without a password: no password matches it
export const CODE_TTL_MS = 15 * 60_000;
// Wrong codes per email per 15 minutes. Past that, codes typed for that email are refused until
// the window ends; nothing already sent is voided (so guessing cannot lock the owner out, and the
// emailed link, a password and Google keep working).
export const MAX_CODE_TRIES = 5;
const TRY_WINDOW_MS = 15 * 60_000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const codeHash = (tokenHash, code) => sha256(`${tokenHash}:${code}`);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// A free display name from an email or a provider's name: "Ana.Silva@x" -> "AnaSilva", then a
// number if it is taken or not allowed.
export function suggestUsername(db, seed) {
  const base = String(seed ?? '').split('@')[0].replace(/[^A-Za-z0-9_-]/g, '').slice(0, 14);
  const ok = (name) => USERNAME.test(name) && !nameProblem(name) && !db.q.userByName.get(name);
  if (base.length >= 3 && ok(base)) return base;
  const stem = base.length >= 3 && !nameProblem(base) ? base : 'player';
  for (let i = 0; i < 50; i++) {
    const name = `${stem}${crypto.randomInt(100, 100_000)}`.slice(0, 20);
    if (ok(name)) return name;
  }
  return `player${crypto.randomBytes(5).toString('hex')}`.slice(0, 20);
}

export function createEmailAuth({ db, accounts, mailer, mailLimits, origin, now = () => Date.now() }) {
  const failures = new Map(); // email -> { count, since }
  const triesLeft = (email) => {
    const f = failures.get(email);
    if (!f || now() - f.since > TRY_WINDOW_MS) { failures.delete(email); return MAX_CODE_TRIES; }
    return MAX_CODE_TRIES - f.count;
  };
  const failed = (email) => {
    const f = triesLeft(email) === MAX_CODE_TRIES ? { count: 0, since: now() } : failures.get(email);
    f.count++;
    failures.set(email, f);
    while (failures.size > 50_000) failures.delete(failures.keys().next().value);
  };

  // A new one-time link + code for an email, sent in the background. Never reports whether it was
  // sent: the caller always answers the same.
  function issue(email, purpose, { userId = null, payload = null, address }) {
    if (!mailLimits.take(email, address)) return; // a cool-down: codes already sent keep working
    const token = crypto.randomBytes(32).toString('base64url');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const th = sha256(token);
    const t = now();
    db.q.addEmailToken.run(th, codeHash(th, code), email, purpose, userId, payload === null ? null : JSON.stringify(payload), t, t + CODE_TTL_MS);
    const link = `${origin}/#/auth?t=${token}`;
    const message = purpose === 'signup' || purpose === 'addemail' ? confirmEmail({ code, link }) : signInEmail({ code, link });
    mailer.send({ to: email, ...message }).catch(() => {});
  }

  // The token for a link, or for a code typed for an email.
  function findByLink(token) {
    if (typeof token !== 'string' || !/^[\w-]{40,60}$/.test(token)) return null;
    return db.q.emailTokenByHash.get(sha256(token), now()) ?? null;
  }
  function findByCode(email, code) {
    if (!validEmail(email) || typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
    if (triesLeft(email) <= 0) return null;
    for (const row of db.q.activeEmailTokens.all(email, now(), Number.MAX_SAFE_INTEGER)) {
      if (sameHash(codeHash(row.token_hash, code), row.code_hash)) return row;
    }
    failed(email);
    return null;
  }

  // Uses a token: creates or finds the account it is for and signs in (a new session), and sets a
  // new password if one is given. -> { ok, user, token, created, suggestedName } | { ok: false, … }
  async function redeem(row, { password, sessionUser } = {}) {
    if (password !== undefined && (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
      return { ok: false, status: 400, error: `Passwords need ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.` };
    }
    if (row.purpose === 'addemail' && (!sessionUser || sessionUser.id !== row.user_id)) {
      return { ok: false, status: 403, error: 'Sign in to the account that asked for this first.' };
    }
    const newHash = password === undefined ? null : await hashPassword(password);
    const email = row.email;
    const t = now();
    let userId;
    let created = false;
    let suggestedName = false; // the server picked the name: the player may want to choose one
    // One transaction: claim the token (a second use finds nothing to claim), then the account
    // changes, so a failure leaves the token unused.
    let result;
    try { result = db.transaction(() => {
      if (db.q.useEmailToken.run(t, row.token_hash).changes !== 1) return { ok: false, status: 400, error: 'That code has already been used.' };
      if (row.purpose === 'addemail') {
        const owner = db.q.userByEmail.get(email);
        if (owner && owner.id !== row.user_id) throw Object.assign(new Error('taken'), { answer: { ok: false, status: 409, error: 'That email belongs to another account.' } });
        db.q.setEmail.run(email, t, row.user_id);
        userId = row.user_id;
      } else {
        const existing = db.q.userByEmail.get(email);
        if (existing) userId = existing.id;
        else {
          const pending = row.payload ? JSON.parse(row.payload) : {};
          const chosen = pending.username && !db.q.userByName.get(pending.username);
          // Never the email's own name: it would show on the public leaderboard.
          const name = chosen ? pending.username : suggestUsername(db, pending.username ?? null);
          suggestedName = !chosen;
          userId = Number(db.q.insertEmailUser.run(name, NO_PASSWORD, t, email, t).lastInsertRowid);
          created = true;
        }
      }
      db.q.voidEmailTokens.run(t, email);
      if (newHash) db.q.setPassword.run(newHash, userId);
      return null;
    }); } catch (err) { if (err.answer) return err.answer; throw err; }
    if (result) return result;
    const user = db.q.userById.get(userId);
    const token = row.purpose === 'addemail' ? null : accounts.startSession(userId);
    if (newHash && token) accounts.endOtherSessions(userId, token); // a reset signs out everywhere else
    return { ok: true, user: { id: user.id, username: user.username }, token, created, suggestedName };
  }

  return {
    // Sign up: always "check your email". A new email gets a confirmation code (the account is made
    // when it is used); an email that already has an account gets a sign-in code instead.
    // No password here: whoever confirms the email chooses it (with the code), so nobody can sign
    // up with someone else's address and a password of their own.
    signup({ email: raw, username }, address) {
      const email = normalizeEmail(raw);
      if (!validEmail(email)) return { ok: false, status: 400, error: 'Enter a valid email address.' };
      if (typeof username !== 'string' || !USERNAME.test(username)) return { ok: false, status: 400, error: 'Names are 3–20 letters, digits, - or _.' };
      if (nameProblem(username)) return { ok: false, status: 400, error: 'Please choose a different name.' };
      if (db.q.userByEmail.get(email)) issue(email, 'signin', { address });
      else issue(email, 'signup', { payload: { username }, address });
      return { ok: true };
    },

    // "Email me a sign-in code" (also the first step of "forgot password").
    request({ email: raw }, address) {
      const email = normalizeEmail(raw);
      if (!validEmail(email)) return { ok: false, status: 400, error: 'Enter a valid email address.' };
      issue(email, 'signin', { address });
      return { ok: true };
    },

    // A signed-in player adds or changes their email: a code goes to the new address. A session
    // alone is not enough (it may be a borrowed phone): the password, or for an account without
    // one a code sent to the current email.
    async addEmail(user, { email: raw, password, code }, address) {
      const email = normalizeEmail(raw);
      if (!validEmail(email)) return { ok: false, status: 400, error: 'Enter a valid email address.' };
      if (!(await this.proveOwner(user, { password, code }, address))) return { ok: false, status: 401, error: 'Confirm it is you: your password, or the code we emailed you.' };
      issue(email, 'addemail', { userId: user.id, address });
      return { ok: true };
    },

    // The password (if the account has one), else a sign-in code sent to the account's email.
    async proveOwner(user, { password, code }, address) {
      const row = db.q.userById.get(user.id);
      if (!row) return false;
      if (row.has_password) return (await accounts.checkPassword(user.id, password, address)).ok;
      return this.proveEmail(user, code);
    },

    async useCode({ email, code, password }, sessionUser) {
      const row = findByCode(normalizeEmail(email), code);
      if (!row) return { ok: false, status: 400, error: 'That code is wrong or has expired. Ask for a new one.' };
      return redeem(row, { password, sessionUser });
    },

    async useLink({ token, password }, sessionUser) {
      const row = findByLink(token);
      if (!row) return { ok: false, status: 400, error: 'That link has expired or was already used. Ask for a new one.' };
      return redeem(row, { password, sessionUser });
    },

    // A signed-in player proves they still read their email (to delete an account that has no
    // password): uses a sign-in code sent to the account's own email.
    proveEmail(user, code) {
      const email = db.q.userById.get(user.id)?.email;
      if (!email || typeof code !== 'string') return false;
      const row = findByCode(email, code);
      return Boolean(row) && row.purpose === 'signin' && db.q.useEmailToken.run(now(), row.token_hash).changes === 1;
    },

    prune() {
      return db.q.pruneEmailTokens.run(now() - 86_400_000).changes;
    },
  };
}
