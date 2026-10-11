// Engine check for the openings trainer: every move the student is taught must be sound —
// no worse than the engine's best move by more than a small margin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { OPENINGS } from '../../public/js/data/openings.js';
import { scoreToCp } from '../../public/js/core/classify.js';
import { createGame, START_FEN } from '../../public/js/core/rules.js';

let engine;
test.before(async () => { engine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init(); });
test.after(() => engine.terminate());

const ANALYSIS = [['UCI_LimitStrength', false], ['Skill Level', 20]];
const MARGIN_CP = 90;

for (const opening of OPENINGS) {
  test(`${opening.id}: every taught move is sound`, async () => {
    const game = createGame();
    const played = [];
    for (const [san] of opening.line) {
      const mine = game.turn() === opening.side;
      const r = game.move(san);
      if (mine) {
        const best = await engine.go({ fen: START_FEN, moves: played, depth: 12, options: ANALYSIS });
        const after = await engine.go({ fen: START_FEN, moves: [...played, r.uci], depth: 11, options: ANALYSIS });
        const bestCp = scoreToCp(best.lines[0].score);
        const mineCp = -scoreToCp(after.lines[0].score);
        assert.ok(mineCp >= bestCp - MARGIN_CP, `${opening.id}: ${san} (${mineCp}) vs ${best.bestmove} (${bestCp})`);
      }
      played.push(r.uci);
    }
  });
}
