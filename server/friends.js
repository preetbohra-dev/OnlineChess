// Friends: a permanent friend code per player, requests by code or exact name, and a friendship
// once the other player accepts. In the API a friend is named by code (or, before they have one,
// by name: codes are only made by their owner, never for someone else).
import crypto from 'node:crypto';
import { USERNAME } from './auth.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: easy to read out and type
export const FRIEND_CODE = /^OC-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const MAX_REQUESTS_PER_DAY = 20; // sent, counted in a log that cancelling does not undo
export const MAX_ASKS_PER_PERSON = 3; // to the same player in 30 days (after a decline, too)
export const MAX_FRIENDS = 200;
export const MAX_PENDING_INCOMING = 100;
const MAX_FAILED_LOOKUPS = 30; // per player per hour: codes cannot be guessed at speed
const DAY = 86_400_000;

export function newFriendCode() {
  let code = 'OC-';
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const fail = (status, error) => ({ ok: false, status, error });

export function createFriends({ db, now = () => Date.now() }) {
  const failedLookups = new Map(); // userId -> { count, since }

  // The player's own code, made on first use. A clash with another code is retried.
  function codeFor(userId) {
    const existing = db.q.friendCode.get(userId)?.friend_code;
    if (existing) return existing;
    for (let i = 0; i < 20; i++) {
      try {
        db.q.setFriendCode.run(newFriendCode(), userId);
      } catch (err) {
        if (!String(err.code ?? err.message).includes('CONSTRAINT')) throw err;
      }
      const code = db.q.friendCode.get(userId)?.friend_code;
      if (code) return code;
    }
    throw new Error('could not make a friend code');
  }

  // The other player, by { code } or { name }. Players hidden after reports cannot be found by
  // anyone who is not already connected to them. -> user row | null
  function find({ code, name } = {}, userId = null) {
    let row = null;
    if (typeof code === 'string' && code.trim()) {
      const c = code.trim().toUpperCase();
      row = FRIEND_CODE.test(c) ? db.q.userByFriendCode.get(c) ?? null : null;
    } else if (typeof name === 'string' && USERNAME.test(name.trim())) {
      row = db.q.userByName.get(name.trim()) ?? null;
    }
    if (row?.hidden && !(userId && db.q.friendship.get(...pair(userId, row.id)))) return null;
    return row;
  }
  const view = (row) => ({ username: row.username, code: row.friend_code ?? null });
  const asked = (body) => (typeof body?.code === 'string' && body.code.trim()) || (typeof body?.name === 'string' && body.name.trim());
  function lookupsLeft(userId) {
    const f = failedLookups.get(userId);
    if (!f || now() - f.since > 3_600_000) { failedLookups.delete(userId); return MAX_FAILED_LOOKUPS; }
    return MAX_FAILED_LOOKUPS - f.count;
  }
  function missed(userId) {
    const f = lookupsLeft(userId) === MAX_FAILED_LOOKUPS ? { count: 0, since: now() } : failedLookups.get(userId);
    f.count++;
    failedLookups.set(userId, f);
    while (failedLookups.size > 50_000) failedLookups.delete(failedLookups.keys().next().value);
  }
  const full = (id) => db.q.friendCount.get(id, id).n >= MAX_FRIENDS;

  return {
    codeFor,
    find,

    list(userId) {
      const out = { code: codeFor(userId), friends: [], incoming: [], outgoing: [] };
      for (const row of db.q.friendshipsOf.all(userId, userId, userId)) {
        if (row.status === 'accepted') out.friends.push({ ...view(row), id: row.id, since: row.accepted_at });
        else if (row.requested_by === userId) out.outgoing.push(view(row));
        else out.incoming.push(view(row));
      }
      for (const f of out.friends) delete f.id;
      return out;
    },

    // Ids of a player's friends (for the live channel).
    friendIds(userId) {
      return db.q.friendshipsOf.all(userId, userId, userId).filter((r) => r.status === 'accepted').map((r) => r.id);
    },

    // -> { ok, status: 'sent' | 'friends' | 'already', friend, otherId } | { ok: false, status, error }
    request(userId, body) {
      if (!asked(body)) return fail(400, 'Enter a friend code or a name.');
      if (lookupsLeft(userId) <= 0) return fail(429, 'Too many tries. Wait a while and check the code.');
      const other = find(body, userId);
      if (!other) { missed(userId); return fail(404, 'No player with that code or name.'); }
      if (other.id === userId) return fail(400, 'That is your own code.');
      codeFor(userId); // so the other player can answer by code
      const [lo, hi] = pair(userId, other.id);
      const t = now();
      return db.transaction(() => {
        const existing = db.q.friendship.get(lo, hi);
        const friend = view(other);
        if (existing?.status === 'accepted') return { ok: true, status: 'already', friend, otherId: other.id };
        if (existing && existing.requested_by === userId) return { ok: true, status: 'sent', friend, otherId: other.id };
        if (full(userId)) return fail(409, `You already have ${MAX_FRIENDS} friends.`);
        if (existing) { // they asked first: this is a yes
          if (full(other.id)) return fail(409, 'That player has as many friends as they can have.');
          db.q.acceptFriendship.run(t, lo, hi);
          return { ok: true, status: 'friends', friend, otherId: other.id };
        }
        if (db.q.requestsLoggedSince.get(userId, t - DAY).n >= MAX_REQUESTS_PER_DAY) return fail(429, 'That is a lot of friend requests for one day. Try again tomorrow.');
        if (db.q.requestsToSince.get(userId, other.id, t - 30 * DAY).n >= MAX_ASKS_PER_PERSON) return fail(429, 'You have asked this player several times lately. Wait for them to add you.');
        db.q.logFriendRequest.run(userId, other.id, t);
        // Too many requests waiting for them: recorded as sent, but they are not asked again.
        if (db.q.pendingIncoming.get(other.id, other.id, other.id).n >= MAX_PENDING_INCOMING) return { ok: true, status: 'sent', friend, otherId: null };
        db.q.addFriendship.run(lo, hi, userId, t);
        return { ok: true, status: 'sent', friend, otherId: other.id };
      });
    },

    // Accept a request someone sent you. -> { ok, friend, otherId } | { ok: false, status, error }
    accept(userId, body) {
      const other = find(body, userId);
      if (!other) return fail(404, 'There is no request from that player.');
      const [lo, hi] = pair(userId, other.id);
      return db.transaction(() => {
        const row = db.q.friendship.get(lo, hi);
        if (!row || row.status !== 'pending' || row.requested_by === userId) return fail(404, 'There is no request from that player.');
        if (full(userId)) return fail(409, `You already have ${MAX_FRIENDS} friends.`);
        if (full(other.id)) return fail(409, 'That player has as many friends as they can have.');
        if (db.q.acceptFriendship.run(now(), lo, hi).changes !== 1) return fail(409, 'That request changed. Look again.');
        return { ok: true, friend: view(other), otherId: other.id };
      });
    },

    // Decline a request, take back your own, or end a friendship: the pair is forgotten (the
    // request log is kept, so asking again still counts against the limits).
    remove(userId, body) {
      const other = find(body, userId);
      if (!other) return fail(404, 'No player with that code or name.');
      db.transaction(() => db.q.deleteFriendship.run(...pair(userId, other.id)));
      return { ok: true };
    },

    areFriends(a, b) {
      return db.q.friendship.get(...pair(a, b))?.status === 'accepted';
    },

    prune() {
      db.q.pruneFriendRequests.run(now() - 31 * DAY);
    },
  };
}
