// Game review with the real Stockfish: the classic blunders of fool's mate are found.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { ANALYSIS_OPTIONS } from '../../public/js/engine/analysis.js';
import { reviewGame } from '../../public/js/core/review.js';
import { START_FEN } from '../../public/js/core/rules.js';

let engine;
test.before(async () => { engine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init(); });
test.after(() => engine.terminate());

test('fool\'s mate: 2.g4 is a blunder, 2...Qh4# is found, Black is far more accurate', async () => {
  const search = (fen, moves) => engine.go({ fen, moves, multipv: 2, depth: 12, options: ANALYSIS_OPTIONS });
  const r = await reviewGame({ startFen: START_FEN, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], search });
  assert.equal(r.moves[2].grade, 'blunder');
  assert.equal(r.moves[2].analysis.refutation, 'd8h4');
  assert.ok(['best', 'great'].includes(r.moves[3].grade));
  assert.ok(r.keyMoments.includes(3));
  assert.ok(r.accuracy.b > r.accuracy.w + 20, JSON.stringify(r.accuracy));
});
