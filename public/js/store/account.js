// The signed-in account (optional) and cloud sync of progress. Guests keep everything on this
// device; signing in adds this device's progress to the account, and every later change syncs
// a few seconds after it happens. Sync is one request: the server merges and returns the result.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';
import { SYNC_KEYS, mergeStates } from '../core/sync.js';
import { emptyProfile } from '../core/progression.js';
import { currentSubscription } from '../ui/reminders.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-OC-Request': '1' };
const SYNC_DELAY_MS = 4000;
let current; // undefined while unknown, null when signed out, { username } when signed in
let lastSync = null;
let timer = null;
let syncing = null;

export const currentUser = () => current ?? null;
export const lastSynced = () => lastSync;

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body === undefined ? { 'X-OC-Request': '1' } : HEADERS, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function setUser(user) {
  current = user;
  bus.emit('account:change', { user });
}

export async function refreshMe() {
  try {
    const r = await api('GET', '/api/me');
    setUser(r.ok ? r.json.user : null);
  } catch {
    setUser(current ?? null); // offline: keep what we had
  }
  return current;
}

async function signIn(path, username, password, store) {
  let r;
  try {
    r = await api('POST', path, { username, password });
  } catch {
    return { ok: false, error: 'No connection. Try again when you are online.' };
  }
  if (!r.ok) return { ok: false, error: r.json.error ?? 'Something went wrong.' };
  setUser(r.json.user);
  await syncNow(store);
  return { ok: true };
}

export const register = (username, password, store = appStore()) => signIn('/api/register', username, password, store);
export const login = (username, password, store = appStore()) => signIn('/api/login', username, password, store);

export async function logout() {
  try { await api('POST', '/api/logout', {}); } catch { /* signed out locally anyway */ }
  lastSync = null;
  setUser(null); // this device keeps its progress
}

// Delete the account (the password confirms it). This device keeps its progress unless
// `clearDevice` is set, which also removes the synced keys stored here.
export async function deleteAccount(password, { clearDevice = false, store = appStore() } = {}) {
  let r;
  try {
    r = await api('POST', '/api/account/delete', { password });
  } catch {
    return { ok: false, error: 'No connection. Try again when you are online.' };
  }
  if (!r.ok) return { ok: false, error: r.json.error ?? 'Something went wrong.' };
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
