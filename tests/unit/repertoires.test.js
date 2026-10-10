import test from 'node:test';
import assert from 'node:assert/strict';
import { REPERTOIRES, linesFor } from '../../public/js/data/repertoires.js';
import { createBook, bookMove } from '../../public/js/engine/book.js';
import { PERSONAS } from '../../public/js/data/personas.js';
import { createGame } from '../../public/js/core/rules.js';
import { createRng } from '../../public/js/core/rng.js';

test('every repertoire line is legal and in exact SAN', () => {
  for (const persona of PERSONAS) {
    for (const line of linesFor(persona.id)) {
      const g = createGame();
      for (const san of line.split(' ')) {
        const r = g.move(san);
        assert.equal(r.ok, true, `${persona.id}: ${san} in "${line}"`);
        assert.equal(r.san, san, `${persona.id}: write ${r.san} in "${line}"`);
      }
    }
  }
});

test('each persona reaches the end of its signature lines', () => {
  for (const [id, lines] of Object.entries(REPERTOIRES)) {
    const persona = PERSONAS.find((p) => p.id === id);
    const longest = Math.max(...lines.map((l) => l.split(' ').length));
    assert.ok(persona.bookPlies >= longest, `${id}: bookPlies ${persona.bookPlies} < ${longest}`);
  }
});

test('Pip tries the early queen attack; strong personas play main lines', () => {
  const pip = createBook(linesFor('novice'));
  assert.equal(bookMove(pip, ['e4', 'e5'], createRng(1), 6) !== null, true);
  const seen = new Set(Array.from({ length: 40 }, (_, i) => bookMove(pip, ['e4', 'e5'], createRng(i), 6)));
  assert.ok(seen.has('Qh5') || seen.has('Bc4'));
  const gm = createBook(linesFor('grandmaster'));
  assert.equal(bookMove(gm, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], createRng(2), 14), 'a6');
});

test('lines that teach punishing a mistake stay out of the bots\' books', () => {
  const gm = createBook(linesFor('grandmaster'));
  const afterExd5 = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5'];
  assert.notEqual(bookMove(gm, afterExd5, createRng(1), 14), 'Nxd5');
});
