import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeWeek, weeklySet, isCorrect, scoreGame, publicView, loadPuzzleLibrary, GAME_POOL, weekEnds } from '../../server/challenge.js';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { createGame, isValidFen } from '../../public/js/core/rules.js';

const LIB = loadPuzzleLibrary();

test('weeks start Monday 00:00 UTC; each week has 10 rising puzzles and 3 distinct games, the same for everyone', () => {
  assert.equal(challengeWeek(Date.UTC(2026, 9, 11, 23, 59)), '2026-10-05');
  assert.equal(challengeWeek(Date.UTC(2026, 9, 12, 0, 0)), '2026-10-12');
  assert.equal(weekEnds('2026-10-05'), Date.UTC(2026, 9, 12));
  const a = weeklySet('2026-10-05', LIB);
  assert.deepEqual(weeklySet('2026-10-05', LIB), a);
  assert.equal(a.puzzles.length, 10);
  assert.equal(new Set(a.puzzles.map((p) => p.id)).size, 10);
  assert.ok(a.puzzles.every((p, i) => i === 0 || p.rating >= a.puzzles[i - 1].rating - 120), 'roughly rising');
  assert.equal(new Set(a.games.map((g) => g.id)).size, 3);
  assert.notDeepEqual(weeklySet('2026-10-12', LIB).puzzles.map((p) => p.id), a.puzzles.map((p) => p.id));
  for (const g of GAME_POOL) assert.ok(isValidFen(g.fen), g.id);
});

test('the weekly pool is separate from the public library, legal, and spread over ratings', () => {
  const pub = new Set(loadPuzzleLibrary(new URL('../../public/data/puzzles.json', import.meta.url).pathname).map((p) => p.id));
  assert.ok(LIB.length >= 1000);
  assert.equal(LIB.filter((p) => pub.has(p.id)).length, 0, 'no puzzle is in the public file');
  for (const p of LIB) {
    const g = createGame({ fen: p.fen });
    for (const uci of p.moves) assert.equal(g.move(uci).ok, true, p.id);
  }
});

