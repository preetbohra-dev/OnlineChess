// Challenges between friends: one player asks, the other accepts within 15 minutes, and the server
// opens a game room with both seats reserved (rooms.reserve) and hands each player their seat over
// the live channel. Kept in memory: a challenge lives a quarter of an hour, and a restart only
// drops the ones still waiting.
import crypto from 'node:crypto';
import { TIME_CONTROLS } from '../public/js/core/clock.js';

export const CHALLENGE_TTL_MS = 15 * 60_000;
export const MAX_CHALLENGES_PER_HOUR = 10;
const READY_TTL_MS = 10 * 60_000; // an accepted game stays listed for the challenger this long
const TC_IDS = new Set(TIME_CONTROLS.map((t) => t.id)); // the same choices as online rooms
const COLORS = ['w', 'b', 'random'];

export function createFriendChallenges({ db, friends, rooms, live, onAway = null, now = () => Date.now() }) {
  const challenges = new Map(); // id -> { id, from, to, tc, color, created, expires, status, game }
  const sentAt = new Map(); // userId -> recent send times

  const codeOf = (id) => friends.codeFor(id);
  const nameOf = (id) => db.q.userById.get(id)?.username ?? 'Player';
  const view = (c, userId) => ({
    id: c.id,
    tc: c.tc,
    color: c.color,
    expiresAt: c.expires,
    status: c.status,
    with: { username: nameOf(c.from === userId ? c.to : c.from), code: codeOf(c.from === userId ? c.to : c.from) },
    ...(c.game ? { game: c.game[userId === c.from ? 'from' : 'to'] } : {}),
  });

  function prune() {
    const t = now();
    for (const [id, c] of challenges) {
      if (c.status === 'pending' && c.expires <= t) {
        challenges.delete(id);
        live?.notify(c.from, { type: 'notice', kind: 'challenge-expired', id, with: { username: nameOf(c.to), code: codeOf(c.to) } });
      } else if (c.status === 'accepted' && t - c.answered > READY_TTL_MS) challenges.delete(id);
    }
  }
  const openBetween = (a, b) => [...challenges.values()].find((c) => c.status === 'pending' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
  const fail = (status, error) => ({ ok: false, status, error });

  return {
    prune,

    // -> { ok, challenge } | { ok: false, status, error }
    create(userId, { code, tc = 'none', color = 'random' } = {}) {
      prune();
      if (!TC_IDS.has(tc) || !COLORS.includes(color)) return fail(400, 'Choose a time control and a colour.');
      const other = friends.find({ code }, userId);
      if (!other || !friends.areFriends(userId, other.id)) return fail(404, 'You can challenge your friends only.');
      if (openBetween(userId, other.id)) return fail(409, 'There is already a challenge between you two. Answer or cancel it first.');
      const recent = (sentAt.get(userId) ?? []).filter((t) => now() - t < 3_600_000);
      if (recent.length >= MAX_CHALLENGES_PER_HOUR) return fail(429, 'That is a lot of challenges for one hour. Try again later.');
      sentAt.set(userId, [...recent, now()]);
      if (sentAt.size > 50_000) sentAt.delete(sentAt.keys().next().value);
      const c = { id: crypto.randomBytes(12).toString('base64url'), from: userId, to: other.id, tc, color, created: now(), expires: now() + CHALLENGE_TTL_MS, status: 'pending', game: null };
      challenges.set(c.id, c);
      const notice = { type: 'notice', kind: 'challenge', challenge: view(c, other.id) };
      if (live?.hasConnection(other.id)) live.notify(other.id, notice);
      else onAway?.(c, { fromName: nameOf(userId), toId: other.id });
      return { ok: true, challenge: view(c, userId) };
    },

    // The player's challenges: waiting for them, sent by them, and games ready to open.
    list(userId) {
      prune();
      const mine = [...challenges.values()].filter((c) => c.from === userId || c.to === userId);
      return {
        incoming: mine.filter((c) => c.status === 'pending' && c.to === userId).map((c) => view(c, userId)),
        outgoing: mine.filter((c) => c.status === 'pending' && c.from === userId).map((c) => view(c, userId)),
        ready: mine.filter((c) => c.status === 'accepted').map((c) => view(c, userId)),
      };
    },

    // The challenged player says yes or no. Yes opens the game for both.
    answer(userId, { id, accept } = {}) {
      prune();
      const c = typeof id === 'string' ? challenges.get(id) : null;
      if (!c || c.to !== userId || c.status !== 'pending') return fail(404, 'That challenge is no longer open.');
      if (typeof accept !== 'boolean') return fail(400, 'Bad request.');
      if (!accept) {
        challenges.delete(c.id);
        live?.notify(c.from, { type: 'notice', kind: 'challenge-declined', id: c.id, with: { username: nameOf(c.to), code: codeOf(c.to) } });
        return { ok: true };
      }
      if (!friends.areFriends(c.from, c.to)) { challenges.delete(c.id); return fail(404, 'You are no longer friends.'); }
      const fromColor = c.color === 'random' ? (crypto.randomInt(2) ? 'w' : 'b') : c.color;
      const toColor = fromColor === 'w' ? 'b' : 'w';
      const names = { [fromColor]: nameOf(c.from), [toColor]: nameOf(c.to) };
      const room = rooms.reserve({ tc: c.tc, names });
      if (!room) return fail(503, 'The server is busy. Try again in a moment.');
      c.status = 'accepted';
      c.answered = now();
      c.game = {
        from: { room: room.room, token: room.seats[fromColor], color: fromColor },
        to: { room: room.room, token: room.seats[toColor], color: toColor },
      };
      live?.notify(c.from, { type: 'notice', kind: 'game-ready', challenge: view(c, c.from) });
      live?.notify(c.to, { type: 'notice', kind: 'game-ready', challenge: view(c, c.to) });
      return { ok: true, challenge: view(c, userId) };
    },

    // The challenger takes it back.
    cancel(userId, { id } = {}) {
      const c = typeof id === 'string' ? challenges.get(id) : null;
      if (!c || c.from !== userId || c.status !== 'pending') return fail(404, 'That challenge is no longer open.');
      challenges.delete(c.id);
      live?.notify(c.to, { type: 'notice', kind: 'challenge-cancelled', id: c.id });
      return { ok: true };
    },

    // Friends removed or an account deleted: their open challenges go.
    forget(a, b) {
      for (const [id, c] of challenges) if ((c.from === a && (b == null || c.to === b)) || (c.to === a && (b == null || c.from === b))) challenges.delete(id);
    },
  };
}
