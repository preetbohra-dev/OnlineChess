// Training → Openings: the hub (15 openings by colour) and the trainer for one opening, with a
// Learn walkthrough (every move explained) and a Practice drill (play your side from memory).
import { h, fill, liveRegion } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';
import { OPENINGS, openingById } from '../data/openings.js';
import { completedOpenings, markOpeningComplete } from '../store/progress.js';
import { createOpeningDrill } from '../core/openings.js';
import { createGame } from '../core/rules.js';
import { playSound, soundForMove } from '../ui/sound.js';

const SIDE_NAME = { w: 'White', b: 'Black' };
const LEVEL_NAME = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

export function renderOpeningsHub(outlet) {
  const done = completedOpenings();
  const group = (side, blurb) => {
    const list = OPENINGS.filter((o) => o.side === side);
    return h('section', { class: 'menu-section', testid: `openings-${side}` },
      h('h2', {}, `Play as ${SIDE_NAME[side]} `, h('span', { class: 'track-progress' }, `${list.filter((o) => done.has(o.id)).length}/${list.length}`)),
      h('p', { class: 'muted' }, blurb),
      h('div', { class: 'lesson-grid' }, list.map((o) => h('a', {
        class: `lesson-card${done.has(o.id) ? ' done' : ''}`, href: `#/openings/${o.id}`, testid: `opening-${o.id}`,
      },
      h('span', { class: 'lesson-kind' }, `${o.eco} · ${LEVEL_NAME[o.level]}`),
      h('strong', {}, o.name),
      h('span', { class: 'muted' }, o.summary),
      done.has(o.id) ? h('span', { class: 'lesson-done', 'aria-label': 'Practised' }, '✓') : null))));
  };
  outlet.append(h('div', { class: 'page menu learn' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/train' }, 'Training Mode'), ' / Openings'),
    h('h1', {}, 'Openings'),
    h('p', { class: 'lede muted' }, 'Learn why each move is played, then practise the line from memory. A ✓ means you have played it through.'),
    group('w', 'Openings that start with your first move.'),
    group('b', 'Answers to 1.e4 and 1.d4.')));
}

function sanToMove(game, san) {
  return game.legalMoves().find((m) => m.san === san) ?? null;
}

export function renderOpening(outlet, { params, query }) {
  const opening = openingById(params.id);
  if (!opening) {
    outlet.append(h('div', { class: 'page menu' }, h('h1', {}, 'Opening not found'), h('p', {}, h('a', { href: '#/openings' }, 'Back to openings'))));
    return null;
  }
  const boardHost = h('div', { class: 'board-host lesson-board' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'lesson-panel', testid: 'opening-panel' });
  outlet.append(h('div', { class: 'game lesson', testid: 'opening', dataset: { opening: opening.id } },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/openings' }, 'Openings'), ` / ${opening.eco}`),
      h('h1', { class: 'game-title' }, opening.name),
      h('p', { class: 'muted opening-side' }, `You play ${SIDE_NAME[opening.side]} · ${LEVEL_NAME[opening.level]}`),
      tabs,
      panel)));

  let mode = query?.get('mode') === 'practice' ? 'practice' : 'learn';
  let input = null; // the active mode's move handler
  let replyTimer = null;
  let destroyed = false;
  const live = liveRegion();
  const board = new BoardView(boardHost, {
    fen: createGame().fen(),
    orientation: opening.side,
    legalMoves: (sq) => input?.legalMoves(sq) ?? [],
    onMove: (move) => input?.onMove(move),
    choosePromotion,
  });

  function setMode(next) {
    mode = next;
    clearTimeout(replyTimer);
    replyTimer = null;
    fill(tabs,
      ['learn', 'practice'].map((m) => h('button', {
        class: `tab${mode === m ? ' active' : ''}`, type: 'button', role: 'tab', testid: `tab-${m}`,
        'aria-selected': String(mode === m), onClick: () => setMode(m),
      }, m === 'learn' ? '📖 Learn' : '🎯 Practice')));
    if (mode === 'learn') learn(); else practice();
  }

  // Walkthrough: step through the line; ply 0 shows the opening's ideas.
  function learn() {
    let ply = 0;
    input = null;
    board.setInput(null);
    function render() {
      const game = createGame();
      opening.line.slice(0, ply).forEach(([san]) => game.move(san));
      const history = game.history({ verbose: true });
      board.setPosition(game.fen(), true);
      board.highlight({ lastMove: history.at(-1) ?? null });
      const next = opening.line[ply] ? sanToMove(game, opening.line[ply][0]) : null;
      board.setArrows(next ? [{ from: next.from, to: next.to, type: 'info' }] : []);
      const last = ply === opening.line.length;
      const [san, note] = opening.line[ply - 1] ?? [];
      const moveNo = Math.ceil(ply / 2);
      fill(panel,
        ply === 0
          ? h('div', { class: 'opening-intro' },
            h('p', { class: 'lesson-text', testid: 'opening-text' }, opening.summary),
            h('ul', { class: 'opening-ideas' }, opening.ideas.map((idea) => h('li', {}, idea))))
          : h('div', {},
            h('p', { class: 'lesson-step-count muted' }, `Move ${ply} of ${opening.line.length}`),
            h('p', { class: 'lesson-text', testid: 'opening-text' }, h('strong', {}, `${moveNo}.${ply % 2 ? '' : '..'} ${san} `), note)),
        h('div', { class: 'lesson-actions' },
          h('button', { class: 'btn', type: 'button', testid: 'btn-prev', disabled: ply === 0, onClick: () => { ply--; render(); } }, '◂ Back'),
          last
            ? h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-to-practice', onClick: () => setMode('practice') }, 'Practise it ▸')
            : h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-next', onClick: () => { ply++; playSound('move'); render(); } }, ply === 0 ? 'Start ▸' : 'Next ▸')));
    }
    render();
  }

  // Drill: play your side from memory. One miss shows the piece, two show the move.
  function practice() {
    const drill = createOpeningDrill(opening);
    let message = { kind: 'prompt', text: `Play the ${opening.name} as ${SIDE_NAME[opening.side]}. Make the first move of the line.` };
    let missesHere = 0;
    let busy = false;
    clearTimeout(replyTimer);
    replyTimer = null;
    input = {
      legalMoves: (sq) => (busy || drill.done ? [] : drill.game.legalMoves(sq)),
      onMove: (move) => attempt(move),
    };
    if (drill.ply) message = { kind: 'prompt', text: `${SIDE_NAME[opening.side === 'w' ? 'b' : 'w']} opened with ${drill.game.history().at(-1)}. Your move.` };

    function attempt(move) {
      if (destroyed || busy) return undefined;
      const r = drill.tryMove(move);
      if (r.result === 'illegal') return render();
      if (r.result === 'wrong') {
        missesHere++;
        // (Off-book moves are not judged here — some are fine, some are blunders; the trainer only teaches the line.)
        playSound('notify');
        message = { kind: 'wrong', text: `${r.move.san} is not the ${opening.name} main line. ${missesHere > 1 ? 'The arrow shows the book move.' : 'Try again — the highlighted piece moves next.'}` };
        return render();
      }
      missesHere = 0;
      const ply = drill.ply - (r.reply ? 2 : 1);
      playSound(soundForMove(r.move));
      if (r.result === 'done') {
        markOpeningComplete(opening.id);
        playSound('end');
        const perfect = drill.mistakes === 0;
        const notes = `${r.move.san} — ${drill.noteFor(ply)}${r.reply ? ` Then ${r.reply.san}: ${drill.noteFor(ply + 1)}` : ''}`;
        message = { kind: 'success', text: `${perfect ? 'Perfect! ' : ''}Line complete${perfect ? ' without a mistake' : ` with ${drill.mistakes} mistake${drill.mistakes === 1 ? '' : 's'}`}. ${notes}` };
        return render();
      }
      message = { kind: 'good', text: `${r.move.san} — ${drill.noteFor(ply)}${r.reply ? ` Then ${r.reply.san}: ${drill.noteFor(ply + 1)}` : ''}` };
      busy = Boolean(r.reply);
      render({ hideReply: busy });
      if (busy) {
        replyTimer = setTimeout(() => {
          replyTimer = null;
          if (destroyed) return;
          busy = false;
          playSound(soundForMove(r.reply));
          render();
        }, 450);
      }
      return undefined;
    }

    function render({ hideReply = false } = {}) {
      const history = drill.game.history({ verbose: true });
      const shown = hideReply ? history.length - 1 : history.length;
      const fen = shown === 0 ? createGame().fen() : history[shown - 1].after;
      const expected = !drill.done && !hideReply ? sanToMove(drill.game, drill.expected()) : null;
      board.setPosition(fen, true);
      board.highlight({ lastMove: history[shown - 1] ?? null, hint: missesHere >= 1 && expected ? expected.from : null });
      board.setArrows(missesHere >= 2 && expected ? [{ from: expected.from, to: expected.to, type: 'info' }] : []);
      board.setInput(drill.done ? null : opening.side);
      panel.dataset.state = drill.done ? 'done' : 'playing';
      live.say(message.text);
      fill(panel,
        live.el,
        h('p', { class: 'lesson-to-move' }, drill.done ? 'Line complete' : `Move ${Math.min(drill.ply + 1, opening.line.length)} of ${opening.line.length}`),
        h('p', { class: `lesson-feedback lesson-${message.kind}`, testid: 'lesson-feedback' }, message.text),
        h('div', { class: 'lesson-actions' },
          h('button', { class: 'btn', type: 'button', testid: 'btn-practice-again', onClick: () => practice() }, '↺ Restart'),
          drill.done ? h('a', {
            class: 'btn btn-primary', testid: 'btn-play-it-out',
            href: `#/play/bot?persona=amateur&color=${opening.side}&fen=${encodeURIComponent(drill.game.fen())}`,
          }, 'Play it out vs Rookie Rex ▸') : null,
          drill.done ? nextOpeningLink() : null));
    }
    render();
  }

  function nextOpeningLink() {
    const i = OPENINGS.findIndex((o) => o.id === opening.id);
    const next = OPENINGS[i + 1];
    return next
      ? h('a', { class: 'btn', href: `#/openings/${next.id}`, testid: 'btn-next-opening' }, 'Next opening ▸')
      : h('a', { class: 'btn', href: '#/openings', testid: 'btn-next-opening' }, 'All openings');
  }

  setMode(mode);
  return () => {
    destroyed = true;
    clearTimeout(replyTimer);
    board.destroy();
  };
}
