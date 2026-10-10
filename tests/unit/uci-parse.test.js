import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInfo, parseBestmove, parseOption } from '../../public/js/engine/uci-parse.js';

test('parseInfo reads centipawn lines with multipv and pv', () => {
  const info = parseInfo('info depth 12 seldepth 14 multipv 2 score cp -31 nodes 12743 nps 579227 hashfull 4 time 22 pv e2e4 c7c5 b1c3');
  assert.equal(info.depth, 12);
  assert.equal(info.multipv, 2);
  assert.deepEqual(info.score, { cp: -31 });
  assert.equal(info.bound, null);
  assert.deepEqual(info.pv, ['e2e4', 'c7c5', 'b1c3']);
});

test('parseInfo reads mate scores, bounds and WDL', () => {
  assert.deepEqual(parseInfo('info depth 8 seldepth 2 multipv 1 score mate 1 nodes 1632 pv a1a8').score, { mate: 1 });
  assert.deepEqual(parseInfo('info depth 8 score mate -3 pv e1e2').score, { mate: -3 });
  assert.equal(parseInfo('info depth 9 score cp 40 lowerbound nodes 5 pv d2d4').bound, 'lower');
  assert.equal(parseInfo('info depth 9 score cp 40 upperbound pv d2d4').bound, 'upper');
  assert.deepEqual(parseInfo('info depth 10 multipv 1 score cp 20 wdl 120 820 60 nodes 9 pv g1f3').wdl, [120, 820, 60]);
});

test('parseInfo ignores lines without a score or pv', () => {
  assert.equal(parseInfo('info string NNUE evaluation using nn-61e7af4bb97d.nnue'), null);
  assert.equal(parseInfo('info depth 3 currmove e2e4 currmovenumber 1'), null);
  assert.equal(parseInfo('bestmove e2e4'), null);
});

test('parseBestmove handles ponder and (none)', () => {
  assert.deepEqual(parseBestmove('bestmove e2e4 ponder c7c5'), { bestmove: 'e2e4', ponder: 'c7c5' });
  assert.deepEqual(parseBestmove('bestmove e7e8q'), { bestmove: 'e7e8q', ponder: null });
  assert.deepEqual(parseBestmove('bestmove (none)'), { bestmove: null, ponder: null });
  assert.equal(parseBestmove('info depth 1'), null);
});

test('parseOption reads spin, check, button and string options', () => {
  assert.deepEqual(parseOption('option name UCI_Elo type spin default 1320 min 1320 max 3190'), { name: 'UCI_Elo', type: 'spin', default: 1320, min: 1320, max: 3190 });
  assert.deepEqual(parseOption('option name Skill Level type spin default 20 min 0 max 20'), { name: 'Skill Level', type: 'spin', default: 20, min: 0, max: 20 });
  assert.deepEqual(parseOption('option name UCI_LimitStrength type check default false'), { name: 'UCI_LimitStrength', type: 'check', default: false });
  assert.deepEqual(parseOption('option name Clear Hash type button'), { name: 'Clear Hash', type: 'button' });
  assert.deepEqual(parseOption('option name EvalFile type string default nn-61e7af4bb97d.nnue'), { name: 'EvalFile', type: 'string', default: 'nn-61e7af4bb97d.nnue' });
});
