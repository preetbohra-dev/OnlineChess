// The shared game screen: board, player cards, status, move list with review, feed and controls.
//
// Every mode (local, bot, online, training) drives it through a session object:
//   kind, title            string identifiers for the mode
//   rules                  a core/rules.js Game the screen reads state from (fen, status, history, ...)
//   players                { w: {name, avatar}, b: {name, avatar} }
//   capabilities           { resign, offerDraw, claimDraw, autoFlip } — which controls/behaviour apply
//   clock?                 core/clock.js clock (remaining, running, flagged) or null when untimed
//   flag(color)            end the game on time for `color` (FIDE 6.9 applied by rules)
//   statusNote?()          extra status text, e.g. "Pip is thinking…"
//   on(event, fn)          'change' (after any state change; payload {move} or {action, color|kind})
//                          and 'feed' ({kind, text, avatar}); returns an unsubscribe function
//   inputColor()           'w' | 'b' | 'both' | null — who may move on this board now
//   actingColor()          the colour this device acts for (resign / offer draw)
//   submitMove(move)       returns rules.move()'s result
//   resign(c), offerDraw(c), acceptDraw(c), declineDraw(c), claimDraw(kind)
//   drawAnswerer?(offer)   colour that may answer an offer on this device, if any
//   resultTitle?(status)   custom game-over heading
//   destroy()              release resources; the screen owns the session and calls it on teardown
import { h, pieceGlyph, COLOR_NAME } from './dom.js';
import { BoardView } from './board-view.js';
import { openModal, confirmDialog, choosePromotion, closeAllModals } from './modal.js';
import { toast } from './toast.js';
import { describeResult, RULE_NOTES, otherColor } from '../core/rules.js';
import { bus } from '../core/events.js';
import { formatClock } from '../core/clock.js';
import { appSettings, ANIMATION_MS } from '../store/settings.js';
import { playSound, soundForMove } from './sound.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'];

function kingSquare(board, color) {
  return board.flat().find((p) => p && p.type === 'k' && p.color === color)?.square ?? null;
}

function materialScore(board, color) {
  return board.flat().reduce((sum, p) => sum + (p && p.color === color ? VALUE[p.type] : 0), 0);
}

function defaultResultTitle(status) {
  if (status.reason === 'checkmate') return 'Checkmate!';
  if (!status.winner) return 'Draw';
  return `${COLOR_NAME[status.winner]} wins`;
}

