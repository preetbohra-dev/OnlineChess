// Every lesson is checked: shape, legal positions, legal solutions, goals actually reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_LESSONS } from '../../public/js/data/lessons/index.js';
import { createGame, isValidFen } from '../../public/js/core/rules.js';

const SQUARE = /^[a-h][1-8]$/;

test('lesson ids are unique and every lesson has the required fields', () => {
  const ids = ALL_LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of ALL_LESSONS) {
    for (const key of ['id', 'level', 'title', 'summary', 'type']) assert.ok(l[key], `${l.id} needs ${key}`);
    assert.ok(['read', 'puzzle', 'playout'].includes(l.type), l.id);
  }
});

test('read lessons: every diagram is a legal position, every arrow and highlight a real square', () => {
  for (const l of ALL_LESSONS.filter((x) => x.type === 'read')) {
    assert.ok(l.steps?.length, l.id);
    for (const step of l.steps) {
      assert.ok(step.text?.length > 10, `${l.id}: step text`);
      if (step.fen) assert.ok(isValidFen(step.fen), `${l.id}: ${step.fen}`);
      for (const a of step.arrows ?? []) assert.ok(SQUARE.test(a.from) && SQUARE.test(a.to), `${l.id}: arrow`);
      for (const s of step.highlights ?? []) assert.ok(SQUARE.test(s), `${l.id}: highlight ${s}`);
    }
  }
});

test('puzzles: legal start, legal solution, goal reached', () => {
  for (const l of ALL_LESSONS.filter((x) => x.type === 'puzzle')) {
    assert.ok(isValidFen(l.fen), `${l.id}: bad FEN`);
    for (const key of ['prompt', 'success']) assert.ok(l[key], `${l.id} needs ${key}`);
    assert.ok(l.hints?.length, `${l.id} needs hints`);
    assert.ok(['mate', 'line', 'promote', 'any'].includes(l.goal), l.id);
    const game = createGame({ fen: l.fen });
    assert.equal(game.status().over, false, `${l.id}: already over`);
    for (const uci of l.solution) assert.equal(game.move(uci).ok, true, `${l.id}: ${uci} illegal`);
    assert.equal(l.solution.length % 2, 1, `${l.id}: solution must end with the player's move`);
    for (const alt of l.alternatives ?? []) {
      const g = createGame({ fen: l.fen });
      for (const uci of alt) assert.equal(g.move(uci).ok, true, `${l.id}: alternative ${uci} illegal`);
      assert.equal(alt.length % 2, 1, `${l.id}: alternative must end with the player's move`);
    }
    for (const [uci, text] of Object.entries(l.wrong ?? {})) {
      assert.match(uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/, `${l.id}: wrong-move key ${uci}`);
      assert.ok(text.length > 10, `${l.id}: wrong-move text`);
    }
    if (l.goal === 'mate') assert.equal(game.status().reason, 'checkmate', `${l.id}: not mate`);
    if (l.goal === 'promote') assert.ok(game.history({ verbose: true }).some((m) => m.promotion), `${l.id}: no promotion`);
  }
});

test('playouts: legal start, a goal, a move budget, hints', () => {
  const playouts = ALL_LESSONS.filter((x) => x.type === 'playout');
  assert.ok(playouts.length >= 4);
  for (const l of playouts) {
    assert.ok(isValidFen(l.fen), `${l.id}: bad FEN`);
    assert.equal(createGame({ fen: l.fen }).status().over, false, `${l.id}: already over`);
    assert.ok(['mate', 'promote', 'hold'].includes(l.goal), l.id);
    assert.ok(Number.isInteger(l.moves) && l.moves > 0 && l.moves <= 40, `${l.id}: moves`);
    for (const key of ['prompt', 'success']) assert.ok(l[key], `${l.id} needs ${key}`);
    assert.ok(l.hints?.length, `${l.id} needs hints`);
  }
});

test('every track has lessons, and Pro and Grand Master tracks exist', () => {
  for (const level of ['novice', 'amateur', 'pro', 'grandmaster']) {
    assert.ok(ALL_LESSONS.some((l) => l.level === level), level);
  }
});

test('the stalemate lesson really contains a stalemate trap', () => {
  const g = createGame({ fen: ALL_LESSONS.find((l) => l.id === 'novice-stalemate').fen });
  g.move('b1b6');
  assert.equal(g.status().reason, 'stalemate');
});

test('the castling-through-check lesson really forbids kingside castling', () => {
  const g = createGame({ fen: ALL_LESSONS.find((l) => l.id === 'novice-castling-check').fen });
  assert.ok(!g.legalMoves('e1').some((m) => m.to === 'g1'));
});
