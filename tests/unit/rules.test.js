import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, describeResult, START_FEN } from '../../public/js/core/rules.js';

const play = (game, ...sans) => {
  for (const san of sans) {
    const r = game.move(san);
    assert.equal(r.ok, true, `expected ${san} to be legal in ${game.fen()}`);
  }
  return game;
};
const targets = (game, from) => game.legalMoves(from).map((m) => m.to).sort();
const SHUFFLE = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];

test('start position has 20 legal moves and white to move', () => {
  const g = createGame();
  assert.equal(g.fen(), START_FEN);
  assert.equal(g.turn(), 'w');
  assert.equal(g.legalMoves().length, 20);
});

test('illegal moves are rejected and leave the position unchanged', () => {
  const g = createGame();
  const before = g.fen();
  assert.deepEqual(g.move({ from: 'e2', to: 'e5' }), { ok: false, reason: 'illegal' });
  assert.equal(g.move({ from: 'e7', to: 'e5' }).ok, false, 'cannot move the opponent\'s piece');
  assert.equal(g.move({ from: 'z9', to: 'e4' }).ok, false);
  assert.equal(g.move(null).ok, false);
  assert.equal(g.move('--').ok, false, 'null moves are not chess moves');
  assert.equal(g.fen(), before);
});

test('moves accept {from,to}, SAN and UCI and report SAN', () => {
  const g = createGame();
  const r = g.move({ from: 'e2', to: 'e4' });
  assert.equal(r.ok, true);
  assert.equal(r.san, 'e4');
  assert.equal(g.move('e5').san, 'e5');
  assert.equal(g.move('g1f3').san, 'Nf3');
  assert.deepEqual(g.history(), ['e4', 'e5', 'Nf3']);
});

test('castling is illegal out of check', () => {
  const g = createGame({ fen: 'r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1' });
  assert.ok(g.inCheck());
  assert.ok(!targets(g, 'e1').includes('g1'));
  assert.ok(!targets(g, 'e1').includes('c1'));
});

test('castling is illegal through an attacked square but the b-file square may be attacked', () => {
  const through = createGame({ fen: 'r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1' });
  assert.ok(!targets(through, 'e1').includes('g1'));
  assert.ok(targets(through, 'e1').includes('c1'));
  const bFile = createGame({ fen: 'r3k2r/8/8/8/8/1r6/8/R3K2R w KQkq - 0 1' });
  assert.ok(targets(bFile, 'e1').includes('c1'), 'b1 under attack does not prevent O-O-O');
});

test('castling is illegal into check', () => {
  const g = createGame({ fen: 'r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1' });
  assert.ok(!targets(g, 'e1').includes('g1'));
});

