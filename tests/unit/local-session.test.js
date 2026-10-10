import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalSession } from '../../public/js/sessions/local-session.js';

function fakeTime() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('untimed sessions have no clock', () => {
  assert.equal(createLocalSession().clock, null);
});

test('a move made after the flag fell loses on time instead of being played', () => {
  const time = fakeTime();
  const s = createLocalSession({ timeControl: { initialMs: 5_000, incrementMs: 0 }, now: time.now });
  assert.equal(s.submitMove('e4').ok, true);
  time.advance(6_000);
  const r = s.submitMove('e5');
  assert.deepEqual(r, { ok: false, reason: 'flag' });
  assert.deepEqual(s.rules.status(), { over: true, result: '1-0', winner: 'w', reason: 'timeout' });
  assert.equal(s.clock.running(), null, 'clock stops when the game ends');
});

test('flag against a bare king is a draw (FIDE 6.9)', () => {
  const time = fakeTime();
  const s = createLocalSession({ fen: '7k/8/8/8/8/8/8/KQ6 b - - 0 1', timeControl: { initialMs: 5_000, incrementMs: 0 }, now: time.now });
  assert.equal(s.submitMove('Kg8').ok, true);
  time.advance(5_000);
  assert.equal(s.clock.flagged(), 'w');
  s.flag('w');
  assert.equal(s.rules.status().reason, 'timeout-vs-insufficient');
});

test('every way a game can end freezes the clock', () => {
  const make = () => {
    const time = fakeTime();
    const s = createLocalSession({ timeControl: { initialMs: 60_000, incrementMs: 0 }, now: time.now });
    s.submitMove('Nf3');
    return s;
  };
  const accept = make();
  accept.offerDraw('b');
  accept.acceptDraw('w');
  assert.equal(accept.clock.running(), null, 'agreement');

  const claim = make();
  for (const san of ['Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) claim.submitMove(san);
  claim.claimDraw('threefold');
  assert.equal(claim.clock.running(), null, 'claim');

  const mate = createLocalSession({ timeControl: { initialMs: 60_000, incrementMs: 0 }, now: fakeTime().now });
  for (const san of ['f3', 'e5', 'g4', 'Qh4#']) mate.submitMove(san);
  assert.equal(mate.rules.status().reason, 'checkmate');
  assert.equal(mate.clock.running(), null, 'checkmate');
});

test('no move is accepted after the game ended on time', () => {
  const time = fakeTime();
  const s = createLocalSession({ timeControl: { initialMs: 1_000, incrementMs: 0 }, now: time.now });
  s.submitMove('e4');
  time.advance(2_000);
  s.flag('b');
  assert.deepEqual(s.submitMove('e5'), { ok: false, reason: 'game-over' });
});

test('resigning stops the clock and emits a change', () => {
  const time = fakeTime();
  const s = createLocalSession({ timeControl: { initialMs: 60_000, incrementMs: 0 }, now: time.now });
  const seen = [];
  s.on('change', (d) => seen.push(d));
  s.submitMove('e4');
  s.resign('b');
  assert.equal(s.clock.running(), null);
  assert.deepEqual(seen.map((d) => d.action ?? 'move'), ['move', 'resign']);
});
