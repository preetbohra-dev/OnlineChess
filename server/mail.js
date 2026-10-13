// Outgoing email (sign-in links and codes, confirmations) through Resend's HTTPS API. No library:
// one JSON POST per email. The API key lives outside the repository, in the auth secrets file.
//   MAIL=dry keeps emails in memory (tests), MAIL=off sends nothing; otherwise live when a key exists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBucketMap, createTokenBucket } from './rate-limit.js';

export const DEFAULT_AUTH_ENV = path.join(os.homedir(), '.jodhpur-studio', 'secrets', 'chess-auth.env');
export const FROM = 'OnlineChess <no-reply@chess.solankidigitaldrafts.com>';
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;
const OUTBOX_MAX = 200;

// KEY=VALUE lines (# comments and anything else ignored). A missing file is empty.
export function loadAuthEnv(file = process.env.AUTH_ENV_FILE || DEFAULT_AUTH_ENV) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
  // Readable by others? Say so and fix it (the keys may already have been seen).
  try {
    if (fs.statSync(file).mode & 0o077) {
      console.warn(`${file} was readable by other users; it is now private. Consider replacing the keys in it.`);
      fs.chmodSync(file, 0o600);
    }
  } catch { /* best effort */ }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

// A practical check (not RFC 5322): plain ASCII, the usual characters before the @ (at most 64),
// dot-separated labels and a letter top-level domain after it. No commas, quotes, angle brackets,
// spaces or control characters, so an address can never smuggle a second recipient.
export function validEmail(s) {
  return typeof s === 'string' && s.length <= 254 && /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,63}$/.test(s);
}
export const normalizeEmail = (s) => String(s ?? '').trim().toLowerCase();

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2029">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font:600 20px Georgia,serif;margin:0 0 24px">♞ OnlineChess</p>
<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="color:#6b6f78;font-size:13px;margin-top:32px">If you did not ask for this, ignore this email: nothing happens without the link or code.</p>
</div></body></html>`;
}
const button = (link, label) => `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#2e8b66;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;

// Links in emails are always built by the server from its own base URL and a random token.
function checkLink(link) {
  if (typeof link !== 'string' || !/^https?:\/\/[^\s<>"']+$/.test(link)) throw new Error('bad link for an email');
}

// Sign in (also "forgot password"): a link for the browser and a code to type in the app.
// (The code is in the subject so it shows in notifications; it is useless without the inbox's
// own sign-in request.)
export function signInEmail({ code, link }) {
  checkLink(link);
  if (!/^\d{6}$/.test(String(code))) throw new Error('bad code for an email');
  return {
    subject: `${code} is your OnlineChess sign-in code`,
    text: `Your OnlineChess sign-in code is ${code}\n\nOr open this link to sign in:\n${link}\n\nThe code and link work once, for 15 minutes.\n`,
    html: layout('Sign in to OnlineChess', `<p>Your sign-in code:</p><p style="font:700 32px monospace;letter-spacing:6px;margin:8px 0">${escapeHtml(code)}</p>${button(link, 'Sign in')}<p style="color:#6b6f78;font-size:14px">The code and link work once, for 15 minutes.</p>`),
  };
}

// Confirm the address of a new account (or a changed email).
export function verifyEmail({ link }) {
  checkLink(link);
  return {
    subject: 'Confirm your email for OnlineChess',
    text: `Confirm your email address for OnlineChess:\n${link}\n\nThe link works for 24 hours.\n`,
    html: layout('Confirm your email', `<p>One tap to confirm this is your address, so you can always get back into your account.</p>${button(link, 'Confirm email')}<p style="color:#6b6f78;font-size:14px">The link works for 24 hours.</p>`),
  };
}

// How many sign-in and confirmation emails may go out per hour: to one inbox, from one network
// address, and in total (a cap on what an attacker could make us send, and on the free tier).
// The inbox limit is a cool-down (3 per 15 minutes), not a lock-out: the sign-in code and link
// already sent keep working, and password and Google sign-in never depend on it, so nobody can
// keep a player out by asking for emails to their address. `address` is an addressKey().
export function createMailLimits({ perInbox = 3, inboxWindowMs = 15 * 60_000, perAddress = 20, total = 300, now = () => Date.now() } = {}) {
  const perHour = (n) => ({ rate: n / 3600, burst: n, now });
  const inboxes = createBucketMap({ rate: perInbox / (inboxWindowMs / 1000), burst: perInbox, now });
  const addresses = createBucketMap(perHour(perAddress));
  const all = createTokenBucket(perHour(total));
  return {
    // All three are checked before any is used, so a refusal by one costs nothing in the others.
    take(inbox, address) {
      const key = normalizeEmail(inbox);
      const where = String(address);
      if (!inboxes.peek(key) || !addresses.peek(where) || !all.peek()) return false;
      return inboxes.take(key) && addresses.take(where) && all.take();
    },
  };
}

// -> { enabled, outbox, send({ to, subject, text, html }) -> Promise<{ ok, id } | { ok: false, error }> }
export function createMailer({ mode = process.env.MAIL, apiKey = '', from = FROM, fetchImpl = globalThis.fetch } = {}) {
  const dry = mode === 'dry';
  const enabled = dry || (mode !== 'off' && Boolean(apiKey));
  const outbox = [];
  return {
    enabled,
    outbox,
    async send({ to, subject, text, html }) {
      const recipient = normalizeEmail(to);
      if (!validEmail(recipient)) return { ok: false, error: 'bad recipient' };
      if (!enabled) return { ok: false, error: 'email is not set up' };
      if (dry) {
        outbox.push({ to: recipient, subject, text, html });
        while (outbox.length > OUTBOX_MAX) outbox.shift();
        return { ok: true, id: `dry_${outbox.length}` };
      }
      try {
        const res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [recipient], subject, text, html }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, error: `send failed (${res.status})` };
        const json = await res.json().catch(() => ({}));
        return { ok: true, id: json.id ?? null };
      } catch {
        return { ok: false, error: 'send failed (network)' };
      }
    },
  };
}
