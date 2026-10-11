// Openings data: legal lines in exact SAN, notes on every move, names that detect correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENINGS } from '../../public/js/data/openings.js';
import { OPENING_NAMES } from '../../public/js/data/opening-names.js';
import { detectOpening, trainerFor } from '../../public/js/core/openings.js';
import { createGame } from '../../public/js/core/rules.js';

test('there are 15 trainer openings with unique ids, for both colours', () => {
  assert.equal(OPENINGS.length, 15);
  assert.equal(new Set(OPENINGS.map((o) => o.id)).size, 15);
  assert.ok(OPENINGS.some((o) => o.side === 'w') && OPENINGS.some((o) => o.side === 'b'));
  for (const o of OPENINGS) {
    for (const key of ['name', 'eco', 'summary', 'level']) assert.ok(o[key], `${o.id} needs ${key}`);
    assert.ok(['w', 'b'].includes(o.side), o.id);
    assert.ok(o.ideas?.length >= 2, `${o.id} needs ideas`);
    assert.ok(o.line.length >= 10, `${o.id} line too short`);
  }
});

test('every trainer line is legal, written in exact SAN, and every move has a note', () => {
  for (const o of OPENINGS) {
    const game = createGame();
    for (const [san, note] of o.line) {
      const r = game.move(san);
      assert.equal(r.ok, true, `${o.id}: ${san} illegal`);
      assert.equal(r.san, san, `${o.id}: write ${r.san}, not ${san}`);
      assert.ok(note?.length > 5, `${o.id}: ${san} needs a note`);
    }
    // The line ends with the student's move or the opponent's reply to it.
    assert.ok(o.line.length >= 2);
  }
});

test('every opening name line is legal and in exact SAN', () => {
  for (const [eco, name, moves] of OPENING_NAMES) {
    assert.match(eco, /^[A-E]\d\d$/, name);
    const game = createGame();
    for (const san of moves.split(' ')) {
      const r = game.move(san);
      assert.equal(r.ok, true, `${name}: ${san} illegal`);
      assert.equal(r.san, san, `${name}: write ${r.san}`);
    }
  }
});

test('every trainer opening is detected by name at the end of its line, and links back to itself', () => {
  for (const o of OPENINGS) {
    const game = createGame();
    for (const [san] of o.line) game.move(san);
    const found = detectOpening(game.history({ verbose: true }));
    assert.ok(found, `${o.id}: not detected`);
    assert.equal(found.trainerId, o.id, `${o.id}: detected as ${found.name}`);
  }
});

test('detection follows transpositions and needs the standard start', () => {
  const g = createGame();
  for (const san of ['Nf3', 'Nf6', 'c4', 'e6', 'd4', 'b6']) g.move(san); // Queen's Indian by transposition
  assert.equal(detectOpening(g.history({ verbose: true })).name, 'Queen\'s Indian Defence');
  const odd = createGame({ fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1' });
  odd.move('e4');
  assert.equal(detectOpening(odd.history({ verbose: true })), null);
  assert.equal(detectOpening([]), null);
});

test('the deepest named position wins, and unnamed later moves keep the last name', () => {
  const g = createGame();
  for (const san of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3']) g.move(san);
  const found = detectOpening(g.history({ verbose: true }));
  assert.equal(found.name, 'Sicilian Defence: Dragon Variation');
  assert.equal(found.eco, 'B70');
  assert.equal(found.ply, 10);
});

test('trainerFor links families but not look-alikes', () => {
  assert.equal(trainerFor('Caro-Kann Defence: Advance Variation'), 'caro-kann');
  assert.equal(trainerFor('Two Knights Defence: Fried Liver Attack'), 'fried-liver');
  assert.equal(trainerFor('Semi-Slav Defence'), null);
  assert.equal(trainerFor('King\'s Indian Attack'), null);
  assert.equal(trainerFor('Polish Opening'), null);
});
