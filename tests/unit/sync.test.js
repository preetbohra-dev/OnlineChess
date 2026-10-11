import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, normalizeState } from '../../public/js/core/sync.js';
import { emptyProfile } from '../../public/js/core/progression.js';
import { makeCard } from '../../public/js/core/weakspots.js';
import { START_FEN } from '../../public/js/core/rules.js';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
const game = (id, date, extra = {}) => ({ id, date, kind: 'bot', white: 'You', black: 'Pip', playerColor: 'w', personaId: 'novice', result: '1-0', reason: 'resign', startFen: START_FEN, moves: ['e2e4'], ...extra });

const deviceA = {
  profile: { ...emptyProfile(), xp: 300, games: { played: 5, won: 3, drawn: 0, lost: 2, mates: 1 }, bots: { novice: { w: 3, d: 0, l: 1, streak: 2, best: 2 } },
    achievements: { 'first-win': '2026-10-01T00:00:00Z' }, campaign: { novice: { win: true, fast: false, clean: false } },
    daily: { last: '2026-10-10', streak: 3, best: 5, solved: 9 }, quests: { week: '2026-10-05', progress: { 'win-3': 2 }, rewarded: false } },
  puzzles: { rating: 1300, rd: 80, vol: 0.06, solved: 40, failed: 10, recent: ['a', 'b'], history: [], rushBest: 12, rushRuns: 3 },
  games: [game('aaaaaa01', '2026-10-01T10:00:00Z')],
  weakspots: [makeCard({ fen: FEN, played: 'g4', answers: ['e2e4'], grade: 'blunder', source: 's', day: '2026-10-01' })],
  'lessons.completed': ['novice-board'],
  'openings.completed': ['italian'],
};
const deviceB = {
  profile: { ...emptyProfile(), xp: 200, games: { played: 7, won: 2, drawn: 1, lost: 4, mates: 0 }, bots: { amateur: { w: 1, d: 0, l: 0, streak: 1, best: 1 } },
    achievements: { 'first-win': '2026-09-20T00:00:00Z', checkmate: '2026-10-02T00:00:00Z' }, campaign: { novice: { win: false, fast: true, clean: true } },
    daily: { last: '2026-10-11', streak: 1, best: 2, solved: 4 }, quests: { week: '2026-10-05', progress: { 'win-3': 1, 'review-3': 3 }, rewarded: true } },
  puzzles: { rating: 1100, rd: 120, vol: 0.06, solved: 5, failed: 2, recent: ['c'], history: [], rushBest: 15, rushRuns: 1 },
  games: [game('bbbbbb01', '2026-10-05T10:00:00Z'), game('aaaaaa01', '2026-10-01T10:00:00Z', { review: { accuracy: { w: 80, b: 70 } } })],
  weakspots: [],
  'lessons.completed': ['novice-pieces'],
  'openings.completed': ['italian', 'scotch'],
};

test('merging two devices keeps everything earned on either', () => {
  const m = mergeStates(deviceA, deviceB);
  assert.equal(m.profile.xp, 300);
  assert.deepEqual(m.profile.games, { played: 7, won: 3, drawn: 1, lost: 4, mates: 1 });
  assert.deepEqual(Object.keys(m.profile.bots).sort(), ['amateur', 'novice']);
  assert.equal(m.profile.achievements['first-win'], '2026-09-20T00:00:00Z', 'earliest unlock date');
  assert.ok(m.profile.achievements.checkmate);
  assert.deepEqual(m.profile.campaign.novice, { win: true, fast: true, clean: true });
  assert.deepEqual(m.profile.daily, { last: '2026-10-11', streak: 1, best: 5, solved: 9 }, 'streak from the latest solve, records kept');
  assert.deepEqual(m.profile.quests, { week: '2026-10-05', progress: { 'win-3': 2, 'review-3': 3 }, rewarded: true });
  assert.equal(m.puzzles.rating, 1300, 'rating from the device with more rated puzzles');
  assert.equal(m.puzzles.rushBest, 15);
  assert.deepEqual(m.puzzles.recent.sort(), ['a', 'b', 'c']);
  assert.deepEqual(m.games.map((g) => g.id), ['bbbbbb01', 'aaaaaa01'], 'newest first');
  assert.equal(m.games[1].review, undefined, 'reviews are not synced');
  assert.equal(m.weakspots.length, 1);
  assert.deepEqual(m['lessons.completed'].sort(), ['novice-board', 'novice-pieces']);
  assert.deepEqual(m['openings.completed'].sort(), ['italian', 'scotch']);
});

test('merging is commutative and idempotent', () => {
  const ab = mergeStates(deviceA, deviceB);
  const ba = mergeStates(deviceB, deviceA);
  assert.deepEqual(ab.profile, ba.profile);
  assert.deepEqual(ab.puzzles, ba.puzzles);
  assert.deepEqual(ab['lessons.completed'].sort(), ba['lessons.completed'].sort());
  assert.deepEqual(mergeStates(ab, ab), mergeStates(ab, {}));
  assert.deepEqual(mergeStates(ab, ab).profile, ab.profile);
});

test('synced games and cards keep only known, typed fields; oversized arrays are cut first', () => {
  const g = { id: 'cccccc01', date: '2026-10-01T00:00:00Z', kind: 'evil', white: 'x'.repeat(500), black: 7, playerColor: 'z', personaId: '__proto__', result: '<b>', reason: 'resign', startFen: START_FEN, moves: ['e2e4'], extra: 'junk', review: { big: true } };
  const [clean] = normalizeState({ games: [g] }).games;
  assert.equal(clean.kind, 'local');
  assert.equal(clean.white.length, 40);
  assert.equal(clean.black, 'Black');
  assert.equal(clean.playerColor, null);
  assert.equal(clean.personaId, null);
  assert.equal(clean.result, '*');
  assert.equal(Object.hasOwn(clean, 'extra'), false);
  assert.equal(Object.hasOwn(clean, 'review'), false);
  const many = normalizeState({ 'lessons.completed': Array.from({ length: 5000 }, (_, i) => `l${i}`) });
  assert.equal(many['lessons.completed'].length, 500);
});

test('junk is cleaned out of a snapshot', () => {
  const s = normalizeState({ profile: { xp: -1, achievements: { bogus: 'x' } }, games: [{ id: '../x' }], weakspots: [{}], 'lessons.completed': [1, 'ok', 'x'.repeat(200)], evil: { __proto__: { a: 1 } } });
  assert.equal(s.profile.xp, 0);
  assert.deepEqual(s.profile.achievements, {});
  assert.deepEqual(s.games, []);
  assert.deepEqual(s.weakspots, []);
  assert.deepEqual(s['lessons.completed'], ['ok']);
  assert.equal(Object.hasOwn(s, 'evil'), false);
  assert.deepEqual(normalizeState(null).games, []);
});
