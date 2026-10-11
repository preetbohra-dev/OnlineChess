import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock, parseTimeControl, formatClock } from '../../public/js/core/clock.js';

function fakeTime(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('parseTimeControl reads "minutes+seconds" and rejects nonsense', () => {
  assert.deepEqual(parseTimeControl('5+3'), { initialMs: 300_000, incrementMs: 3_000, id: '5+3' });
  assert.deepEqual(parseTimeControl('1+0'), { initialMs: 60_000, incrementMs: 0, id: '1+0' });
  assert.deepEqual(parseTimeControl('0.5+0'), { initialMs: 30_000, incrementMs: 0, id: '0.5+0' });
  assert.deepEqual(parseTimeControl('5 3'), { initialMs: 300_000, incrementMs: 3_000, id: '5+3' }, 'raw + in a URL decodes to a space');
  for (const bad of [null, '', 'none', '5', '0+0', '-1+2', '500+0', '5+120', '5+3+1', 'a+b', '1e3+0']) {
    assert.equal(parseTimeControl(bad), null, String(bad));
  }
});

test('no clock runs before the first move', () => {
  const time = fakeTime();
  const clock = createClock({ initialMs: 60_000, incrementMs: 0, now: time.now });
  time.advance(10_000);
  assert.equal(clock.remaining('w'), 60_000);
  assert.equal(clock.running(), null);
});

test('pressing after a move stops your clock, adds increment, and starts the opponent', () => {
  const time = fakeTime();
  const clock = createClock({ initialMs: 60_000, incrementMs: 2_000, now: time.now });
  clock.press('w'); // White's first move: White's clock was not running, so no increment
  assert.equal(clock.running(), 'b');
  assert.equal(clock.remaining('w'), 60_000);
  time.advance(5_000);
  assert.equal(clock.remaining('b'), 55_000);
  clock.press('b');
  assert.equal(clock.remaining('b'), 57_000, 'increment added after the move');
  assert.equal(clock.running(), 'w');
  time.advance(1_500);
  assert.equal(clock.remaining('w'), 58_500);
});

test('flag detection at the exact boundary and never negative', () => {
  const time = fakeTime();
  const clock = createClock({ initialMs: 1_000, incrementMs: 0, now: time.now });
  clock.press('w');
  time.advance(999);
  assert.equal(clock.flagged(), null);
  time.advance(1);
  assert.equal(clock.flagged(), 'b');
  time.advance(5_000);
  assert.equal(clock.remaining('b'), 0);
});

test('stop freezes both clocks', () => {
  const time = fakeTime();
  const clock = createClock({ initialMs: 10_000, incrementMs: 0, now: time.now });
  clock.press('w');
  time.advance(3_000);
  clock.stop();
  time.advance(60_000);
  assert.equal(clock.remaining('b'), 7_000);
  assert.equal(clock.running(), null);
  assert.equal(clock.flagged(), null);
});

test('a game that starts with Black to move starts the clock on Black\'s first move', () => {
  const time = fakeTime();
  const clock = createClock({ initialMs: 10_000, incrementMs: 0, now: time.now });
  clock.press('b');
  assert.equal(clock.running(), 'w');
});

test('sync adopts an authoritative snapshot', () => {
  const time = fakeTime();
  const clock = createClock({ initialMs: 60_000, incrementMs: 0, now: time.now });
  clock.sync({ w: 41_000, b: 12_000, running: 'b' });
  time.advance(2_000);
  assert.equal(clock.remaining('w'), 41_000);
  assert.equal(clock.remaining('b'), 10_000);
  clock.sync({ w: 41_000, b: -5, running: null });
  assert.equal(clock.remaining('b'), 0);
  assert.equal(clock.running(), null);
});

test('formatClock switches to tenths below exactly ten seconds', () => {
  assert.equal(formatClock(10_000), '0:10');
  assert.equal(formatClock(9_999), '0:09.9');
});

test('formatClock shows m:ss, and tenths under ten seconds', () => {
  assert.equal(formatClock(300_000), '5:00');
  assert.equal(formatClock(61_000), '1:01');
  assert.equal(formatClock(3_600_000), '60:00');
  assert.equal(formatClock(9_870), '0:09.8');
  assert.equal(formatClock(0), '0:00.0');
  assert.equal(formatClock(-5), '0:00.0');
});
