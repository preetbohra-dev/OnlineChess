// Friends: a permanent friend code per player, requests by code or exact name, and a friendship
// once the other player accepts. Friends are named by their code in the API (names can change).
import crypto from 'node:crypto';
import { USERNAME } from './auth.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: easy to read out and type
export const FRIEND_CODE = /^OC-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const MAX_REQUESTS_PER_DAY = 20;
export const MAX_FRIENDS = 200;

export function newFriendCode() {
  let code = 'OC-';
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

const pair = (a, b) => (a < b ? [a, b] : [b, a]);

export function createFriends({ db, now = () => Date.now() }) {
  // The player's code, made on first use (a clash is retried; 31^6 codes).
  function codeFor(userId) {
    const existing = db.q.friendCode.get(userId)?.friend_code;
    if (existing) return existing;
    for (let i = 0; i < 20; i++) {
      try {
        if (db.q.setFriendCode.run(newFriendCode(), userId).changes === 1 || db.q.friendCode.get(userId)?.friend_code) break;
      } catch { /* the code was taken: try another */ }
    }
    return db.q.friendCode.get(userId)?.friend_code ?? null;
  }

  // The other player in a request: { code } or { name }. -> user row | null
  function find({ code, name } = {}) {
    if (typeof code === 'string' && code.trim()) {
      const c = code.trim().toUpperCase();
      return FRIEND_CODE.test(c) ? db.q.userByFriendCode.get(c) ?? null : null;
    }
    if (typeof name === 'string' && USERNAME.test(name.trim())) return db.q.userByName.get(name.trim()) ?? null;
    return null;
  }
  const view = (row) => ({ username: row.username, code: row.friend_code ?? codeFor(row.id) });
  const asked = (body) => (typeof body?.code === 'string' && body.code.trim()) || (typeof body?.name === 'string' && body.name.trim());

  return {
    codeFor,
    find,

    list(userId) {
      const out = { code: codeFor(userId), friends: [], incoming: [], outgoing: [] };
      for (const row of db.q.friendshipsOf.all(userId, userId, userId)) {
        if (row.status === 'accepted') out.friends.push({ ...view(row), since: row.accepted_at });
        else if (row.requested_by === userId) out.outgoing.push(view(row));
        else out.incoming.push(view(row));
      }
      return out;
    },

    // -> { ok, status: 'sent' | 'friends' | 'already', friend } | { ok: false, status, error }
    request(userId, body) {
      if (!asked(body)) return { ok: false, status: 400, error: 'Enter a friend code or a name.' };
      const other = find(body);
      if (!other) return { ok: false, status: 404, error: 'No player with that code or name.' };
      if (other.id === userId) return { ok: false, status: 400, error: 'That is your own code.' };
      const [lo, hi] = pair(userId, other.id);
      return db.transaction(() => {
        const existing = db.q.friendship.get(lo, hi);
        const friend = view(other);
        if (existing?.status === 'accepted') return { ok: true, status: 'already', friend };
        if (existing && existing.requested_by === userId) return { ok: true, status: 'sent', friend };
        if (db.q.friendCount.get(userId, userId).n >= MAX_FRIENDS) return { ok: false, status: 409, error: `You already have ${MAX_FRIENDS} friends.` };
        if (existing) { // they asked first: this is a yes
          db.q.acceptFriendship.run(now(), lo, hi);
          return { ok: true, status: 'friends', friend };
        }
        if (db.q.requestsSentSince.get(userId, now() - 86_400_000).n >= MAX_REQUESTS_PER_DAY) {
          return { ok: false, status: 429, error: 'That is a lot of friend requests for one day. Try again tomorrow.' };
        }
        db.q.addFriendship.run(lo, hi, userId, now());
        return { ok: true, status: 'sent', friend };
      });
    },

    // Accept a request someone sent you. -> { ok, friend } | { ok: false, status, error }
    accept(userId, body) {
      const other = find(body);
      const row = other ? db.q.friendship.get(...pair(userId, other.id)) : null;
      if (!row || row.status !== 'pending' || row.requested_by === userId) return { ok: false, status: 404, error: 'There is no request from that player.' };
      db.q.acceptFriendship.run(now(), ...pair(userId, other.id));
      return { ok: true, friend: view(other) };
    },

    // Decline a request, take back your own, or end a friendship: the pair is forgotten.
    remove(userId, body) {
      const other = find(body);
      if (!other) return { ok: false, status: 404, error: 'No player with that code.' };
      db.q.deleteFriendship.run(...pair(userId, other.id));
      return { ok: true };
    },

    areFriends(a, b) {
      return db.q.friendship.get(...pair(a, b))?.status === 'accepted';
    },
  };
}
