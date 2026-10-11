// Real Stockfish 19 lite (the build the browser ships) running in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { PERSONAS } from '../../public/js/data/personas.js';
import { engineOptionsFor, searchFor, pickMove } from '../../public/js/engine/personas.js';
import { createRng } from '../../public/js/core/rng.js';
import { createGame } from '../../public/js/core/rules.js';

let engine;
test.before(async () => {
  engine = new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 });
  await engine.init();
});
test.after(() => engine.terminate());

test('discovers the strength options the personas rely on', () => {
  for (const name of ['Skill Level', 'UCI_LimitStrength', 'UCI_Elo', 'MultiPV']) assert.ok(engine.options.has(name), name);
  assert.equal(engine.options.get('UCI_Elo').min, 1320);
  assert.equal(engine.options.get('UCI_Elo').max, 3190);
  assert.equal(engine.setOption('No Such Option', 1), false);
});

test('finds a mate in one and reports it as a mate score', async () => {
  const r = await engine.go({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 8, multipv: 2 });
  assert.equal(r.bestmove, 'a1a8');
  assert.deepEqual(r.lines[0].score, { mate: 1 });
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[1].multipv, 2);
});

test('plays from a start FEN plus a move list', async () => {
  const r = await engine.go({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: ['f2f3', 'e7e5', 'g2g4'], depth: 6 });
  assert.equal(r.bestmove, 'd8h4', 'finds fool\'s mate');
});

test('cancel turns pending searches into stale results', async () => {
  const first = engine.go({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', movetime: 2000 });
  const second = engine.go({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 5 });
  await new Promise((r) => setTimeout(r, 50));
  engine.cancel();
  assert.deepEqual(await first, { stale: true });
  assert.deepEqual(await second, { stale: true });
  const fresh = await engine.go({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 4 });
  assert.match(fresh.bestmove, /^[a-h][1-8][a-h][1-8]$/);
});

test('every persona produces a legal move quickly', async () => {
  const game = createGame({ fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4' });
  const legal = game.legalMoves().map((m) => m.uci);
  for (const persona of PERSONAS) {
    const started = Date.now();
    const result = await engine.go({ fen: game.fen(), ...searchFor(persona, { fast: true }), options: engineOptionsFor(persona) });
    const move = pickMove(persona, result, legal, createRng(5));
    assert.ok(legal.includes(move), `${persona.id} played ${move}`);
    assert.ok(Date.now() - started < 5_000, `${persona.id} took too long`);
  }
});