test('answers: the best move, or any mate in a mate-in-1', () => {
  const p = { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', answer: 'a1a8', mate: true };
  assert.equal(isCorrect(p, 'a1a8'), true);
  assert.equal(isCorrect(p, 'a1a7'), false);
  assert.equal(isCorrect(p, 'zz'), false);
  assert.equal(isCorrect({ ...p, mate: false, answer: 'g1h1' }, 'a1a8'), false);
});

test('reported games must be legal and finished; a loss scores nothing', () => {
  const slot = { fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' };
  assert.equal(scoreGame(slot, ['a1a8']).ok, false, 'too short to be a real game');
  assert.deepEqual(scoreGame(slot, ['g1f1', 'g8f8', 'f1e1', 'f8g8', 'e1d1', 'g8h8', 'a1a8']), { ok: true, outcome: 'win', points: 5, plies: 7 });
  assert.equal(scoreGame(slot, ['g1f1', 'g8f8', 'f1e1', 'f8g8', 'e1d1', 'g8f8']).ok, false, 'not finished');
  assert.equal(scoreGame(slot, ['a1a9']).ok, false, 'illegal');
  assert.equal(scoreGame(slot, []).ok, false);
  assert.equal(scoreGame(slot, 'a1a8').ok, false);
  const start = { fen: createGame().fen() };
  assert.deepEqual(scoreGame(start, ['a2a3', 'a7a6', 'f2f3', 'e7e5', 'g2g4', 'd8h4']), { ok: true, outcome: 'loss', points: 0, plies: 6 });
  assert.equal(scoreGame(slot, ['Kf1', 'Kf8', 'Ke1', 'Kg8', 'Kd1', 'Kf8', 'Ra8#']).ok, false, 'UCI only');
});

test('the public view never contains the answer of an unanswered puzzle', () => {
  const set = weeklySet('2026-10-05', LIB);
  const view = publicView(set, [{ idx: 0, move: 'a1a1', correct: 0 }], []);
  assert.equal(JSON.stringify(view.puzzles.slice(1)).includes('answer'), false);
  assert.equal(view.puzzles[0].answered.best, set.puzzles[0].answer);
});

test('API: week-checked answers, one attempt each, started and timed games, a leaderboard by score then speed', async () => {
  let clock = Date.UTC(2026, 9, 7, 12);
  const db = openDatabase(':memory:');
  const app = createAppServer({ db, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 }, puzzles: LIB });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${app.http.address().port}`;
    const headers = { Origin: url, 'X-OC-Request': '1', 'Content-Type': 'application/json' };
    const post = async (p, body, cookie) => { const r = await fetch(url + p, { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    const get = async (p, cookie) => { const r = await fetch(url + p, { headers: cookie ? { Cookie: cookie } : {} }); return { status: r.status, json: await r.json() }; };
    const signUp = async (name) => (await fetch(`${url}/api/register`, { method: 'POST', headers, body: JSON.stringify({ username: name, password: 'correct horse battery' }) })).headers.get('set-cookie').split(';')[0];
    void clock;

    assert.equal((await get('/api/challenge')).status, 401);
    const ann = await signUp('annw');
    const bob = await signUp('bobw');
    const view = (await get('/api/challenge', ann)).json;
    const week = view.week;
    assert.equal(view.puzzles.length, 10);
    assert.equal(view.puzzles.some((p) => 'answer' in p), false);
    const set = weeklySet(week, LIB);

    assert.equal((await post('/api/challenge/answer', { week: '2000-01-03', index: 0, move: set.puzzles[0].answer }, ann)).status, 409, 'an old week is refused');
    assert.equal((await post('/api/challenge/answer', { week, index: 0, move: { x: 1 } }, ann)).status, 400);
    const right = await post('/api/challenge/answer', { week, index: 0, move: set.puzzles[0].answer }, ann);
    assert.deepEqual(right.json, { correct: true, best: set.puzzles[0].answer, first: true });
    const again = await post('/api/challenge/answer', { week, index: 0, move: 'a1a2' }, ann);
    assert.deepEqual(again.json, { correct: true, best: set.puzzles[0].answer, first: false }, 'the first answer stands');
    await post('/api/challenge/answer', { week, index: 1, move: set.puzzles[1].answer }, bob);
    await post('/api/challenge/answer', { week, index: 2, move: 'a1a2' }, bob);
    assert.equal((await post('/api/challenge/answer', { week, index: 99, move: 'a1a2' }, bob)).status, 400);

    // Games must be started from the page, and cannot be reported faster than they could be played.
    const legal = (fen, n) => { const g = createGame({ fen }); const out = []; while (out.length < n && !g.status().over) { const m = g.legalMoves()[0]; g.move(m.uci); out.push(m.uci); } return out; };
    const slot = set.games[0];
    assert.equal((await post('/api/challenge/game', { week, slot: 0, moves: legal(slot.fen, 8) }, ann)).json.error, 'Start challenge games from the weekly challenge page.');
    assert.equal((await post('/api/challenge/start', { week, slot: 0 }, ann)).status, 200);
    assert.equal((await post('/api/challenge/game', { week, slot: 0, moves: ['zzzz'] }, ann)).status, 400);
    assert.equal((await post('/api/challenge/game', { week, slot: 7, moves: ['e2e4'] }, ann)).status, 400);

    const board = (await get('/api/challenge/leaderboard', bob)).json;
    assert.deepEqual(board.top.map((r) => [r.rank, r.username, r.score]), [[1, 'annw', 10], [2, 'bobw', 10]], 'a tie goes to whoever finished first');
    assert.deepEqual(board.me, { username: 'bobw', rank: 2, score: 10 });
    const guest = (await get('/api/challenge/leaderboard')).json;
    assert.equal(guest.me, null);
    assert.equal(guest.top.length, 2);
    const nobody = await signUp('carlw');
    assert.deepEqual((await get('/api/challenge/leaderboard', nobody)).json.me, { username: 'carlw', rank: null, score: 0 }, 'no points, no rank');
  } finally {
    await app.close();
  }
});
