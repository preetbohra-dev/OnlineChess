// The coached game against the real engine: feedback after every move, threats, hints, takebacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { createAnalyzer } from '../../public/js/engine/analysis.js';
import { createTrainingSession } from '../../public/js/sessions/training-session.js';
import { createRng } from '../../public/js/core/rng.js';

let botEngine;
let coachEngine;
test.before(async () => {
  botEngine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init();
  coachEngine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init();
});
test.after(() => { botEngine.terminate(); coachEngine.terminate(); });

const settle = () => new Promise((r) => setTimeout(r, 0));
const until = (session, predicate, ms = 15_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out')), ms);
  const check = () => { if (predicate()) { clearTimeout(timer); resolve(); } };
  session.on('change', check);
  check();
});

function make(level = 'amateur', playerColor = 'w') {
  const analyzer = createAnalyzer(Promise.resolve(coachEngine), { depth: 8 });
  return createTrainingSession({ level, playerColor, engine: Promise.resolve(botEngine), analyzer, rng: createRng(7), fast: true, minThinkMs: 0 });
}

test('every player move gets graded feedback', async () => {
  const s = make('novice');
  s.start();
  await settle();
  s.submitMove('e4');
  await until(s, () => s.summary()?.moves === 1);
  await until(s, () => s.inputColor() === 'w');
  s.submitMove('Qh5');
  await until(s, () => s.summary()?.moves === 2);
  assert.equal(s.summary().moves, 2);
  assert.ok(s.summary().accuracy > 0 && s.summary().accuracy <= 100);
  s.destroy();
});

test('takeback removes the move pair and its feedback; hints point at a legal move', async () => {
  const s = make('pro');
  s.start();
  await settle();
  s.submitMove('d4');
  await until(s, () => s.inputColor() === 'w' && s.summary()?.moves === 1);
  assert.equal(s.takeback().ok, true);
  assert.equal(s.rules.history().length, 0);
  assert.equal(s.summary(), null, 'feedback for the undone move is gone');
  const hint = await s.hint();
  assert.equal(hint.stage, 1);
  assert.ok(s.rules.legalMoves().some((m) => m.uci === hint.move));
  assert.equal(s.hintSquare(), hint.move.slice(0, 2));
  assert.equal((await s.hint()).stage, 2);
  assert.ok(s.arrows().some((a) => a.type === 'info'));
  s.destroy();
});

test('a threat after the opponent\'s move is explained', async () => {
  const analyzer = createAnalyzer(Promise.resolve(coachEngine), { depth: 8 });
  // Black to move with the queen en prise on d5: White threatens Rxd5.
  const t = await analyzer.analyzeThreat({ fen: '4k3/8/8/3q4/8/8/8/3RK3 b - - 0 1' });
  assert.equal(t.move, 'd1d5');
  assert.equal(t.san, 'Rxd5');
  assert.ok(t.gainCp > 500);
  assert.equal(await analyzer.analyzeThreat({ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' }), null, 'no threat after 1.e4');
});
