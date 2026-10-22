// The signed-in account (optional) and cloud sync of progress. Guests keep everything on this
// device; signing in adds this device's progress to the account, and every later change syncs
// a few seconds after it happens. Sync is one request: the server merges and returns the result.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';
import { SYNC_KEYS, mergeStates } from '../core/sync.js';
import { emptyProfile } from '../core/progression.js';
import { apiFetch } from '../net/api.js';
import { currentSubscription } from '../ui/reminders.js';

const SYNC_DELAY_MS = 4000;
let current; // undefined while unknown, null when signed out, { username } when signed in
let lastSync = null;
let timer = null;
let syncing = null;

export const currentUser = () => current ?? null;
export const lastSynced = () => lastSync;

async function api(method, path, body) {
  const res = await apiFetch(path, { method, body });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function setUser(user) {
  current = user;
  if (!user) justCreated = false;
  bus.emit('account:change', { user });
}

export async function refreshMe() {
  try {
    const r = await api('GET', '/api/me');
    // Only a real answer counts: a server error (say, during a restart) must not sign the app out.
    setUser(r.ok ? r.json.user : current ?? null);
  } catch {
    setUser(current ?? null); // offline: keep what we had
  }
  return current;
}

const OFFLINE = { ok: false, error: 'No connection. Try again when you are online.' };

// A request that does not sign in. -> { ok: true, json } | { ok: false, error }
async function ask(method, path, body) {
  let r;
  try { r = await api(method, path, body); } catch { return OFFLINE; }
  return r.ok ? { ok: true, json: r.json } : { ok: false, status: r.status, error: r.json.error ?? 'Something went wrong.' };
}

// Set when a sign-in created an account and picked its name, so the page offers to choose one
// (until the player saves a name or keeps this one; the page may redraw several times meanwhile).
let justCreated = false;
export const nameWanted = () => justCreated && Boolean(current);
// After "Continue with Google" made a new account (the server says so on the way back).
export function markNameWanted() { justCreated = true; }
export function nameChosen() { justCreated = false; }

// A request that signs in when it succeeds (the server sets the session cookie).
async function signIn(path, body, store) {
  const r = await ask('POST', path, body);
  if (!r.ok) return r;
  if (r.json.emailAdded) return { ok: true, emailAdded: true };
  justCreated = Boolean(r.json.suggestedName);
  setUser(r.json.user); // pages redraw here
  await syncNow(store);
  return { ok: true, created: Boolean(r.json.created) };
}

// `username` may be the account's email.
export const login = (username, password, store = appStore()) => signIn('/api/login', { username, password }, store);

// Email accounts. Sign-up and code requests always answer "check your email".
export const signUpWithEmail = (email, username) => ask('POST', '/api/signup', { email, username });
export const requestCode = (email) => ask('POST', '/api/auth/request', { email });
export const useCode = (email, code, password, store = appStore()) => signIn('/api/auth/code', { email, code, ...(password ? { password } : {}) }, store);
export const useLink = (token, store = appStore()) => signIn('/api/auth/link', { token }, store);
// `proof`: { password } or { code } (a code sent to the account's current email).
export const addEmail = (email, proof = {}) => ask('POST', '/api/account/email', { email, ...proof });
export const loadAccount = () => ask('GET', '/api/account');
// "Connect Google": the server gives a one-time address to go to.
export const googleLinkUrl = () => ask('POST', '/api/auth/google/link', {});
// Which ways of signing in the server offers: { email, google }. Asked once per page load.
let providers = null;
export function loadProviders() {
  providers ??= ask('GET', '/api/auth/providers').then((r) => {
    if (!r.ok) providers = null; // offline or a hiccup: ask again next time
    return r.ok ? r.json : { email: false, google: false };
  });
  return providers;
}
export const changePassword = (current, password, code) => ask('POST', '/api/account/password', { password, ...(code ? { code } : { current }) });
export async function rename(username) {
  const r = await ask('POST', '/api/account/name', { username });
  if (r.ok) { justCreated = false; setUser(r.json.user); }
  return r;
}

export async function logout() {
  try { await api('POST', '/api/logout', {}); } catch { /* signed out locally anyway */ }
  lastSync = null;
  setUser(null); // this device keeps its progress
}

// Delete the account, confirmed with the password (or, for an account without one, a code sent
// to its email: `{ code }`). This device keeps its progress unless `clearDevice` is set, which also
// removes the synced keys stored here.
export async function deleteAccount(password, { code, clearDevice = false, store = appStore() } = {}) {
  const r = await ask('POST', '/api/account/delete', code ? { code } : { password });
  if (!r.ok) return r;
  clearTimeout(timer);
  lastSync = null;
  // The server forgot this device's reminder subscription; drop it in the browser too.
  try { await (await currentSubscription())?.unsubscribe(); } catch { /* reminders unsupported here */ }
  if (clearDevice) for (const k of SYNC_KEYS) store.remove(k);
  setUser(null);
  if (clearDevice) bus.emit('profile:change', { profile: emptyProfile(), xp: 0, unlocked: [], rankUp: null, event: { type: 'reset' } });
  return { ok: true };
}

// Send this device's progress, receive the account's merged progress, and store it here.
export function syncNow(store = appStore()) {
  if (!current) return Promise.resolve(false);
  syncing ??= (async () => {
    const local = Object.fromEntries(SYNC_KEYS.map((k) => [k, store.get(k, null)]));
    // Game reviews stay on this device (they are large and can be recomputed anywhere).
    if (Array.isArray(local.games)) local.games = local.games.map(({ review, ...g }) => g);
    try {
      const r = await api('PUT', '/api/state', { state: local });
      if (r.status === 401) { setUser(null); return false; }
      if (!r.ok) return false;
      // Merge again locally, so anything that changed here during the request is kept too.
      const now = Object.fromEntries(SYNC_KEYS.map((k) => [k, store.get(k, null)]));
      const merged = mergeStates(r.json.state, now);
      // Reviews are not synced: keep the ones this device has.
      const reviews = new Map((now.games ?? []).filter((g) => g?.review).map((g) => [g.id, g.review]));
      merged.games = merged.games.map((g) => (reviews.has(g.id) ? { ...g, review: reviews.get(g.id) } : g));
      for (const k of SYNC_KEYS) store.set(k, merged[k]);
      lastSync = new Date();
      bus.emit('account:synced', { at: lastSync });
      return true;
    } catch {
      return false; // offline: try again after the next change
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

function scheduleSync() {
  if (!current) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), SYNC_DELAY_MS);
}

// Start-up: find out who is signed in, sync once, then sync after every change worth keeping.
export function trackSync() {
  const events = ['profile:change', 'lesson:complete', 'opening:complete', 'puzzle:result', 'rush:end', 'weakspot:answered', 'game:end', 'game:reviewed'];
  const offs = events.map((e) => bus.on(e, scheduleSync));
  refreshMe().then((user) => { if (user) syncNow(); });
  return () => offs.forEach((off) => off());
}
