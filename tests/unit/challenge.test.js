import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChallenge, challengeUrl, challengeText } from '../../public/js/core/challenge.js';

const q = (s) => new URLSearchParams(s);

test('bot and Rush challenges round-trip through a link', () => {
  const bot = { kind: 'bot', personaId: 'grandmaster', moves: 34, accuracy: 92 };
  const url = challengeUrl('https://chess.example', bot);
  assert.equal(url, 'https://chess.example/#/challenge?bot=grandmaster&moves=34&acc=92');
  assert.deepEqual(parseChallenge(q(url.split('?')[1])), bot);
  const rush = { kind: 'rush', score: 17 };
  assert.deepEqual(parseChallenge(q(challengeUrl('', rush).split('?')[1])), rush);
  assert.match(challengeText(bot), /Magnus the Wizard \(Grand Master\) in 34 moves with 92% accuracy/);
  assert.match(challengeText(rush), /scored 17 in Puzzle Rush/);
});

test('anything unexpected makes the link invalid', () => {
  for (const bad of ['bot=hacker&moves=3', 'bot=novice', 'bot=novice&moves=0', 'bot=novice&moves=9999', 'bot=novice&moves=12&acc=150',
    'bot=novice&moves=1e3', 'bot=__proto__&moves=3', 'rush=0', 'rush=-4', 'rush=abc', '', 'other=1']) {
    assert.equal(parseChallenge(q(bad)), null, bad);
  }
  assert.deepEqual(parseChallenge(q('bot=novice&moves=12')), { kind: 'bot', personaId: 'novice', moves: 12, accuracy: null });
});

test('the sharer\'s own wording', () => {
  assert.match(challengeText({ kind: 'rush', score: 9 }, { self: true }), /^I scored 9/);
});

test('only a win against the computer from the start position can be shared', async () => {
  const { canShareWin } = await import('../../public/js/core/challenge.js');
  const { START_FEN } = await import('../../public/js/core/rules.js');
  const win = { over: true, winner: 'w', reason: 'checkmate' };
  assert.equal(canShareWin({ kind: 'bot', status: win, playerColor: 'w', startFen: START_FEN }), true);
  assert.equal(canShareWin({ kind: 'bot', status: win, playerColor: 'b', startFen: START_FEN }), false, 'a loss');
  assert.equal(canShareWin({ kind: 'bot', status: { over: true, winner: null }, playerColor: 'w', startFen: START_FEN }), false, 'a draw');
  assert.equal(canShareWin({ kind: 'local', status: win, playerColor: 'w', startFen: START_FEN }), false);
  assert.equal(canShareWin({ kind: 'bot', status: win, playerColor: 'w', startFen: '8/8/8/8/8/8/8/K6k w - - 0 1' }), false, 'set-up position');
});
