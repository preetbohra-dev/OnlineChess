import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, ACHIEVEMENTS, XP, rankFor, emptyProfile, normalizeProfile, applyEvent, dayKey, previousDay, currentStreak,
} from '../../public/js/core/progression.js';

const win = (winner, reason = 'checkmate') => ({ over: true, winner, reason, result: winner === 'w' ? '1-0' : '0-1' });
const draw = { over: true, winner: null, reason: 'stalemate', result: '1/2-1/2' };
const NOW = new Date(2026, 9, 11, 12);

test('ranks rise with XP and report progress to the next one', () => {
  assert.equal(rankFor(0).id, 'pawn');
  assert.equal(rankFor(149).id, 'pawn');
  assert.equal(rankFor(150).id, 'knight');
  assert.equal(rankFor(275).progress, 0.5);
  const top = rankFor(1e6);
  assert.equal(top.id, 'legend');
  assert.equal(top.next, null);
  assert.equal(top.progress, 1);
  assert.ok(RANKS.every((r, i) => i === 0 || r.min > RANKS[i - 1].min));
});

test('a bot win records the result, the streak, XP and achievements', () => {
  const r = applyEvent(emptyProfile(), { type: 'game', kind: 'bot', status: win('w'), color: 'w', personaId: 'amateur' }, { now: NOW });
  assert.equal(r.xp, 40);
  assert.deepEqual(r.profile.bots.amateur, { w: 1, d: 0, l: 0, streak: 1, best: 1 });
  assert.equal(r.profile.games.won, 1);
  assert.equal(r.profile.games.mates, 1);
  assert.deepEqual(r.unlocked.map((a) => a.id).sort(), ['beat-amateur', 'checkmate', 'first-win']);
  // A second win unlocks nothing new; a loss resets the streak but keeps the best.
  const again = applyEvent(r.profile, { type: 'game', kind: 'bot', status: win('w', 'resign'), color: 'w', personaId: 'amateur' }, { now: NOW });
  assert.deepEqual(again.unlocked, []);
  const lost = applyEvent(again.profile, { type: 'game', kind: 'bot', status: win('b'), color: 'w', personaId: 'amateur' }, { now: NOW });
  assert.deepEqual(lost.profile.bots.amateur, { w: 2, d: 0, l: 1, streak: 0, best: 2 });
  assert.equal(lost.xp, XP.botLoss);
});

test('three wins in a row against one opponent is a hat-trick', () => {
  let p = emptyProfile();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = applyEvent(p, { type: 'game', kind: 'bot', status: win('b'), color: 'b', personaId: 'novice' }, { now: NOW });
    p = r.profile;
    ids.push(...r.unlocked.map((a) => a.id));
  }
  assert.ok(ids.includes('hat-trick'));
});

test('draws give half XP; pass-and-play counts a game but no result', () => {
  const d = applyEvent(emptyProfile(), { type: 'game', kind: 'bot', status: draw, color: 'w', personaId: 'pro' }, { now: NOW });
  assert.equal(d.xp, 35);
  assert.equal(d.profile.games.drawn, 1);
  const local = applyEvent(emptyProfile(), { type: 'game', kind: 'local', status: win('w'), color: null }, { now: NOW });
  assert.equal(local.xp, XP.local);
  assert.equal(local.profile.games.played, 1);
  assert.equal(local.profile.games.won, 0);
  assert.deepEqual(local.unlocked, []);
});

test('online and coached games', () => {
  const o = applyEvent(emptyProfile(), { type: 'game', kind: 'online', status: win('b', 'resign'), color: 'b' }, { now: NOW });
  assert.equal(o.xp, 30);
  assert.ok(o.unlocked.some((a) => a.id === 'online-win'));
  const t = applyEvent(emptyProfile(), { type: 'game', kind: 'training', status: win('b'), color: 'w', accuracy: 92 }, { now: NOW });
  assert.equal(t.xp, 15 + 18);
  assert.ok(t.unlocked.some((a) => a.id === 'sharp-eye'));
});

