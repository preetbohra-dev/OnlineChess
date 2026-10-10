// Engine check for lesson puzzles: the intended first move must be (one of) the engine's best.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { ALL_LESSONS } from '../../public/js/data/lessons/index.js';
import { scoreToCp } from '../../public/js/core/classify.js';

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
