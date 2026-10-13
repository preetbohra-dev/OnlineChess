// Online game session. The server is authoritative: this mirrors its state into a local rules
// object (for legal-move hints, SAN and the move list) and sends the player's intentions.
import { createGame, otherColor } from '../core/rules.js';
import { createEmitter } from '../core/events.js';
import { createClock, parseTimeControl } from '../core/clock.js';
import { h, COLOR_NAME } from '../ui/dom.js';
import { siteOrigin } from '../net/platform.js';

const ONGOING = { over: false, result: null, winner: null, reason: null };
export const EMOTE_BUTTONS = [['thumbs', '👍'], ['gl', 'Good luck!'], ['nice', 'Nice move!'], ['oops', 'Oops!'], ['gg', 'GG']];

// Rebuild a game from the server's move list, replaying the result the moves alone can't show.
function replay(moves, status) {
  const game = createGame();
  for (const uci of moves) game.move(uci);
  if (status?.over && !game.status().over) {
    const loser = status.winner ? otherColor(status.winner) : game.turn();
    if (status.reason === 'resign') game.resign(loser);
    else if (status.reason === 'abandon') game.abandon(loser);
    else if (status.reason === 'timeout' || status.reason === 'timeout-vs-insufficient') game.flag(loser);
    else if (status.reason === 'agreement') { game.offerDraw(game.turn()); game.acceptDraw(otherColor(game.turn())); }
    else if (status.reason === 'threefold' || status.reason === 'fifty') game.claimDraw(status.reason);
  }
  return game;
}

