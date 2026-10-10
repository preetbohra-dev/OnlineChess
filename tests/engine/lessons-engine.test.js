// Engine check for lessons: a puzzle's intended first move must be (one of) the engine's best, and a
// playout's goal must be reachable — a winning position for 'mate'/'promote', a drawn one for 'hold'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { ALL_LESSONS } from '../../public/js/data/lessons/index.js';
import { scoreToCp } from '../../public/js/core/classify.js';
import { createPlayout } from '../../public/js/core/playout.js';

let engine;
test.before(async () => { engine = await new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 }).init(); });
test.after(() => engine.terminate());

const ANALYSIS = [['UCI_LimitStrength', false], ['Skill Level', 20]];

for (const lesson of ALL_LESSONS.filter((l) => l.type === 'puzzle' && !l.rule)) {
  test(`${lesson.id}: the solution is the engine's choice`, async () => {
    const best = await engine.go({ fen: lesson.fen, depth: 14, multipv: 1, options: ANALYSIS });
    const intended = lesson.solution[0];
    if (best.bestmove === intended) return;
    // Another move may be just as good (e.g. an alternative mate); compare evaluations.
    const after = await engine.go({ fen: lesson.fen, moves: [intended], depth: 13, multipv: 1, options: ANALYSIS });
    const bestCp = scoreToCp(best.lines[0].score);
    const intendedCp = after.lines.length ? -scoreToCp(after.lines[0].score) : 10_000;
    assert.ok(intendedCp >= bestCp - 60, `${lesson.id}: ${intended} (${intendedCp}) is clearly worse than ${best.bestmove} (${bestCp})`);
  });
}

for (const lesson of ALL_LESSONS.filter((l) => l.type === 'playout')) {
  test(`${lesson.id}: the ${lesson.goal} goal fits the engine's evaluation`, async () => {
    const r = await engine.go({ fen: lesson.fen, depth: 16, multipv: 1, options: ANALYSIS });
    const score = r.lines[0].score;
    const cp = scoreToCp(score); // side to move = the player
    if (lesson.goal === 'hold') assert.ok(Math.abs(cp) <= 100, `${lesson.id}: ${cp} is not a draw`);
    else assert.ok(cp >= 400, `${lesson.id}: ${cp} is not clearly winning`);
    if (lesson.goal === 'mate' && score.mate) assert.ok(score.mate <= lesson.moves, `${lesson.id}: mate in ${score.mate} > ${lesson.moves}`);
  });
}

// Stockfish playing the player's side must reach every playout goal against Stockfish.
for (const lesson of ALL_LESSONS.filter((l) => l.type === 'playout')) {
  test(`${lesson.id}: Stockfish reaches the goal within ${lesson.moves} moves`, async () => {
    const playout = createPlayout(lesson);
    for (let i = 0; i < 2 * lesson.moves + 2 && !playout.over; i++) {
      const moves = playout.game.history({ verbose: true }).map((m) => m.uci);
      const players = playout.game.turn() === playout.playerColor;
      // The player side searches deeper: without tablebases a shallow search shuffles in K+R v K.
      const r = await engine.go({ fen: lesson.fen, moves, depth: players ? 20 : 14, multipv: players ? 4 : 1, options: ANALYSIS });
      let choice = r.bestmove;
      // Without tablebases Stockfish shuffles in won pawn endings; like a human, push the pawn
      // whenever that keeps a winning score.
      if (players && lesson.goal === 'promote') {
        const pawn = new Set(playout.game.legalMoves().filter((m) => m.piece === 'p').map((m) => m.uci));
        const push = r.lines.find((l) => pawn.has(l.pv[0]) && scoreToCp(l.score) >= 400);
        if (push) choice = push.pv[0];
      }
      const outcome = players ? playout.playerMove(choice) : playout.opponentMove(choice);
      assert.notEqual(outcome.result, 'illegal', `${lesson.id}: engine move ${choice} rejected`);
    }
    assert.equal(playout.result, 'won', `${lesson.id}: ${playout.game.history().join(' ')}`);
  });
}
