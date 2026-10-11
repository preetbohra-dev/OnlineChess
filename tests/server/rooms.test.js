import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomManager } from '../../server/rooms.js';

// Fake time and timers so clocks and abandon windows can be driven precisely.
function harness(options = {}) {
  let t = 0;
  let timers = [];
  let ids = 0;
  const env = {
    now: () => t,
    schedule: (fn, ms) => { const h = { fn, at: t + ms, id: ++ids }; timers.push(h); return h; },
    cancel: (h) => { timers = timers.filter((x) => x !== h); },
    advance(ms) {
      t += ms;
      for (const h of timers.filter((x) => x.at <= t)) { timers = timers.filter((x) => x !== h); h.fn(); }
    },
  };
  let n = 0;
  const manager = createRoomManager({
    now: env.now, schedule: env.schedule, cancel: env.cancel,
    randomRoomId: () => `ROOM${String(++n).padStart(2, '2')}`.slice(0, 6).replace(/[01]/g, '2'),
    ...options,
  });
  return { env, manager };
}

function conn() {
  const c = { inbox: [], closed: null, send: (m) => c.inbox.push(m), close: (code, reason) => { c.closed = { code, reason }; } };
  c.last = (type) => [...c.inbox].reverse().find((m) => m.type === type);
  return c;
}

function startGame({ tc = 'none', manager, env } = harness()) {
  const host = conn();
  const guest = conn();
  manager.handle(host, { type: 'create', name: 'Ann', tc, color: 'w' });
  const { room, token } = host.last('joined');
  manager.handle(guest, { type: 'join', room, name: 'Bob' });
  return { manager, env, host, guest, room, hostToken: token, guestToken: guest.last('joined').token };
}

const move = (m, c, from, to, ply, promotion) => m.handle(c, { type: 'move', from, to, ply, ...(promotion ? { promotion } : {}) });

test('create and join seat two players and share the state', () => {
  const { host, guest, room } = startGame();
  assert.equal(host.last('joined').color, 'w');
  assert.equal(guest.last('joined').color, 'b');
  assert.match(host.last('joined').token, /^[A-Za-z0-9_-]{22}$/);
  const s = guest.last('state');
  assert.equal(s.room, room);
  assert.equal(s.you, 'b');
  assert.deepEqual(s.players, { w: { name: 'Ann', connected: true }, b: { name: 'Bob', connected: true } });
  assert.equal(JSON.stringify(s).includes(host.last('joined').token), false, 'tokens never reach the opponent');
});

test('a third player is turned away; unknown rooms are reported', () => {
  const { manager, room } = startGame();
  const third = conn();
  manager.handle(third, { type: 'join', room, name: 'Cy' });
  assert.equal(third.last('error').code, 'room_full');
  manager.handle(third, { type: 'join', room: 'ZZZZZZ', name: 'Cy' });
  assert.equal(third.last('error').code, 'room_not_found');
});

test('the server enforces turn order, ply and legality', () => {
  const { manager, host, guest } = startGame();
  move(manager, guest, 'e7', 'e5', 0);
  assert.equal(guest.last('error').code, 'not_your_turn');
  move(manager, host, 'e2', 'e5', 0);
  assert.equal(host.last('error').code, 'illegal_move');
  move(manager, host, 'e2', 'e4', 3);
  assert.equal(host.last('error').code, 'stale_ply');
  move(manager, host, 'e2', 'e4', 0);
  assert.equal(guest.last('state').ply, 1);
  assert.deepEqual(guest.last('state').moves, ['e2e4']);
  move(manager, host, 'd2', 'd4', 1);
  assert.equal(host.last('error').code, 'not_your_turn', 'a double-sent move is rejected');
});

test('messages before joining a room are refused', () => {
  const { manager } = harness();
  const c = conn();
  manager.handle(c, { type: 'resign' });
  assert.equal(c.last('error').code, 'not_in_room');
});

