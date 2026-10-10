// Online rooms. The server is the only source of truth: it validates every move with the shared
// rules module, runs the clocks, and decides results. Clients only send intentions.
//
// A connection is { send(object), close(code, reason) }. Time and timers are injected so tests
// can drive the clock.
import crypto from 'node:crypto';
import { createGame, otherColor } from '../public/js/core/rules.js';
import { createClock, parseTimeControl } from '../public/js/core/clock.js';
import { EMOTES } from './protocol.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const EMOTE_COOLDOWN_MS = 1500;

export const defaultRoomId = () => Array.from({ length: 6 }, () => ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]).join('');
export const defaultToken = () => crypto.randomBytes(16).toString('base64url'); // 128 bits, 22 chars

function tokensEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createRoomManager({
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (handle) => clearTimeout(handle),
  maxRooms = 500,
  maxRoomsPerAddress = 5, // live rooms one client address may own
  createsPerHour = 20, // room creations per address per hour
  unjoinedMs = 3 * 60_000, // a room nobody joined, whose creator left, closes after this
  abandonMs = 60_000,
  idleMs = 30 * 60_000,
  finishedMs = 10 * 60_000,
  randomRoomId = defaultRoomId,
  randomToken = defaultToken,
} = {}) {
  const rooms = new Map();
  const seatsByConn = new Map(); // conn -> { room, color }
  const createdAt = new Map(); // address -> timestamps of recent room creations

  const error = (conn, code) => conn.send({ type: 'error', code });

  function newGame(room) {
    room.game = createGame();
    room.clock = room.timeControl ? createClock({ ...room.timeControl, now }) : null;
    room.rematch = new Set();
    room.finishedAt = null;
    room.lastEmote = { w: -Infinity, b: -Infinity };
    if (room.flagTimer) cancel(room.flagTimer);
    room.flagTimer = null;
  }

  function snapshot(room, color) {
    const { game, clock } = room;
    const opponent = room.seats[otherColor(color)];
    const absent = opponent && !opponent.conn ? opponent : null;
    return {
      type: 'state',
      room: room.id,
      you: color,
      tc: room.tc,
      players: {
        w: room.seats.w ? { name: room.seats.w.name, connected: Boolean(room.seats.w.conn) } : null,
        b: room.seats.b ? { name: room.seats.b.name, connected: Boolean(room.seats.b.conn) } : null,
      },
      moves: game.history({ verbose: true }).map((m) => m.uci),
      fen: game.fen(),
      ply: game.history().length,
      status: game.status(),
      drawOffer: game.drawOffer(),
      claimable: game.claimableDraws(),
      clock: clock ? { w: Math.round(clock.remaining('w')), b: Math.round(clock.remaining('b')), running: clock.running() } : null,
      rematch: { w: room.rematch.has('w'), b: room.rematch.has('b') },
      abandon: absent && !game.status().over
        ? { color: otherColor(color), claimableInMs: Math.max(0, abandonMs - (now() - absent.disconnectedAt)) }
        : null,
    };
  }

  function broadcast(room) {
    for (const color of ['w', 'b']) {
      const seat = room.seats[color];
      if (seat?.conn) seat.conn.send(snapshot(room, color));
    }
  }

  function finishIfOver(room) {
    if (!room.game.status().over || room.finishedAt != null) return;
    room.clock?.stop();
    if (room.flagTimer) cancel(room.flagTimer);
    room.flagTimer = null;
    room.finishedAt = now();
  }

  // FIDE 6.9 is applied by rules.flag().
  function checkFlag(room) {
    const flagged = room.clock?.flagged();
    if (!flagged || room.game.status().over) return false;
    room.game.flag(flagged);
    finishIfOver(room);
    return true;
  }

  function armFlagTimer(room) {
    if (room.flagTimer) cancel(room.flagTimer);
    room.flagTimer = null;
    const running = room.clock?.running();
    if (!running) return;
    room.flagTimer = schedule(() => {
      room.flagTimer = null;
      if (checkFlag(room)) broadcast(room);
      else armFlagTimer(room);
    }, room.clock.remaining(running) + 5);
  }

  function seat(room, color, name, conn) {
    const token = randomToken();
    room.seats[color] = { name, token, conn, disconnectedAt: null };
    seatsByConn.set(conn, { room, color });
    conn.send({ type: 'joined', room: room.id, color, token });
  }

  const handlers = {
    create(conn, msg, ctx) {
      if (rooms.size >= maxRooms) return error(conn, 'server_full');
      const address = ctx?.address ?? 'unknown';
      const owned = [...rooms.values()].filter((r) => r.creator === address).length;
      const recent = (createdAt.get(address) ?? []).filter((t) => now() - t < 3_600_000);
      if (owned >= maxRoomsPerAddress || recent.length >= createsPerHour) return error(conn, 'too_many_rooms');
      createdAt.set(address, [...recent, now()]);
      let id;
      do id = randomRoomId(); while (rooms.has(id));
      const color = msg.color === 'random' ? (crypto.randomInt(2) ? 'w' : 'b') : msg.color;
      const room = { id, creator: address, tc: msg.tc, timeControl: parseTimeControl(msg.tc), seats: { w: null, b: null }, lastActivity: now() };
      newGame(room);
      rooms.set(id, room);
      seat(room, color, msg.name, conn);
      broadcast(room);
    },

    join(conn, msg) {
      const room = rooms.get(msg.room);
      if (!room) return error(conn, 'room_not_found');
      const free = ['w', 'b'].find((c) => !room.seats[c]);
      if (!free) return error(conn, 'room_full');
      seat(room, free, msg.name, conn);
      broadcast(room);
    },

    resume(conn, msg) {
      const room = rooms.get(msg.room);
      if (!room) return error(conn, 'room_not_found');
      const color = ['w', 'b'].find((c) => room.seats[c] && tokensEqual(room.seats[c].token, msg.token));
      if (!color) return error(conn, 'bad_token');
      const s = room.seats[color];
      if (s.conn && s.conn !== conn) {
        seatsByConn.delete(s.conn);
        s.conn.close(4000, 'replaced');
      }
      s.conn = conn;
      s.disconnectedAt = null;
      seatsByConn.set(conn, { room, color });
      conn.send({ type: 'joined', room: room.id, color, token: s.token });
      broadcast(room);
    },

    move(conn, msg, room, color) {
      const { game } = room;
      if (game.status().over) return error(conn, 'game_over');
      if (!room.seats.w || !room.seats.b) return error(conn, 'waiting_for_opponent');
      if (checkFlag(room)) return broadcast(room);
      if (game.turn() !== color) return error(conn, 'not_your_turn');
      if (msg.ply !== game.history().length) return error(conn, 'stale_ply');
      const result = game.move({ from: msg.from, to: msg.to, promotion: msg.promotion });
      if (!result.ok) {
        error(conn, result.reason === 'promotion-required' ? 'promotion_required' : 'illegal_move');
        return conn.send(snapshot(room, color));
      }
      room.clock?.press(color);
      finishIfOver(room);
      if (room.finishedAt == null) armFlagTimer(room);
      broadcast(room);
    },

    resign(conn, msg, room, color) {
      if (!room.game.resign(color).ok) return error(conn, 'game_over');
      finishIfOver(room);
      broadcast(room);
    },

    offerDraw(conn, msg, room, color) {
      if (!room.game.offerDraw(color).ok) return error(conn, 'cannot_offer');
      finishIfOver(room);
      broadcast(room);
    },

    answerDraw(conn, msg, room, color) {
      const r = msg.accept ? room.game.acceptDraw(color) : room.game.declineDraw(color);
      if (!r.ok) return error(conn, 'no_offer');
      finishIfOver(room);
      broadcast(room);
    },

    // FIDE 9.2/9.3: a draw is claimed by the player whose turn it is.
    claimDraw(conn, msg, room, color) {
      if (room.game.turn() !== color) return error(conn, 'not_your_turn');
      if (!room.game.claimDraw(msg.kind).ok) return error(conn, 'not_claimable');
      finishIfOver(room);
      broadcast(room);
    },

    claimAbandon(conn, msg, room, color) {
      const opponent = room.seats[otherColor(color)];
      const absentFor = opponent && !opponent.conn ? now() - opponent.disconnectedAt : 0;
      if (room.game.status().over || absentFor < abandonMs) return error(conn, 'not_abandoned');
      room.game.abandon(otherColor(color));
      finishIfOver(room);
      broadcast(room);
    },

    rematch(conn, msg, room, color) {
      if (!room.game.status().over) return error(conn, 'game_in_progress');
      room.rematch.add(color);
      if (room.rematch.size === 2) {
        room.seats = { w: room.seats.b, b: room.seats.w }; // swap colours
        for (const c of ['w', 'b']) if (room.seats[c].conn) seatsByConn.set(room.seats[c].conn, { room, color: c });
        newGame(room);
      }
      broadcast(room);
    },

    emote(conn, msg, room, color) {
      if (now() - room.lastEmote[color] < EMOTE_COOLDOWN_MS) return undefined;
      room.lastEmote[color] = now();
      for (const c of ['w', 'b']) room.seats[c]?.conn?.send({ type: 'emote', from: color, id: msg.id, text: EMOTES[msg.id] });
      return undefined;
    },

    ping(conn, msg) {
      conn.send({ type: 'pong', t: msg.t });
    },
  };

  const ROOMLESS = new Set(['create', 'join', 'resume', 'ping']);

  return {
    rooms,

    // msg has already passed protocol validation. ctx: { address } of the client.
    handle(conn, msg, ctx = {}) {
      const binding = seatsByConn.get(conn);
      if (ROOMLESS.has(msg.type)) {
        if (binding && msg.type !== 'ping') return error(conn, 'already_in_room');
        return handlers[msg.type](conn, msg, ctx);
      }
      if (!binding) return error(conn, 'not_in_room');
      binding.room.lastActivity = now();
      return handlers[msg.type](conn, msg, binding.room, binding.color);
    },

    isBound: (conn) => seatsByConn.has(conn),

    disconnect(conn) {
      const binding = seatsByConn.get(conn);
      if (!binding) return;
      seatsByConn.delete(conn);
      const s = binding.room.seats[binding.color];
      if (s?.conn === conn) {
        s.conn = null;
        s.disconnectedAt = now();
        binding.room.lastActivity = now();
        broadcast(binding.room);
      }
    },

    // Drops idle rooms nobody is connected to, finished rooms after a grace period, and rooms
    // nobody ever joined once their creator has gone.
    gc() {
      for (const [id, room] of rooms) {
        const seats = ['w', 'b'].map((c) => room.seats[c]).filter(Boolean);
        const connected = seats.some((s) => s.conn);
        const idle = now() - room.lastActivity > idleMs;
        const finishedLongAgo = room.finishedAt != null && now() - room.finishedAt > finishedMs;
        const unjoined = seats.length < 2 && !connected && now() - room.lastActivity > unjoinedMs;
        if (unjoined || (!connected && (idle || finishedLongAgo)) || (connected && idle && finishedLongAgo)) {
          if (room.flagTimer) cancel(room.flagTimer);
          for (const s of seats) {
            if (!s.conn) continue;
            seatsByConn.delete(s.conn);
            s.conn.send({ type: 'error', code: 'room_closed' });
          }
          rooms.delete(id);
        }
      }
      for (const [address, times] of createdAt) {
        const recent = times.filter((t) => now() - t < 3_600_000);
        if (recent.length) createdAt.set(address, recent);
        else createdAt.delete(address);
      }
    },
  };
}
