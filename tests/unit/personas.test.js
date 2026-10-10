import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, personaById } from '../../public/js/data/personas.js';
import { engineOptionsFor, searchFor, pickMove } from '../../public/js/engine/personas.js';
import { createRng } from '../../public/js/core/rng.js';
import { BOOK_LINES } from '../../public/js/data/book.js';
import { createBook, bookMove } from '../../public/js/engine/book.js';
import { createGame } from '../../public/js/core/rules.js';

const ELO_RANGE = { min: 1320, max: 3190 }; // verified against Stockfish 19 lite

test('five personas, one per difficulty, with everything the UI needs', () => {
  assert.deepEqual(PERSONAS.map((p) => p.level), ['Novice', 'Amateur', 'Pro', 'Grand Master', 'Beyond Humans']);
  for (const p of PERSONAS) {
    for (const key of ['id', 'name', 'avatar', 'tagline', 'rating']) assert.ok(p[key], `${p.id} needs ${key}`);
    for (const key of ['greeting', 'botWins', 'botLoses', 'draw']) assert.ok(p.lines[key]?.length >= 2, `${p.id} needs ${key} lines`);
    if (p.strength.limitElo) assert.ok(p.strength.limitElo >= ELO_RANGE.min && p.strength.limitElo <= ELO_RANGE.max, p.id);
  }
  assert.equal(personaById('pro').name, PERSONAS[2].name);
  assert.equal(personaById('nope').id, 'novice', 'unknown ids fall back to the gentlest persona');
});

test('engine options: Elo-limited personas and full strength', () => {
  assert.deepEqual(engineOptionsFor(personaById('amateur')), [['UCI_LimitStrength', true], ['UCI_Elo', 1400]]);
  assert.deepEqual(engineOptionsFor(personaById('beyond')), [['UCI_LimitStrength', false], ['Skill Level', 20]]);
  assert.deepEqual(engineOptionsFor(personaById('novice')), [['UCI_LimitStrength', false], ['Skill Level', 0]]);
});

test('search limits respect the clock and fast test mode', () => {
  assert.equal(searchFor(personaById('beyond')).movetime, 3000);
  assert.equal(searchFor(personaById('beyond'), { remainingMs: 30_000 }).movetime, 1000, 'never spends more than 1/30 of the clock');
  assert.equal(searchFor(personaById('beyond'), { remainingMs: 600 }).movetime, 50, 'floor of 50 ms');
  const fast = searchFor(personaById('grandmaster'), { fast: true });
  assert.ok(fast.movetime <= 100 && fast.depth <= 8);
  assert.equal(searchFor(personaById('novice')).multipv, 4);
});

test('the novice sometimes plays weaker moves, deterministically per seed', () => {
  const novice = personaById('novice');
  const result = { bestmove: 'a', lines: [{ pv: ['a'] }, { pv: ['b'] }, { pv: ['c'] }, { pv: ['d'] }] };
  const legal = ['a', 'b', 'c', 'd', 'e', 'f'];
  const picks = (seed) => { const rng = createRng(seed); return Array.from({ length: 400 }, () => pickMove(novice, result, legal, rng)); };
  assert.deepEqual(picks(7), picks(7));
  const best = picks(7).filter((m) => m === 'a').length / 400;
  assert.ok(best > 0.45 && best < 0.75, `best-move rate ${best}`);
  const gm = personaById('grandmaster');
  assert.ok(Array.from({ length: 50 }, () => pickMove(gm, result, legal, createRng(1))).every((m) => m === 'a'));
});

test('every opening book line is legal from the start position', () => {
  for (const line of BOOK_LINES) {
    const g = createGame();
    for (const san of line.trim().split(/\s+/)) assert.equal(g.move(san).ok, true, `${san} in "${line}"`);
  }
});

test('book moves follow the game so far and stop after the persona limit', () => {
  const book = createBook(BOOK_LINES);
  const rng = createRng(3);
  const first = bookMove(book, [], rng, 10);
  assert.ok(['e4', 'd4', 'c4', 'Nf3'].includes(first));
  assert.ok(['e5', 'c5', 'e6', 'c6', 'd5', 'd6'].includes(bookMove(book, ['e4'], rng, 10)));
  assert.equal(bookMove(book, ['a3'], rng, 10), null, 'out of book');
  assert.equal(bookMove(book, ['e4', 'e5'], rng, 2), null, 'persona book depth reached');
});