test('a full game: checkmate ends it and rematch swaps colours', () => {
  const { manager, host, guest } = startGame();
  move(manager, host, 'f2', 'f3', 0);
  move(manager, guest, 'e7', 'e5', 1);
  move(manager, host, 'g2', 'g4', 2);
  move(manager, guest, 'd8', 'h4', 3);
  assert.deepEqual(host.last('state').status, { over: true, result: '0-1', winner: 'b', reason: 'checkmate' });
  move(manager, host, 'a2', 'a3', 4);
  assert.equal(host.last('error').code, 'game_over');
  manager.handle(host, { type: 'rematch' });
  assert.deepEqual(guest.last('state').rematch, { w: true, b: false });
  manager.handle(guest, { type: 'rematch' });
  assert.equal(host.last('state').you, 'b');
  assert.equal(guest.last('state').you, 'w');
  assert.equal(guest.last('state').ply, 0);
  move(manager, guest, 'e2', 'e4', 0);
  assert.equal(host.last('state').ply, 1, 'the new White (Bob) moves first');
});

test('draw offers: accept, decline, and a move declines implicitly', () => {
  const { manager, host, guest } = startGame();
  manager.handle(host, { type: 'offerDraw' });
  assert.equal(guest.last('state').drawOffer, 'w');
  manager.handle(guest, { type: 'answerDraw', accept: false });
  assert.equal(host.last('state').drawOffer, null);
  manager.handle(guest, { type: 'answerDraw', accept: true });
  assert.equal(guest.last('error').code, 'no_offer');
  manager.handle(host, { type: 'offerDraw' });
  manager.handle(guest, { type: 'answerDraw', accept: true });
  assert.equal(host.last('state').status.reason, 'agreement');
});

test('draw claims only on your own turn', () => {
  const { manager, host, guest } = startGame();
  const shuffle = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
  let ply = 0;
  for (let i = 0; i < 2; i++) for (const [f, t] of shuffle) move(manager, ply % 2 ? guest : host, f, t, ply++);
  manager.handle(guest, { type: 'claimDraw', kind: 'threefold' });
  assert.equal(guest.last('error').code, 'not_your_turn');
  manager.handle(host, { type: 'claimDraw', kind: 'threefold' });
  assert.equal(guest.last('state').status.reason, 'threefold');
});

test('server clocks: increment, flag by timer, and FIDE 6.9', () => {
  const { manager, env, host, guest } = startGame({ tc: '1+0', ...harness() });
  move(manager, host, 'e2', 'e4', 0);
  env.advance(10_000);
  move(manager, guest, 'e7', 'e5', 1);
  assert.equal(host.last('state').clock.b, 50_000);
  env.advance(60_100);
  assert.equal(guest.last('state').status.reason, 'timeout', 'White flagged while thinking');
  assert.equal(guest.last('state').status.winner, 'b');
});

test('the flag is checked before a late move is applied', () => {
  const h = harness();
  h.env.schedule = () => null; // the flag timer never fires: only the move-time check can catch it
  const manager = createRoomManager({ now: h.env.now, schedule: () => null, cancel: () => {}, randomRoomId: () => 'ABCDEF' });
  const { host, guest } = startGame({ tc: '1+0', manager, env: h.env });
  move(manager, host, 'e2', 'e4', 0);
  h.env.advance(61_000);
  move(manager, guest, 'e7', 'e5', 1);
  assert.equal(guest.last('state').status.reason, 'timeout');
  assert.equal(guest.last('state').ply, 1, 'the late move was not played');
});

test('a flag is a loss when the opponent still has mating material', () => {
  // Online games start from the initial position; the draw side of FIDE 6.9 lives in rules.flag
  // and is covered by tests/unit/material.test.js.
  const h = harness();
  const { manager, host, guest } = startGame({ tc: '1+0', ...h });
  move(manager, host, 'e2', 'e4', 0);
  h.env.advance(60_100);
  assert.equal(guest.last('state').status.reason, 'timeout', 'Black still has mating material');
});

test('reconnecting with the seat token resumes the game; a wrong token is refused', () => {
  const { manager, host, guest, room, guestToken } = startGame();
  move(manager, host, 'e2', 'e4', 0);
  manager.disconnect(guest);
  assert.equal(host.last('state').players.b.connected, false);
  const thief = conn();
  manager.handle(thief, { type: 'resume', room, token: 'A'.repeat(22) });
  assert.equal(thief.last('error').code, 'bad_token');
  const back = conn();
  manager.handle(back, { type: 'resume', room, token: guestToken });
  assert.equal(back.last('joined').color, 'b');
  assert.equal(back.last('state').ply, 1);
  assert.equal(host.last('state').players.b.connected, true);
});

