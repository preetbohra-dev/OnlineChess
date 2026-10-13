// Friends, client side: the list, requests by friend code or exact name, accept, decline, remove.
import { apiFetch } from '../net/api.js';
import { bus } from '../core/events.js';

async function call(method, path, body) {
  try {
    const res = await apiFetch(path, { method, body });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, json } : { ok: false, status: res.status, error: json.error ?? 'Something went wrong.' };
  } catch {
    return { ok: false, status: 0, error: 'No connection. Try again when you are online.' };
  }
}
const changed = (r) => { if (r.ok) bus.emit('friends:change', {}); return r; };

export const loadFriends = () => call('GET', '/api/friends');
// `who`: a friend code (OC-…) or a display name.
export const requestFriend = (who) => {
  const text = String(who ?? '').trim();
  return call('POST', '/api/friends/request', /^oc-/i.test(text) ? { code: text } : { name: text }).then(changed);
};
// `friend`: an entry from the list ({ username, code }); named by code, or by name before they have one.
const named = (f) => (f.code ? { code: f.code } : { name: f.username });
export const acceptFriend = (f) => call('POST', '/api/friends/accept', named(f)).then(changed);
export const declineFriend = (f) => call('POST', '/api/friends/decline', named(f)).then(changed);
export const removeFriend = (f) => call('POST', '/api/friends/remove', named(f)).then(changed);

// Show or hide your online status; get challenge emails while away (true/false; omit to keep).
export const setPresence = (settings) => call('POST', '/api/account/presence', settings);
