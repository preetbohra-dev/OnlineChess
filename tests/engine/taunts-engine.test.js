// Move analysis and taunts against the real engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { createAnalyzer } from '../../public/js/engine/analysis.js';
import { createBotSession } from '../../public/js/sessions/bot-session.js';
import { personaById } from '../../public/js/data/personas.js';
import { createRng } from '../../public/js/core/rng.js';
import { START_FEN } from '../../public/js/core/rules.js';

// After 1.e4 e5 2.Nf3, Black to move: ...Qg5?? hangs the queen to Nxg5.
const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

let botEngine;
let analysisEngine;
test.before(async () => {
  botEngine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init();
  analysisEngine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init();
});
test.after(() => { botEngine.terminate(); analysisEngine.terminate(); });

test('a hung queen is graded a blunder, with the capturing reply as refutation', async () => {
  const analyzer = createAnalyzer(Promise.resolve(analysisEngine), { depth: 10 });
  const a = await analyzer.analyzeMove({ startFen: AFTER_NF3, moves: [], move: 'd8g5' });
  assert.equal(a.classification.grade, 'blunder');
  assert.equal(a.refutation, 'f3g5');
});

test('a sound opening move is not criticised', async () => {
  const analyzer = createAnalyzer(Promise.resolve(analysisEngine), { depth: 10 });
  const a = await analyzer.analyzeMove({ startFen: START_FEN, moves: [], move: 'e2e4' });
  assert.ok(['best', 'excellent', 'good', 'great'].includes(a.classification.grade), a.classification.grade);
});

test('delivering checkmate counts as the best possible move', async () => {
  const analyzer = createAnalyzer(Promise.resolve(analysisEngine), { depth: 8 });
  const a = await analyzer.analyzeMove({
    startFen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', moves: [], move: 'a1a8',
    afterStatus: { over: true, reason: 'checkmate' },
  });
  assert.equal(a.isBest, true);
  assert.ok(['best', 'great'].includes(a.classification.grade));
});

test('the persona teases a hung queen by name', async () => {
  const s = createBotSession({
    persona: personaById('pro'),
    playerColor: 'b',
    fen: AFTER_NF3,
    engine: Promise.resolve(botEngine),
    analyzer: createAnalyzer(Promise.resolve(analysisEngine), { depth: 10 }),
    fast: true,
    minThinkMs: 0,
    rng: createRng(11),
  });
  const taunted = new Promise((resolve) => s.on('feed', (f) => f.kind === 'taunt' && resolve(f)));
  s.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.submitMove('Qg5').ok, true);
  const f = await taunted;
  assert.equal(f.trigger, 'hangPiece');
  assert.match(f.text, /queen/);
  s.destroy();
});

test('no taunts when they are switched off', async () => {
  const s = createBotSession({
    persona: personaById('pro'),
    playerColor: 'b',
    fen: AFTER_NF3,
    engine: Promise.resolve(botEngine),
    analyzer: createAnalyzer(Promise.resolve(analysisEngine), { depth: 10 }),
    tauntsEnabled: () => false,
    fast: true,
    minThinkMs: 0,
    rng: createRng(12),
  });
  const feed = [];
  s.on('feed', (f) => feed.push(f));
  s.start();
  await new Promise((r) => setTimeout(r, 0));
  const replied = new Promise((resolve) => s.on('change', (d) => d.by === 'bot' && resolve()));
  s.submitMove('Qg5');
  await replied;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(feed.filter((f) => f.kind === 'taunt').length, 0);
  s.destroy();
});