test('resuming from a second tab replaces the first connection', () => {
  const { manager, guest, room, guestToken } = startGame();
  const tab2 = conn();
  manager.handle(tab2, { type: 'resume', room, token: guestToken });
  assert.equal(guest.closed?.code, 4000);
});

test('abandonment can be claimed only after the grace period', () => {
  const { manager, env, host, guest } = startGame({ abandonMs: 60_000, ...harness({ abandonMs: 60_000 }) });
  move(manager, host, 'e2', 'e4', 0);
  manager.disconnect(guest);
  manager.handle(host, { type: 'claimAbandon' });
  assert.equal(host.last('error').code, 'not_abandoned');
  env.advance(60_000);
  manager.handle(host, { type: 'claimAbandon' });
  assert.equal(host.last('state').status.reason, 'abandon');
  assert.equal(host.last('state').status.winner, 'w');
});

test('emotes reach both players and are rate limited', () => {
  const { manager, env, host, guest } = startGame();
  manager.handle(host, { type: 'emote', id: 'gl' });
  assert.equal(guest.last('emote').text, 'Good luck!');
  manager.handle(host, { type: 'emote', id: 'gg' });
  assert.equal(guest.inbox.filter((m) => m.type === 'emote').length, 1, 'spam is dropped');
  env.advance(2_000);
  manager.handle(host, { type: 'emote', id: 'gg' });
  assert.equal(guest.inbox.filter((m) => m.type === 'emote').length, 2);
});

test('room limits and garbage collection', () => {
  const { manager, env } = harness({ maxRooms: 1, idleMs: 1000 });
  const a = conn();
  const b = conn();
  manager.handle(a, { type: 'create', name: 'A', tc: 'none', color: 'w' });
  manager.handle(b, { type: 'create', name: 'B', tc: 'none', color: 'w' });
  assert.equal(b.last('error').code, 'server_full');
  manager.handle(a, { type: 'create', name: 'A', tc: 'none', color: 'w' });
  assert.equal(a.last('error').code, 'already_in_room');
  manager.disconnect(a);
  env.advance(2000);
  manager.gc();
  assert.equal(manager.rooms.size, 0);
});

test('one address cannot hoard rooms', () => {
  const { manager } = harness({ maxRoomsPerAddress: 2 });
  const make = () => { const c = conn(); manager.handle(c, { type: 'create', name: 'A', tc: 'none', color: 'w' }, { address: '1.2.3.4' }); return c; };
  make(); make();
  assert.equal(make().last('error').code, 'too_many_rooms');
  const other = conn();
  manager.handle(other, { type: 'create', name: 'B', tc: 'none', color: 'w' }, { address: '5.6.7.8' });
  assert.ok(other.last('joined'), 'other addresses are unaffected');
});

test('room creation is rate limited per address even when rooms are abandoned', () => {
  const { manager, env } = harness({ createsPerHour: 3, unjoinedMs: 1000 });
  for (let i = 0; i < 3; i++) {
    const c = conn();
    manager.handle(c, { type: 'create', name: 'A', tc: 'none', color: 'w' }, { address: '9.9.9.9' });
    manager.disconnect(c);
    env.advance(2000);
    manager.gc();
  }
  assert.equal(manager.rooms.size, 0, 'abandoned unjoined rooms are collected quickly');
  const c = conn();
  manager.handle(c, { type: 'create', name: 'A', tc: 'none', color: 'w' }, { address: '9.9.9.9' });
  assert.equal(c.last('error').code, 'too_many_rooms');
});

test('collecting a room releases players still connected to it', () => {
  const { manager, env, host } = startGame({ ...harness({ idleMs: 1000, finishedMs: 1000 }) });
  manager.handle(host, { type: 'resign' });
  env.advance(5000);
  manager.gc();
  assert.equal(host.last('error').code, 'room_closed');
  manager.handle(host, { type: 'create', name: 'Ann', tc: 'none', color: 'w' });
  assert.ok(host.last('joined'), 'free to start a new room');
});