test('castling moves the rook and rights are lost after king or rook moves or rook capture', () => {
  const g = createGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
  assert.equal(g.move('O-O').san, 'O-O');
  assert.equal(g.get('f1').type, 'r');
  assert.equal(g.fen().split(' ')[2], 'kq');

  const king = play(createGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' }), 'Kf1');
  assert.equal(king.fen().split(' ')[2], 'kq');

  const rook = play(createGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' }), 'Rh2');
  assert.equal(rook.fen().split(' ')[2], 'Qkq');

  const capture = play(createGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' }), 'Rxa8+');
  assert.equal(capture.fen().split(' ')[2], 'Kk');
});

test('en passant captures the passed pawn', () => {
  const g = createGame({ fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2' });
  const r = g.move('exd6');
  assert.equal(r.ok, true);
  assert.equal(r.flags.includes('e'), true);
  assert.equal(g.get('d5'), null);
  assert.equal(g.get('d6').type, 'p');
});

test('en passant is only available on the immediate reply', () => {
  const g = play(createGame({ fen: '4k3/3p3p/8/4P3/8/8/7P/4K3 b - - 0 1' }), 'd5');
  assert.ok(targets(g, 'e5').includes('d6'));
  play(g, 'h3', 'h6');
  assert.ok(!targets(g, 'e5').includes('d6'));
});

test('en passant is illegal when it exposes the king along the rank', () => {
  const pinned = createGame({ fen: '8/8/8/KPp4r/8/8/8/7k w - c6 0 2' });
  assert.ok(!targets(pinned, 'b5').includes('c6'));
  const noEp = createGame({ fen: '8/8/8/KPp4r/8/8/8/7k w - - 0 2' });
  assert.equal(pinned.positionKey(), noEp.positionKey(), 'an unusable ep square does not change the position');
  const usable = createGame({ fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2' });
  const unusable = createGame({ fen: '4k3/8/8/3pP3/8/8/8/4K3 w - - 0 2' });
  assert.notEqual(usable.positionKey(), unusable.positionKey());
});

test('promotion works for all four pieces and requires a choice', () => {
  for (const piece of ['q', 'r', 'b', 'n']) {
    const g = createGame({ fen: '8/P7/8/8/8/8/8/k6K w - - 0 1' });
    const r = g.move({ from: 'a7', to: 'a8', promotion: piece });
    assert.equal(r.ok, true);
    assert.deepEqual(g.get('a8'), { type: piece, color: 'w' });
  }
  const g = createGame({ fen: '8/P7/8/8/8/8/8/k6K w - - 0 1' });
  assert.deepEqual(g.move({ from: 'a7', to: 'a8' }), { ok: false, reason: 'promotion-required' });
  assert.equal(g.move({ from: 'a7', to: 'a8', promotion: 'k' }).ok, false);
  assert.ok(g.isPromotion('a7', 'a8'));
  assert.ok(!g.isPromotion('h1', 'h2'));
});

test('checkmate ends the game (fool\'s mate)', () => {
  const g = play(createGame(), 'f3', 'e5', 'g4', 'Qh4#');
  assert.deepEqual(g.status(), { over: true, result: '0-1', winner: 'b', reason: 'checkmate' });
  assert.equal(g.move('a3').ok, false);
  assert.equal(describeResult(g.status()), 'Black wins by checkmate');
});

test('stalemate is a draw', () => {
  const g = createGame({ fen: 'k7/8/1Q6/8/8/8/8/7K b - - 0 1' });
  assert.deepEqual(g.status(), { over: true, result: '1/2-1/2', winner: null, reason: 'stalemate' });
});

test('threefold repetition is claimable, not automatic', () => {
  const g = play(createGame(), ...SHUFFLE, ...SHUFFLE);
  assert.equal(g.status().over, false);
  assert.deepEqual(g.claimableDraws(), ['threefold']);
  assert.equal(g.claimDraw('fifty').ok, false);
  assert.equal(g.claimDraw('threefold').ok, true);
  assert.deepEqual(g.status(), { over: true, result: '1/2-1/2', winner: null, reason: 'threefold' });
});

test('fivefold repetition ends the game automatically', () => {
  const g = play(createGame(), ...SHUFFLE, ...SHUFFLE, ...SHUFFLE);
  assert.equal(g.status().over, false);
  play(g, ...SHUFFLE);
  assert.equal(g.status().reason, 'fivefold');
  assert.equal(g.status().over, true);
});

test('fifty-move rule is claimable at 100 half-moves', () => {
  const g = play(createGame({ fen: 'k7/8/8/8/8/8/8/K6R w - - 99 80' }), 'Rh2');
  assert.equal(g.status().over, false);
  assert.deepEqual(g.claimableDraws(), ['fifty']);
  assert.equal(g.claimDraw('fifty').ok, true);
  assert.equal(g.status().reason, 'fifty');
});

test('seventy-five-move rule ends the game automatically, but checkmate takes precedence', () => {
  const g = play(createGame({ fen: 'k7/8/8/8/8/8/8/K6R w - - 149 120' }), 'Rh2');
  assert.deepEqual(g.status(), { over: true, result: '1/2-1/2', winner: null, reason: 'seventyfive' });
  const mate = play(createGame({ fen: 'k7/8/1K6/8/8/8/8/7R w - - 149 120' }), 'Rh8#');
  assert.equal(mate.status().reason, 'checkmate');
});

test('insufficient material ends the game automatically', () => {
  assert.equal(createGame({ fen: 'k7/8/8/8/8/8/8/KB6 w - - 0 1' }).status().reason, 'insufficient');
  const g = play(createGame({ fen: 'k7/8/8/8/8/8/1r6/KN6 w - - 0 1' }), 'Kxb2');
  assert.equal(g.status().reason, 'insufficient');
});

test('resignation and the PGN Result/Termination headers', () => {
  const g = play(createGame(), 'e4');
  assert.equal(g.resign('w').ok, true);
  assert.deepEqual(g.status(), { over: true, result: '0-1', winner: 'b', reason: 'resign' });
  assert.equal(describeResult(g.status()), 'Black wins — White resigned');
  const pgn = g.pgn({ White: 'Ann', Black: 'Bob' });
  assert.match(pgn, /\[Result "0-1"\]/);
  assert.match(pgn, /\[Termination "Black wins — White resigned"\]/);
  assert.match(pgn, /\[White "Ann"\]/);
  assert.match(pgn, /1\. e4 0-1/);
  assert.equal(g.resign('b').ok, false, 'cannot resign a finished game');
});

test('draw offers: only the opponent can accept, and a move by the opponent declines it', () => {
  const g = createGame();
  assert.equal(g.offerDraw('w').ok, true);
  assert.equal(g.drawOffer(), 'w');
  assert.equal(g.acceptDraw('w').ok, false);
  play(g, 'e4');
  assert.equal(g.drawOffer(), 'w', 'offer survives the offerer\'s own move');
  play(g, 'e5');
  assert.equal(g.drawOffer(), null, 'opponent moving declines the offer');
  g.offerDraw('b');
  assert.equal(g.declineDraw('w').ok, true);
  assert.equal(g.drawOffer(), null);
  g.offerDraw('w');
  assert.equal(g.acceptDraw('b').ok, true);
  assert.deepEqual(g.status(), { over: true, result: '1/2-1/2', winner: null, reason: 'agreement' });
});

test('draw offer edge cases', () => {
  const g = createGame();
  assert.equal(g.declineDraw('w').ok, false, 'nothing to decline');
  assert.equal(g.offerDraw('w').ok, true);
  assert.deepEqual(g.offerDraw('w'), { ok: false, reason: 'already-offered' });
  assert.equal(g.offerDraw('b').ok, true, 'a counter-offer accepts the standing offer');
  assert.equal(g.status().reason, 'agreement');

  const h = play(createGame(), 'e4');
  h.offerDraw('b');
  h.undo();
  assert.equal(h.drawOffer(), null, 'takeback withdraws a pending offer');
});

test('a claimed draw can be taken back', () => {
  const g = play(createGame(), ...SHUFFLE, ...SHUFFLE);
  g.claimDraw('threefold');
  assert.equal(g.status().over, true);
  g.undo();
  assert.equal(g.status().over, false);
  assert.deepEqual(g.claimableDraws(), []);
  assert.equal(g.move('Ng8').ok, true);
});

test('repetition counts castling rights as part of the position', () => {
  const g = createGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
  const cycle = ['Rh2', 'Rh7', 'Rh1', 'Rh8'];
  play(g, ...cycle, ...cycle);
  assert.deepEqual(g.claimableDraws(), [], 'the start position had castling rights, so it is not a repeat');
  play(g, ...cycle);
  assert.deepEqual(g.claimableDraws(), ['threefold']);
});

test('undo restores the position and the repetition history', () => {
  const g = play(createGame(), ...SHUFFLE, ...SHUFFLE);
  assert.deepEqual(g.claimableDraws(), ['threefold']);
  g.undo();
  assert.deepEqual(g.claimableDraws(), []);
  play(g, 'Ng8');
  assert.deepEqual(g.claimableDraws(), ['threefold']);
  g.undo(); g.undo(); g.undo(); g.undo(); g.undo(); g.undo(); g.undo(); g.undo();
  assert.equal(g.fen(), START_FEN);
  assert.equal(g.undo(), null);
});

test('history exposes verbose moves with the FEN after each ply for review', () => {
  const g = play(createGame(), 'e4', 'c5');
  const h = g.history({ verbose: true });
  assert.equal(h.length, 2);
  assert.equal(h[1].san, 'c5');
  assert.equal(h[1].color, 'b');
  assert.equal(h[1].after, g.fen());
  assert.equal(h[0].before, START_FEN);
});

test('invalid FENs are rejected', () => {
  assert.throws(() => createGame({ fen: 'not a fen' }));
  assert.throws(() => createGame({ fen: '8/8/8/8/8/8/8/8 w - - 0 1' }));
});

test('describeResult covers every reason', () => {
  const cases = [
    [{ over: true, result: '1-0', winner: 'w', reason: 'checkmate' }, 'White wins by checkmate'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'stalemate' }, 'Draw by stalemate'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'insufficient' }, 'Draw by insufficient material'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'threefold' }, 'Draw by threefold repetition'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'fivefold' }, 'Draw by fivefold repetition'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'fifty' }, 'Draw by the fifty-move rule'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'seventyfive' }, 'Draw by the seventy-five-move rule'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'agreement' }, 'Draw by agreement'],
    [{ over: true, result: '1-0', winner: 'w', reason: 'timeout' }, 'White wins on time'],
    [{ over: true, result: '1/2-1/2', winner: null, reason: 'timeout-vs-insufficient' }, 'Draw — time ran out, but the opponent cannot checkmate'],
    [{ over: true, result: '0-1', winner: 'b', reason: 'abandon' }, 'Black wins — opponent left the game'],
    [{ over: false, result: null, winner: null, reason: null }, ''],
  ];
  for (const [status, text] of cases) assert.equal(describeResult(status), text);
});