export function createOnlineSession({ client, roomId }) {
  const events = createEmitter();
  let state = null;
  let game = createGame();
  let clock = null;
  let lastConnected = { w: true, b: true };
  let abandonDeadline = null;

  const you = () => state?.you ?? 'w';
  const status = () => state?.status ?? ONGOING;
  const bothSeated = () => Boolean(state?.players.w && state?.players.b);

  // The view of the game the screen reads: local moves, server verdicts.
  const rules = {
    fen: () => game.fen(),
    turn: () => game.turn(),
    history: (o) => game.history(o),
    board: () => game.board(),
    inCheck: () => game.inCheck(),
    get: (sq) => game.get(sq),
    isPromotion: (from, to) => game.isPromotion(from, to),
    legalMoves: (sq) => (status().over ? [] : game.legalMoves(sq)),
    status: () => ({ ...status() }),
    drawOffer: () => state?.drawOffer ?? null,
    claimableDraws: () => (status().over || game.turn() !== you() ? [] : state?.claimable ?? []),
    pgn: (headers) => replay(state?.moves ?? [], status()).pgn(headers),
  };

  const players = { w: { name: 'White', avatar: '♔' }, b: { name: 'Black', avatar: '♚' } };
  const feed = (kind, text, avatar) => events.emit('feed', { kind, text, avatar });

  function applyState(next) {
    const first = !state;
    const previous = state;
    state = next;
    if (game.history().length !== next.ply || game.fen() !== next.fen || next.status.over !== game.status().over) {
      game = replay(next.moves, next.status);
    }
    for (const c of ['w', 'b']) {
      const p = next.players[c];
      players[c] = p
        ? { name: c === next.you ? `${p.name} (you)` : p.name, avatar: c === 'w' ? '♔' : '♚' }
        : { name: 'Waiting for opponent…', avatar: '⌛' };
    }
    if (next.clock) {
      const tc = parseTimeControl(next.tc);
      clock ??= createClock({ initialMs: tc?.initialMs ?? next.clock.w, incrementMs: tc?.incrementMs ?? 0 });
      clock.sync(next.clock);
    } else clock = null;
    session.clock = clock;

    const opp = otherColor(next.you);
    if (!first && previous.players[opp] && next.players[opp]) {
      if (lastConnected[opp] && !next.players[opp].connected) feed('system', `${next.players[opp].name} disconnected. Waiting for them to come back…`);
      if (!lastConnected[opp] && next.players[opp].connected) feed('system', `${next.players[opp].name} is back.`);
    }
    if (!first && !previous.players[opp] && next.players[opp]) feed('system', `${next.players[opp].name} joined. White moves first — good luck!`);
    if (!first && previous.drawOffer && !next.drawOffer && !next.status.over && next.ply === previous.ply) {
      feed('system', previous.drawOffer === next.you ? 'Your draw offer was declined.' : 'You declined the draw offer.');
    }
    if (!first && previous.ply > 0 && next.ply === 0 && previous.status.over) feed('system', `Rematch! You play ${COLOR_NAME[next.you]} this time.`);
    lastConnected = { w: next.players.w?.connected ?? true, b: next.players.b?.connected ?? true };
    abandonDeadline = next.abandon ? performance.now() + next.abandon.claimableInMs : null;
    events.emit('change', { action: 'state' });
  }

  const offState = client.on('state', applyState);
  const offEmote = client.on('emote', (m) => feed('emote', m.from === you() ? `You: ${m.text}` : m.text, m.from === you() ? '🙂' : '💬'));
  const offError = client.on('error', (m) => {
    const messages = { not_your_turn: 'Not your turn yet.', illegal_move: 'That move is not legal.', stale_ply: 'The board changed — move again.' };
    if (messages[m.code]) feed('system', messages[m.code]);
  });

  const session = {
    kind: 'online',
    title: `Online · Room ${roomId}`,
    roomId,
    rules,
    players,
    clock: null,
    capabilities: { resign: true, offerDraw: true, claimDraw: true },
    on: events.on,
    hasState: () => Boolean(state),
    needsTick: () => Boolean(state?.abandon),
    you,

    inputColor: () => (state && bothSeated() && !status().over && game.turn() === you() ? you() : null),
    actingColor: you,
    drawAnswerer: (offer) => (offer === otherColor(you()) ? you() : null),
    statusNote: () => (state && !bothSeated() ? 'waiting for your opponent to join' : ''),
    resultTitle: (s) => (s.winner === you() ? 'You win!' : s.winner ? 'You lost' : 'Draw'),
    flag: () => ({ ok: true }), // the server's clock decides; its timer sends the result

    submitMove(move) {
      const ply = game.history().length;
      const result = game.move(move); // optimistic; the server confirms or corrects
      if (!result.ok) return result;
      client.send({ type: 'move', from: result.from, to: result.to, ...(result.promotion ? { promotion: result.promotion } : {}), ply });
      if (clock) clock.press(result.color);
      events.emit('change', { move: result });
      return result;
    },
    resign: () => { client.send({ type: 'resign' }); return { ok: true }; },
    offerDraw: () => { client.send({ type: 'offerDraw' }); return { ok: true }; },
    acceptDraw: () => { client.send({ type: 'answerDraw', accept: true }); return { ok: true }; },
    declineDraw: () => { client.send({ type: 'answerDraw', accept: false }); return { ok: true }; },
    claimDraw: (kind) => { client.send({ type: 'claimDraw', kind }); return { ok: true }; },

    // Room-specific controls under the move list: share link, emotes, rematch, abandon claim.
    renderExtras(container) {
      const parts = [];
      if (state && !bothSeated()) {
        const link = `${siteOrigin()}/#/room/${roomId}`;
        const input = h('input', { class: 'room-link', testid: 'room-link', readonly: true, value: link, 'aria-label': 'Invite link' });
        parts.push(h('div', { class: 'invite' },
          h('strong', {}, 'Invite a friend'),
          h('span', { class: 'muted' }, 'Send them this link. The game starts when they join.'),
          h('div', { class: 'invite-row' }, input,
            h('button', {
              class: 'btn btn-primary btn-small', type: 'button', testid: 'btn-copy-link',
              onClick: async () => {
                try { await navigator.clipboard.writeText(link); feed('system', 'Invite link copied.'); }
                catch { input.select(); }
              },
            }, 'Copy'))));
      }
      if (state && bothSeated()) {
        parts.push(h('div', { class: 'emotes', role: 'group', 'aria-label': 'Quick messages' },
          EMOTE_BUTTONS.map(([id, label]) => h('button', { class: 'btn btn-small', type: 'button', testid: `emote-${id}`, onClick: () => client.send({ type: 'emote', id }) }, label))));
      }
      if (state && status().over && bothSeated()) {
        const mine = state.rematch[you()];
        const theirs = state.rematch[otherColor(you())];
        parts.push(h('button', {
          class: `btn ${theirs ? 'btn-primary' : ''}`, type: 'button', testid: 'btn-rematch', disabled: mine,
          onClick: () => client.send({ type: 'rematch' }),
        }, mine ? 'Rematch requested…' : theirs ? 'Accept rematch' : 'Rematch'));
      }
      if (state?.abandon && abandonDeadline !== null) {
        const left = Math.max(0, Math.ceil((abandonDeadline - performance.now()) / 1000));
        parts.push(h('div', { class: 'abandon' },
          h('span', {}, left ? `Opponent left. You can claim the win in ${left}s.` : 'Your opponent left the game.'),
          h('button', { class: 'btn btn-small btn-primary', type: 'button', testid: 'btn-claim-abandon', disabled: left > 0, onClick: () => client.send({ type: 'claimAbandon' }) }, 'Claim win')));
      }
      container.replaceChildren(...parts);
    },

    destroy() {
      offState();
      offEmote();
      offError();
      events.clear();
    },
  };
  return session;
}