test('very short games earn no XP and no accuracy credit, unless they end in checkmate', () => {
  const resign = { over: true, winner: 'b', reason: 'resign', result: '0-1' };
  const t = applyEvent(emptyProfile(), { type: 'game', kind: 'training', status: resign, color: 'w', accuracy: 95, plies: 3 }, { now: NOW });
  assert.equal(t.xp, 0);
  assert.equal(t.profile.training.bestAccuracy, 0);
  assert.ok(!t.unlocked.some((a) => a.id === 'sharp-eye'));
  const local = applyEvent(emptyProfile(), { type: 'game', kind: 'local', status: resign, color: null, plies: 2 }, { now: NOW });
  assert.equal(local.xp, 0);
  const quickMate = applyEvent(emptyProfile(), { type: 'game', kind: 'bot', status: win('w'), color: 'w', personaId: 'novice', plies: 7 }, { now: NOW });
  assert.equal(quickMate.xp, 20);
  const longGame = applyEvent(emptyProfile(), { type: 'game', kind: 'local', status: resign, color: null, plies: 40 }, { now: NOW });
  assert.equal(longGame.xp, XP.local);
});

test('lessons and openings count toward their achievements', () => {
  let p = emptyProfile();
  for (let i = 0; i < 10; i++) p = applyEvent(p, { type: 'lesson' }, { now: NOW }).profile;
  assert.ok(p.achievements.student);
  assert.equal(p.xp, 250);
  for (let i = 0; i < 5; i++) p = applyEvent(p, { type: 'opening' }, { now: NOW }).profile;
  assert.ok(p.achievements['opening-buff']);
});

test('daily puzzle: one reward per day, streaks grow on consecutive days and reset after a gap', () => {
  let r = applyEvent(emptyProfile(), { type: 'daily', day: '2026-10-09' });
  assert.equal(r.xp, 30);
  assert.equal(r.profile.daily.streak, 1);
  const same = applyEvent(r.profile, { type: 'daily', day: '2026-10-09' });
  assert.equal(same.xp, 0);
  r = applyEvent(r.profile, { type: 'daily', day: '2026-10-10' });
  r = applyEvent(r.profile, { type: 'daily', day: '2026-10-11' });
  assert.equal(r.profile.daily.streak, 3);
  assert.equal(r.xp, 30 + 2 * 5);
  assert.ok(r.unlocked.some((a) => a.id === 'streak-3'));
  r = applyEvent(r.profile, { type: 'daily', day: '2026-10-14' });
  assert.equal(r.profile.daily.streak, 1);
  assert.equal(r.profile.daily.best, 3);
  // A clock moved backwards earns nothing and changes nothing.
  const back = applyEvent(r.profile, { type: 'daily', day: '2026-10-01' });
  assert.equal(back.xp, 0);
  assert.equal(back.profile.daily.last, '2026-10-14');
});

test('the current streak lapses after a missed day', () => {
  const p = { ...emptyProfile(), daily: { last: '2026-10-10', streak: 4, best: 4, solved: 4 } };
  assert.equal(currentStreak(p, '2026-10-10'), 4);
  assert.equal(currentStreak(p, '2026-10-11'), 4);
  assert.equal(currentStreak(p, '2026-10-12'), 0);
});

test('date helpers cross month and year boundaries', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
});

test('a rank-up is reported once', () => {
  const p = { ...emptyProfile(), xp: 140 };
  const r = applyEvent(p, { type: 'lesson' }, { now: NOW });
  assert.equal(r.rankUp.id, 'knight');
  assert.equal(applyEvent(r.profile, { type: 'lesson' }, { now: NOW }).rankUp, null);
});

test('damaged or old profiles are repaired, not trusted', () => {
  const p = normalizeProfile({ xp: -5, games: { won: 'x' }, bots: { amateur: { w: 2 }, '<script>': { w: 1 } }, achievements: { 'first-win': '2026-01-01', bogus: 'x' }, daily: { last: 'nope', streak: 2 } });
  assert.equal(p.xp, 0);
  assert.equal(p.games.won, 0);
  assert.deepEqual(p.bots.amateur, { w: 2, d: 0, l: 0, streak: 0, best: 0 });
  assert.equal(p.bots['<script>'], undefined);
  assert.deepEqual(Object.keys(p.achievements), ['first-win']);
  assert.equal(p.daily.last, null);
  assert.deepEqual(normalizeProfile(null), emptyProfile());
});

test('achievement ids are unique and there are at least twelve', () => {
  assert.ok(ACHIEVEMENTS.length >= 12);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});
