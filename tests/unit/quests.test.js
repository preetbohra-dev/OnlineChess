import test from 'node:test';
import assert from 'node:assert/strict';
import { weekKey, questsFor, advanceQuests, questView, QUEST_POOL, QUEST_XP } from '../../public/js/core/quests.js';
import { applyEvent, emptyProfile, currentStreak } from '../../public/js/core/progression.js';

const MON = new Date(2026, 9, 12, 10); // week of 2026-10-12: daily-5, rush-10, win-3

test('weeks start on Monday, local time', () => {
  assert.equal(weekKey(new Date(2026, 9, 12)), '2026-10-12');
  assert.equal(weekKey(new Date(2026, 9, 18, 23, 59)), '2026-10-12');
  assert.equal(weekKey(new Date(2026, 9, 19)), '2026-10-19');
  assert.equal(weekKey(new Date(2027, 0, 1)), '2026-12-28');
});

test('three distinct quests a week, the same for everyone, varying week to week', () => {
  const a = questsFor('2026-10-12').map((q) => q.id);
  assert.equal(new Set(a).size, 3);
  assert.deepEqual(questsFor('2026-10-12').map((q) => q.id), a);
  const weeks = new Set();
  for (let i = 0; i < 10; i++) weeks.add(questsFor(weekKey(new Date(2026, 9, 12 + 7 * i))).map((q) => q.id).join());
  assert.ok(weeks.size > 5);
  assert.ok(QUEST_POOL.every((q) => q.target >= 1 && q.text));
});

test('progress, completion XP, and a freeze once all three are done', () => {
  const win = { type: 'game', kind: 'bot', status: { over: true, winner: 'w', reason: 'checkmate' }, color: 'w', personaId: 'novice', plies: 60 };
  let state = null;
  let total = 0;
  let freezes = 0;
  const step = (e) => { const r = advanceQuests(state, e, MON); state = r.quests; total += r.xp; if (r.freezeEarned) freezes++; return r; };
  for (let i = 0; i < 3; i++) step(win);
  assert.equal(questView(state, MON).find((q) => q.id === 'win-3').done, true);
  step({ type: 'rush', score: 12 });
  for (let i = 0; i < 4; i++) step({ type: 'daily', fresh: true });
  assert.equal(freezes, 0);
  step({ type: 'daily', fresh: false }); // a repeat solve does not count
  assert.equal(freezes, 0);
  const last = step({ type: 'daily', fresh: true });
  assert.equal(last.freezeEarned, true);
  assert.equal(total, 3 * QUEST_XP);
  assert.equal(step({ type: 'daily', fresh: true }).freezeEarned, false, 'one freeze per week');
  // A new week starts fresh.
  assert.deepEqual(advanceQuests(state, { type: 'rush', score: 1 }, new Date(2026, 9, 19)).quests.progress, {});
});

test('a freeze keeps the daily streak alive over one missed day, then is used up', () => {
  let p = { ...emptyProfile(), freezes: 1, daily: { last: '2026-10-10', streak: 4, best: 4, solved: 4 } };
  assert.equal(currentStreak(p, '2026-10-12'), 4, 'one missed day, one freeze');
  assert.equal(currentStreak(p, '2026-10-13'), 0, 'two missed days, one freeze');
  const r = applyEvent(p, { type: 'daily', day: '2026-10-12' }, { now: new Date(2026, 11, 29) });
  assert.equal(r.freezeUsed, 1);
  assert.equal(r.profile.freezes, 0);
  assert.equal(r.profile.daily.streak, 5);
  p = { ...emptyProfile(), freezes: 2, daily: { last: '2026-10-10', streak: 4, best: 4, solved: 4 } };
  const gap = applyEvent(p, { type: 'daily', day: '2026-10-14' }, { now: new Date(2026, 11, 29) });
  assert.equal(gap.profile.daily.streak, 1, 'three missed days are too many');
  assert.equal(gap.profile.freezes, 2, 'freezes are kept when they cannot save the streak');
});

test('quest progress survives storage round trips and bad data is dropped', () => {
  const r = applyEvent(emptyProfile(), { type: 'rush', score: 11 }, { now: MON });
  assert.equal(r.quests[0]?.id, 'rush-10');
  assert.equal(r.xp, 22 + QUEST_XP);
  const back = applyEvent(JSON.parse(JSON.stringify({ ...r.profile, freezes: 9, quests: { week: 'x', progress: {} } })), { type: 'lesson' }, { now: MON });
  assert.equal(back.profile.freezes, 2);
});

test('instant resigns and other short games never advance quests; sync and clean events never do', () => {
  // The week of 2026-11-23 has coach-2, review-3 and online-1.
  const NOV = new Date(2026, 10, 24);
  const resign = { over: true, winner: 'b', reason: 'resign', result: '0-1' };
  let r = applyEvent(emptyProfile(), { type: 'game', kind: 'online', status: resign, color: 'w', plies: 2 }, { now: NOV });
  assert.deepEqual(r.quests, []);
  assert.equal(r.xp, 0);
  r = applyEvent(r.profile, { type: 'game', kind: 'online', status: resign, color: 'w', plies: 40 }, { now: NOV });
  assert.deepEqual(r.quests.map((q) => q.id), ['online-1']);
  for (const e of [{ type: 'sync', lessons: 50 }, { type: 'clean', personaId: 'novice' }, { type: 'lesson' }]) {
    assert.deepEqual(advanceQuests(null, e, NOV).quests.progress, {}, e.type);
  }
});
