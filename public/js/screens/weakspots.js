// Weak spots (#/weak-spots): today's cards — positions where you went wrong, to solve again.
import { h, fill, liveRegion } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';
import { createGame } from '../core/rules.js';
import { isRight, INTERVALS } from '../core/weakspots.js';
import { loadDeck, dueToday, answer } from '../store/weakspots.js';
import { playSound, soundForMove } from '../ui/sound.js';

export function renderWeakSpots(outlet) {
  const queue = dueToday();
  const deck = loadDeck();
  const mastered = deck.filter((c) => c.mastered).length;
  if (!queue.length) {
    outlet.append(h('div', { class: 'page menu', testid: 'weakspots' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Weak spots'),
      h('h1', {}, 'Weak spots'),
      h('p', { class: 'lede', testid: 'weakspots-empty' }, deck.length
        ? 'Nothing due today — well done. Cards come back on a schedule (after 1, 3, 7 and 21 days).'
        : 'No weak spots yet. Review a game or play a coached game: your mistakes become puzzles here.'),
      h('p', { class: 'muted' }, `${deck.length} card${deck.length === 1 ? '' : 's'} · ${mastered} mastered`),
      h('p', {}, h('a', { class: 'btn btn-primary', href: '#/games' }, 'Review a game'))));
    return null;
  }

  const boardHost = h('div', { class: 'board-host' });
  const panel = h('div', { class: 'lesson-panel', testid: 'weakspot-panel' });
  const live = liveRegion();
  outlet.append(h('div', { class: 'game lesson', testid: 'weakspots' },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Weak spots'),
      h('h1', { class: 'game-title' }, 'Weak spots'),
      live.el,
      panel)));

  let index = 0;
  let state = null; // { answered, right, tried }
  let right = 0;
  const card = () => queue[index];
  const board = new BoardView(boardHost, {
    fen: card().fen,
    orientation: createGame({ fen: card().fen }).turn(),
    legalMoves: (sq) => (state.answered ? [] : createGame({ fen: card().fen }).legalMoves(sq)),
    onMove: (m) => attempt(m),
    choosePromotion,
  });

  function show() {
    state = { answered: false };
    const color = createGame({ fen: card().fen }).turn();
    board.setOrientation(color);
    board.setPosition(card().fen, false);
    board.highlight({});
    board.setArrows([]);
    board.setInput(color);
    render();
  }

  function attempt(move) {
    if (state.answered) return;
    const game = createGame({ fen: card().fen });
    const r = game.move(move);
    if (!r.ok) return;
    const ok = isRight(card(), r.uci);
    state = { answered: true, right: ok, tried: r };
    const updated = answer(card().id, ok);
    if (ok && updated) right++;
    playSound(ok ? soundForMove(r) : 'notify');
    board.setPosition(game.fen(), true);
    board.setInput(null);
    const best = card().answers[0];
    if (!ok) board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4), type: 'success' }]);
    state.next = updated?.mastered ? 'mastered' : updated?.due;
    render();
  }

  const sanOf = (uci) => { const g = createGame({ fen: card().fen }); return g.move(uci).san ?? uci; };

  function render() {
    const c = card();
    const side = createGame({ fen: c.fen }).turn() === 'w' ? 'White' : 'Black';
    panel.dataset.state = state.answered ? (state.right ? 'right' : 'wrong') : 'asking';
    const message = !state.answered
      ? `You played ${c.played} here (a ${c.grade}). Find a better move for ${side}.`
      : state.right
        ? `${state.tried.san} — right! ${state.next === 'mastered' ? 'Card mastered.' : `See you again on ${state.next}.`}`
        : `${state.tried.san} is not it. The better move was ${sanOf(c.answers[0])}. This card comes back tomorrow.`;
    live.say(message);
    const last = index === queue.length - 1;
    fill(panel,
      h('p', { class: 'muted' }, `Card ${index + 1} of ${queue.length} due today · schedule ${INTERVALS.join(', ')} days`),
      h('p', { class: `lesson-feedback lesson-${!state.answered ? 'prompt' : state.right ? 'success' : 'wrong'}`, testid: 'weakspot-feedback' }, message),
      state.answered
        ? h('div', { class: 'lesson-actions' }, last
          ? h('a', { class: 'btn btn-primary', href: '#/', testid: 'btn-weakspots-done' }, `Done — ${right}/${queue.length} right`)
          : h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-next-card', onClick: () => { index++; show(); } }, 'Next card ▸'))
        : null);
    // After an answer, keyboard focus goes to the way forward.
    if (state.answered) panel.querySelector('[data-testid="btn-next-card"], [data-testid="btn-weakspots-done"]')?.focus();
  }

  show();
  return () => board.destroy();
}
