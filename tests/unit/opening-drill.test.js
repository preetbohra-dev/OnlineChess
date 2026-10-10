import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpeningDrill } from '../../public/js/core/openings.js';
import { openingById } from '../../public/js/data/openings.js';

test('white drill: correct moves get the book reply, wrong moves are undone and counted', () => {
  const drill = createOpeningDrill(openingById('italian'));
  assert.equal(drill.ply, 0);
  assert.equal(drill.expected(), 'e4');
  const wrong = drill.tryMove('d2d4');
  assert.equal(wrong.result, 'wrong');
  assert.equal(wrong.expected, 'e4');
  assert.equal(drill.mistakes, 1);
  assert.equal(drill.ply, 0);
  const ok = drill.tryMove('e2e4');
  assert.equal(ok.result, 'correct');
  assert.equal(ok.reply.san, 'e5');
  assert.equal(drill.ply, 2);
  assert.equal(drill.tryMove('e7e5').result, 'illegal');
});

test('black drill: the opponent opens automatically and the drill finishes', () => {
  const opening = openingById('slav');
  const drill = createOpeningDrill(opening);
  assert.equal(drill.ply, 1); // 1.d4 already played
  let last;
  while (!drill.done) last = drill.tryMove(drill.expected());
  assert.equal(last.result, 'done');
  assert.equal(drill.mistakes, 0);
  assert.equal(drill.tryMove('e7e6').result, 'illegal');
  drill.reset();
  assert.equal(drill.ply, 1);
});

test('notes come from the line', () => {
  const drill = createOpeningDrill(openingById('italian'));
  assert.match(drill.noteFor(0), /centre/);
  assert.equal(drill.noteFor(99), null);
});
