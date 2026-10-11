// Every bundled library puzzle is legal, and mate puzzles really end in mate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from '../../public/vendor/chess.js/chess.js';
import { parseRow, toLesson, choosePuzzle, dailyFromLibrary, rushTarget, THEMES } from '../../public/js/core/puzzle-library.js';
import { createPuzzle } from '../../public/js/core/puzzle.js';
import { pick, curate } from '../../scripts/puzzles.mjs';

const data = JSON.parse(readFileSync(new URL('../../public/data/puzzles.json', import.meta.url)));
const puzzles = data.puzzles.map(parseRow);

test('about 5,000 puzzles from 400 to 2800, unique ids', () => {
  assert.ok(puzzles.length >= 4000, String(puzzles.length));
  assert.equal(new Set(puzzles.map((p) => p.id)).size, puzzles.length);
  assert.ok(puzzles.every((p) => p.rating >= 400 && p.rating < 2800));
  assert.match(data.source, /CC0/);
});

test('every puzzle is legal from its position, and mates end in checkmate', () => {
  for (const p of puzzles) {
    const chess = new Chess(p.fen);
    for (const uci of p.moves) {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      assert.ok(m, `${p.id}: ${uci}`);
    }
    if (p.themes.includes('mate')) assert.ok(chess.isCheckmate(), `${p.id}: not mate`);
    assert.equal(p.moves.length % 2, 0, `${p.id}: setup move + solution ending with the solver`);
  }
});

test('a library puzzle plays in the lesson puzzle engine', () => {
  for (const p of puzzles.slice(0, 200)) {
    const lesson = toLesson(p);
    const puzzle = createPuzzle(lesson);
    let last;
    for (let i = 0; i < lesson.solution.length; i += 2) last = puzzle.tryMove(lesson.solution[i]);
    assert.equal(last.result, 'solved', p.id);
  }
});

test('choosing near a rating, by theme, never repeating an excluded puzzle', () => {
  const rng = () => 0.5;
  const p = choosePuzzle(puzzles, 1500, { rng });
  assert.ok(Math.abs(p.rating - 1500) <= 75);
  const fork = choosePuzzle(puzzles, 1200, { theme: 'fork', rng });
  assert.ok(fork.themes.includes('fork'));
  const ex = new Set(puzzles.filter((x) => Math.abs(x.rating - 1500) <= 75).map((x) => x.id));
  const other = choosePuzzle(puzzles, 1500, { exclude: ex, rng });
  assert.ok(!ex.has(other.id));
  for (const t of Object.keys(THEMES)) assert.ok(puzzles.some((x) => x.themes.includes(t)), `no ${t} puzzles`);
});

test('the daily puzzle does not repeat within a year for a given band', () => {
  const seen = new Set();
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 366; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    seen.add(dailyFromLibrary(puzzles, day, 1000).id);
  }
  assert.equal(seen.size, 366);
  assert.equal(dailyFromLibrary(puzzles, '2026-10-11', 1000).id, dailyFromLibrary(puzzles, '2026-10-11', 1050).id);
});

test('Puzzle Rush gets harder as you go', () => {
  assert.ok(rushTarget(10) > rushTarget(0));
});

test('the curation script filters and balances rows', async () => {
  const header = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags';
  const row = (id, rating, rd = 75, pop = 95, plays = 1000) => [id, '8/8/8/8/8/8/8/8 w - - 0 1', 'e2e4 e7e5', rating, rd, pop, plays, 'fork', 'url', ''].join(',');
  assert.equal(pick(row('a', 1000, 200).split(','), 1), null, 'uncertain rating');
  assert.equal(pick(row('a', 1000, 75, 50).split(','), 1), null, 'unpopular');
  assert.equal(pick(row('a', 300).split(','), 1), null, 'below the range');
  assert.ok(pick(row('a', 1000).split(','), 1));
  async function* lines() { yield header; for (let i = 0; i < 50; i++) yield row(`p${i}`, 1000 + (i % 2) * 300); }
  const out = await curate(lines(), { perBand: 5, sample: 1 });
  assert.equal(out.length, 10);
});