export async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied to clipboard`);
  } catch {
    const area = h('textarea', { class: 'copy-area', readonly: true, rows: 8, 'aria-label': label });
    area.value = text;
    openModal({ title: `Copy ${label}`, body: [h('p', { class: 'muted' }, 'Select and copy the text below.'), area], actions: [{ label: 'Done', primary: true }] });
    area.select();
  }
}

function playerCard() {
  const avatar = h('span', { class: 'avatar', 'aria-hidden': 'true' });
  const name = h('span', { class: 'player-name' });
  const turnDot = h('span', { class: 'turn-dot', 'aria-hidden': 'true' });
  const captured = h('span', { class: 'captured' });
  const advantage = h('span', { class: 'material-adv' });
  const clock = h('div', { class: 'clock', role: 'timer', hidden: true });
  const el = h('div', { class: 'player-card' },
    avatar,
    h('div', { class: 'player-info' }, h('div', { class: 'player-line' }, name, turnDot), h('div', { class: 'player-material' }, captured, advantage)),
    clock);
  return {
    el,
    // ms === null hides the clock (untimed game).
    updateClock(color, ms, { running = false } = {}) {
      clock.hidden = ms === null;
      if (ms === null) return;
      clock.dataset.testid = `clock-${color}`;
      clock.textContent = formatClock(ms);
      clock.setAttribute('aria-label', `${color === 'w' ? 'White' : 'Black'} clock ${formatClock(ms)}`);
      clock.classList.toggle('running', running);
      clock.classList.toggle('low', ms < 10_000);
    },
    update({ color, player, capturedTypes, lead, toMove }) {
      el.dataset.color = color;
      el.classList.toggle('to-move', toMove);
      avatar.textContent = player.avatar ?? '';
      name.textContent = player.name;
      captured.replaceChildren(...capturedTypes.map((t) => h('span', { class: 'cap' }, pieceGlyph(otherColor(color), t))));
      captured.setAttribute('aria-label', capturedTypes.length ? `Captured: ${capturedTypes.join(', ')}` : 'No captures');
      advantage.textContent = lead > 0 ? `+${lead}` : '';
    },
  };
}

export function mountGameScreen(container, session, { orientation = 'w', onNewGame } = {}) {
  const { rules } = session;
  let reviewPly = null;
  let announcedEnd = rules.status().over;
  let bottomColor = orientation;
  let destroyed = false;
  let gameOverTimer = null;
  let lastLowSecond = null;
  let lowSecondColor = null;
  let autoFlippedAtPly = -1;
  const settings = appSettings();
  const prefs = settings.get();

  const boardHost = h('div', { class: 'board-host' });
  const topCard = playerCard();
  const bottomCard = playerCard();
  const banner = h('div', { class: 'status-banner', testid: 'status-banner', role: 'status', 'aria-live': 'polite' });
  const drawBar = h('div', { class: 'draw-offer', testid: 'draw-offer', hidden: true });
  const moveList = h('ol', { class: 'move-list', testid: 'move-list', 'aria-label': 'Moves' });
  const reviewLabel = h('span', { class: 'review-label' });
  const reviewBar = h('div', { class: 'review-bar', hidden: true }, reviewLabel,
    h('button', { class: 'btn btn-small', type: 'button', testid: 'btn-live', onClick: () => goLive() }, 'Back to live ▸'));
  const feed = h('ul', { class: 'feed', testid: 'feed', 'aria-live': 'polite', 'aria-label': 'Game messages' });
  // Mode-specific controls (online: invite link, emotes, rematch) rendered by the session.
  const extras = h('div', { class: 'session-extras', testid: 'session-extras' });

  const button = (testid, label, icon, onClick, title) =>
    h('button', { class: 'btn btn-control', type: 'button', testid, title: title ?? label, onClick }, h('span', { class: 'icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'label' }, label));
  const caps = session.capabilities ?? {};
  const btn = {
    resign: caps.resign ? button('btn-resign', 'Resign', '⚑', onResign, 'Resign the game') : null,
    offerDraw: caps.offerDraw ? button('btn-offer-draw', 'Draw', '½', onOfferDraw, 'Offer a draw') : null,
    claimDraw: caps.claimDraw ? button('btn-claim-draw', 'Claim', '⚖', onClaimDraw, 'Claim a draw by threefold repetition or the fifty-move rule') : null,
    newGame: button('btn-new-game', 'New', '↻', onNewGameClick, 'Start a new game'),
    hint: caps.hint ? button('btn-hint', 'Hint', '💡', () => Promise.resolve(session.hint()).catch(() => {}), 'Show a hint (press twice to reveal the move)') : null,
    takeback: caps.takeback ? button('btn-takeback', 'Undo', '↶', () => session.takeback(), 'Take back your last move') : null,
    flip: button('btn-flip', 'Flip', '⇅', onFlip, 'Flip the board'),
    copyPgn: button('btn-copy-pgn', 'PGN', '⧉', () => copyText(pgn(), 'PGN'), 'Copy the game as PGN'),
    copyFen: button('btn-copy-fen', 'FEN', '⧉', () => copyText(rules.fen(), 'FEN'), 'Copy the current position as FEN'),
  };
  const controls = h('div', { class: 'controls' },
    caps.hint || caps.takeback ? h('div', { class: 'control-group', role: 'group', 'aria-label': 'Training' }, [btn.hint, btn.takeback].filter(Boolean)) : null,
    h('div', { class: 'control-group', role: 'group', 'aria-label': 'Game actions' }, [btn.resign, btn.offerDraw, btn.claimDraw, btn.newGame].filter(Boolean)),
    h('div', { class: 'control-group', role: 'group', 'aria-label': 'Board and export' }, btn.flip, btn.copyPgn, btn.copyFen));

  const root = h('section', { class: 'game', testid: 'game', 'aria-label': session.title },
    h('div', { class: 'game-board-col' }, topCard.el, boardHost, bottomCard.el),
    h('aside', { class: 'game-side' },
      h('header', { class: 'game-side-head' }, h('h1', { class: 'game-title' }, session.title), banner),
      drawBar,
      h('div', { class: 'moves-panel' }, moveList, reviewBar),
      extras,
      feed,
      controls));
  container.append(root);

  const board = new BoardView(boardHost, {
    fen: rules.fen(),
    orientation,
    animationMs: ANIMATION_MS[prefs.animation],
    showCoordinates: prefs.showCoordinates,
    showLegalDots: () => settings.get().showLegalMoves,
    legalMoves: (square) => rules.legalMoves(square),
    onMove: (move) => {
      if (destroyed) return;
      const result = session.submitMove(move);
      if (!result.ok) render({ animate: false });
    },
    choosePromotion,
  });

  function pgn() {
    return rules.pgn({ White: session.players.w.name, Black: session.players.b.name });
  }

  function addFeed(kind, text, { avatar } = {}) {
    const item = h('li', { class: `feed-item feed-${kind}`, testid: 'feed-item', dataset: { kind } },
      avatar ? h('span', { class: 'feed-avatar', 'aria-hidden': 'true' }, avatar) : null,
      h('span', { class: 'feed-text' }, text));
    feed.append(item);
    while (feed.children.length > 60) feed.firstChild.remove();
    feed.scrollTop = feed.scrollHeight;
    return item;
  }

  function capturedBy(history, color) {
    return history.filter((m) => m.color === color && m.captured)
      .map((m) => m.captured)
      .sort((a, b) => CAPTURE_ORDER.indexOf(a) - CAPTURE_ORDER.indexOf(b));
  }

  function renderCards(history, status) {
    const boardNow = rules.board();
    const score = { w: materialScore(boardNow, 'w'), b: materialScore(boardNow, 'b') };
    for (const [card, color] of [[bottomCard, bottomColor], [topCard, otherColor(bottomColor)]]) {
      card.update({
        color,
        player: session.players[color],
        capturedTypes: capturedBy(history, color),
        lead: score[color] - score[otherColor(color)],
        toMove: !status.over && rules.turn() === color,
      });
    }
    renderClocks();
  }

  function renderClocks() {
    const clock = session.clock;
    for (const [card, color] of [[bottomCard, bottomColor], [topCard, otherColor(bottomColor)]]) {
      card.updateClock(color, clock ? clock.remaining(color) : null, { running: clock?.running() === color });
    }
  }

  // Clock loop: refresh the displays, flag a player whose time ran out, tick in the last 10 s.
  let ticks = 0;
  function tick() {
    if (destroyed) return;
    if (++ticks % 10 === 0 && session.needsTick?.()) session.renderExtras?.(extras);
    const clock = session.clock;
    if (!clock) return;
    const flagged = rules.status().over ? null : clock.flagged();
    if (flagged) {
      session.flag(flagged);
      return;
    }
    renderClocks();
    const running = clock.running();
    if (!running) return;
    const ms = clock.remaining(running);
    const second = Math.ceil(ms / 1000);
    if (ms < 10_000 && (second !== lastLowSecond || running !== lowSecondColor)) {
      lastLowSecond = second;
      lowSecondColor = running;
      playSound('lowtime');
    }
  }
  // Always ticking: an online game's clock only arrives with the first server message.
  const tickTimer = setInterval(tick, 100);

  // Pass and play: turn the board toward the player to move — once per move, so a manual Flip
  // sticks until the next move.
  function applyAutoFlip(status, ply) {
    if (!caps.autoFlip || !settings.get().autoFlip || status.over || reviewPly !== null) return;
    if (ply === autoFlippedAtPly) return;
    autoFlippedAtPly = ply;
    if (bottomColor !== rules.turn()) {
      bottomColor = rules.turn();
      board.setOrientation(bottomColor);
    }
  }

  function renderMoveList(history) {
    const firstColor = history[0]?.color ?? rules.turn();
    const startNumber = Number((history[0]?.before ?? rules.fen()).split(' ')[5]);
    const rows = [];
    let row = null;
    history.forEach((m, i) => {
      const ply = i + 1;
      if (m.color === 'w' || !row) {
        const number = startNumber + Math.floor((i + (firstColor === 'b' ? 1 : 0)) / 2);
        row = h('li', { class: 'move-row' }, h('span', { class: 'move-num' }, `${number}.`));
        if (m.color === 'b') row.append(h('span', { class: 'move-item placeholder' }, '…'));
        rows.push(row);
      }
      const active = reviewPly === ply || (reviewPly === null && ply === history.length);
      row.append(h('button', {
        class: `move-item${active ? ' active' : ''}`,
        type: 'button',
        testid: 'move-item',
        dataset: { ply: String(ply) },
        'aria-label': `Move ${ply}: ${m.san}`,
        onClick: () => review(ply),
      }, m.san));
    });
    moveList.replaceChildren(...rows);
    if (reviewPly === null) moveList.scrollTop = moveList.scrollHeight;
  }

  function renderDrawBar(status) {
    const offer = rules.drawOffer();
    const answerer = offer && !status.over ? (session.drawAnswerer?.(offer) ?? null) : null;
    drawBar.hidden = !offer || status.over;
    if (drawBar.hidden) return drawBar.replaceChildren();
    drawBar.replaceChildren(
      h('span', {}, `${COLOR_NAME[offer]} offers a draw.`),
      answerer ? h('span', { class: 'draw-actions' },
        h('button', { class: 'btn btn-small btn-primary', type: 'button', testid: 'btn-accept-draw', onClick: () => session.acceptDraw(answerer) }, `Accept (${COLOR_NAME[answerer]})`),
        h('button', { class: 'btn btn-small', type: 'button', testid: 'btn-decline-draw', onClick: () => session.declineDraw(answerer) }, 'Decline')) : null);
  }

  function render({ animate = true } = {}) {
    if (destroyed) return;
    const status = rules.status();
    const history = rules.history({ verbose: true });
    if (reviewPly !== null && reviewPly >= history.length) reviewPly = null;
    applyAutoFlip(status, history.length);
    root.dataset.orientation = bottomColor;
    root.dataset.fen = rules.fen();
    root.dataset.status = status.over ? 'over' : 'playing';
    root.dataset.result = status.result ?? '';
    root.dataset.reason = status.reason ?? '';
    root.dataset.review = String(reviewPly !== null);

    if (reviewPly === null) {
      board.setPosition(rules.fen(), animate);
      board.highlight({
        lastMove: history.at(-1) ?? null,
        check: !status.over || status.reason === 'checkmate' ? (rules.inCheck() ? kingSquare(rules.board(), rules.turn()) : null) : null,
        hint: session.hintSquare?.() ?? null,
      });
      board.setArrows(session.arrows?.() ?? []);
      board.setInput(status.over ? null : session.inputColor());
    } else {
      board.cancelInput();
      board.setInput(null);
      const fen = reviewPly === 0 ? history[0].before : history[reviewPly - 1].after;
      board.setPosition(fen, animate);
      board.highlight({ lastMove: history[reviewPly - 1] ?? null });
      board.setArrows([]);
    }

    banner.classList.toggle('over', status.over);
    banner.classList.toggle('check', !status.over && rules.inCheck());
    const note = status.over ? '' : (session.statusNote?.() ?? '');
    banner.textContent = status.over
      ? describeResult(status)
      : `${COLOR_NAME[rules.turn()]} to move${rules.inCheck() ? ' — check!' : ''}${note ? ` · ${note}` : ''}`;

    renderCards(history, status);
    renderMoveList(history);
    renderDrawBar(status);
    session.renderExtras?.(extras);
    reviewBar.hidden = reviewPly === null;
    reviewLabel.textContent = reviewPly === null ? '' : reviewPly === 0 ? 'Viewing the starting position' : `Viewing move ${reviewPly} of ${history.length}`;

    const claimable = rules.claimableDraws();
    if (btn.resign) btn.resign.disabled = status.over;
    if (btn.hint) btn.hint.disabled = status.over || session.inputColor() === null;
    if (btn.takeback) btn.takeback.disabled = !(session.canTakeback?.() ?? rules.history().length > 0);
    if (btn.offerDraw) btn.offerDraw.disabled = status.over || rules.drawOffer() === session.actingColor();
    if (btn.claimDraw) {
      btn.claimDraw.disabled = status.over || !claimable.length;
      btn.claimDraw.classList.toggle('attention', claimable.length > 0);
      btn.claimDraw.title = claimable.includes('threefold') ? 'Claim a draw by threefold repetition'
        : claimable.includes('fifty') ? 'Claim a draw by the fifty-move rule'
          : 'A draw can be claimed after threefold repetition or fifty moves without a capture or pawn move';
    }

    if (!status.over) announcedEnd = false; // a takeback can reopen a finished game
    else if (!announcedEnd) {
      announcedEnd = true;
      addFeed('system', describeResult(status));
      playSound('end');
      board.cancelInput();
      closeAllModals(); // e.g. a promotion picker or resign confirmation left open when the flag fell
      clearTimeout(gameOverTimer);
      gameOverTimer = setTimeout(() => { if (!destroyed) showGameOver(status); }, animate ? 350 : 0);
      bus.emit('game:end', { kind: session.kind, status, pgn: pgn(), session });
    }
  }

  function showGameOver(status) {
    openModal({
      testid: 'game-over-modal',
      className: 'game-over',
      title: session.resultTitle?.(status) ?? defaultResultTitle(status),
      body: [
        h('p', { class: 'result-score', testid: 'game-result' }, status.result),
        h('p', { class: 'result-reason', testid: 'game-reason' }, describeResult(status)),
        RULE_NOTES[status.reason] ? h('p', { class: 'muted rule-note' }, RULE_NOTES[status.reason]) : null,
        session.resultDetails?.() ?? null,
      ],
      actions: [
        { label: 'Copy PGN', keepOpen: true, onClick: () => copyText(pgn(), 'PGN') },
        { label: 'Close', testid: 'btn-close-result' },
        onNewGame ? { label: 'Play again', testid: 'btn-play-again', primary: true, onClick: () => onNewGame() } : null,
      ].filter(Boolean),
    });
  }

  function review(ply) {
    const total = rules.history().length;
    if (ply >= total) return goLive();
    reviewPly = Math.max(0, ply);
    render({ animate: false });
  }

  function goLive() {
    reviewPly = null;
    render({ animate: false });
  }

  function step(delta) {
    const total = rules.history().length;
    if (!total) return;
    review(Math.min(total, Math.max(0, (reviewPly ?? total) + delta)));
  }

  async function onResign() {
    const color = session.actingColor();
    const ok = await confirmDialog({ title: `Resign as ${COLOR_NAME[color]}?`, message: 'The game ends and your opponent wins.', confirmLabel: 'Resign', danger: true });
    if (ok) session.resign(color);
  }

  function onOfferDraw() {
    const color = session.actingColor();
    if (session.offerDraw(color).ok && !rules.status().over) addFeed('system', `${COLOR_NAME[color]} offers a draw.`);
  }

  function onClaimDraw() {
    const [kind] = rules.claimableDraws();
    if (kind) session.claimDraw(kind);
  }

  function onFlip() {
    bottomColor = otherColor(bottomColor);
    board.setOrientation(bottomColor);
    render({ animate: false });
  }

  async function onNewGameClick() {
    const inProgress = !rules.status().over && rules.history().length > 0;
    if (inProgress && !(await confirmDialog({ title: 'Start a new game?', message: 'The current game will be abandoned.', confirmLabel: 'New game' }))) return;
    onNewGame?.();
  }

  function onKey(e) {
    if (e.target.closest('input, textarea, select') || document.querySelector('.modal-backdrop')) return;
    const keys = { ArrowLeft: () => step(-1), ArrowRight: () => step(1), Home: () => review(0), End: () => goLive() };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  }
  document.addEventListener('keydown', onKey);

  const offChange = session.on('change', (detail) => {
    if (detail?.move && !rules.status().over) playSound(soundForMove(detail.move));
    if (detail?.action === 'offerDraw') playSound('notify');
    if (detail?.action === 'declineDraw') addFeed('system', `${COLOR_NAME[detail.color]} declines the draw.`);
    if (detail?.action === 'acceptDraw') addFeed('system', `${COLOR_NAME[detail.color]} accepts the draw.`);
    render();
  });
  const offFeed = session.on('feed', ({ kind, text, avatar }) => addFeed(kind, text, { avatar }));
  const offSettings = settings.on('change', (s) => {
    board.setAnimationMs(ANIMATION_MS[s.animation]);
    render({ animate: false });
  });

  addFeed('system', rules.history().length || rules.fen().split(' ')[1] === 'b'
    ? `${COLOR_NAME[rules.turn()]} to move. Good luck!`
    : 'New game — White moves first. Good luck!');
  render({ animate: false });

  return {
    root,
    board,
    addFeed,
    render,
    destroy() {
      destroyed = true;
      clearTimeout(gameOverTimer);
      clearInterval(tickTimer);
      document.removeEventListener('keydown', onKey);
      offChange();
      offFeed();
      offSettings();
      board.destroy();
      session.destroy();
    },
  };
}
