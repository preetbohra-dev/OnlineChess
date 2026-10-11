// Game review (#/review/:id): every move graded by a full-strength engine, an evaluation graph,
// accuracy per side, the key moments, and "Retry" to find a better move where it went wrong.
// Also the list of recent games (#/games).
import { h, fill, liveRegion } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';
import { listGames, gameById, attachReview, markRetried } from '../store/games.js';
import { reviewGame, compactReview, expandReview, replay } from '../core/review.js';
import { explainMove } from '../core/explain.js';
import { GRADE_LABEL, winPercent, scoreToCp, classifyMove } from '../core/classify.js';
import { createGame } from '../core/rules.js';
import { ANALYSIS_OPTIONS } from '../engine/analysis.js';
import { playSound, soundForMove } from '../ui/sound.js';
import { bus } from '../core/events.js';

const GRADE_MARK = { great: '!!', best: '★', excellent: '', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' };
const KIND_NAME = { bot: 'vs computer', training: 'Coached game', online: 'Online', local: 'Pass and play' };
const BAD = new Set(['inaccuracy', 'mistake', 'blunder']);

const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function renderGames(outlet) {
  const games = listGames();
  outlet.append(h('div', { class: 'page menu', testid: 'games' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / Your games'),
    h('h1', {}, 'Your games'),
    games.length
      ? h('ul', { class: 'game-list' }, games.map((g) => h('li', {},
        h('a', { class: 'game-row', href: `#/review/${g.id}`, testid: `game-${g.id}` },
          h('span', { class: 'game-row-main' }, h('strong', {}, `${g.white} – ${g.black}`), h('span', { class: 'muted' }, `${KIND_NAME[g.kind] ?? g.kind} · ${shortDate(g.date)} · ${Math.ceil(g.moves.length / 2)} moves`)),
          h('span', { class: 'game-row-result' }, g.result),
          g.review?.accuracy?.[g.playerColor] != null ? h('span', { class: 'game-row-acc', title: 'Your accuracy' }, `${g.review.accuracy[g.playerColor]}%`) : h('span', { class: 'muted' }, g.review ? 'Reviewed' : 'Review ▸')))))
      : h('p', { class: 'muted' }, 'Finished games appear here, ready for review. ', h('a', { href: '#/play' }, 'Play a game'), '.')));
}

// Evaluation graph: White's winning chances per position, key moments marked; click to jump.
function evalGraph(evals, keyMoments, current, onPick) {
  const W = 300;
  const H = 60;
  const n = Math.max(1, evals.length - 1);
  const x = (i) => (i / n) * W;
  const y = (cp) => H - (winPercent(cp) / 100) * H;
  const points = evals.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'eval-graph');
  svg.setAttribute('role', 'img');
  const end = Math.round(winPercent(evals.at(-1) ?? 0));
  svg.setAttribute('aria-label', `Evaluation graph: White's winning chances over the game, ending at ${end}%. ${keyMoments.length} key moment${keyMoments.length === 1 ? '' : 's'} marked; use the move list to step through.`);
  svg.innerHTML = `<rect width="${W}" height="${H}" class="eg-bg"/>
    <polygon points="0,${H} ${points} ${W},${H}" class="eg-white"/>
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="eg-mid"/>
    ${keyMoments.map((p) => `<circle cx="${x(p)}" cy="${y(evals[p])}" r="3" class="eg-key"/>`).join('')}
    <line x1="${x(current)}" x2="${x(current)}" y1="0" y2="${H}" class="eg-cursor"/>`;
  svg.addEventListener('click', (e) => {
    const box = svg.getBoundingClientRect();
    onPick(Math.round(((e.clientX - box.left) / box.width) * n));
  });
  return svg;
}

export function renderReview(outlet, { params, query, startEngine }) {
  const record = gameById(params.id);
  if (!record) {
    outlet.append(h('div', { class: 'page menu' }, h('h1', {}, 'Game not found'), h('p', {}, 'Only the last 50 games are kept. ', h('a', { href: '#/games' }, 'Your games'))));
    return null;
  }
  const history = replay(record.startFen, record.moves).history({ verbose: true });
  const you = record.playerColor;
  const fast = query?.get('engine') === 'fast';
  let review = record.review ? expandReview(record.review, record.startFen, record.moves) : null;
  let ply = review ? (review.keyMoments.find((p) => history[p - 1].color === you) ?? 0) : 0;
  let progress = 0;
  let retry = null; // { ply, message, kind, busy }
  let engine = null;
  let destroyed = false;
  const live = liveRegion();

  const boardHost = h('div', { class: 'board-host' });
  const panel = h('div', { class: 'review-panel', testid: 'review-panel' });
  outlet.append(h('div', { class: 'game review', testid: 'review', dataset: { game: record.id } },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/games' }, 'Your games'), ' / Review'),
      h('h1', { class: 'game-title' }, `${record.white} – ${record.black} · ${record.result}`),
      live.el,
      panel)));

  const board = new BoardView(boardHost, {
    fen: record.startFen,
    orientation: you ?? 'w',
    legalMoves: (sq) => (retry && !retry.busy && !retry.solved ? createGame({ fen: history[retry.ply - 1].before }).legalMoves(sq) : []),
    onMove: (move) => tryRetry(move),
    choosePromotion,
  });

  const searchFn = (uci) => (fen, moves) => uci.go({ fen, moves, multipv: 2, options: ANALYSIS_OPTIONS, ...(fast ? { depth: 8 } : { movetime: 250 }) })
    .then((r) => (r.stale ? null : r));

  async function analyse() {
    engine = startEngine();
    try {
      const uci = await engine.ready;
      const result = await reviewGame({
        startFen: record.startFen,
        moves: record.moves,
        search: searchFn(uci),
        onProgress: (done, total) => { progress = done / total; if (!destroyed) render(); },
      });
      if (destroyed || !result) return;
      review = result;
      attachReview(record.id, compactReview(result));
      bus.emit('game:reviewed', { id: record.id });
      ply = review.keyMoments.find((p) => history[p - 1].color === you) ?? review.keyMoments[0] ?? 0;
      live.say(`Review ready. ${you ? `Your accuracy: ${review.accuracy[you]}%.` : ''}`);
      render();
    } catch {
      if (!destroyed) { progress = -1; render(); }
    }
  }

  function go(next) {
    retry = null;
    ply = Math.max(0, Math.min(history.length, next));
    render();
  }

  async function tryRetry(move) {
    const mine = retry; // the retry this attempt belongs to; navigation may replace it
    if (!mine || mine.busy) return;
    const m = review.moves[mine.ply - 1];
    const game = createGame({ fen: m.before });
    const r = game.move(move);
    if (!r.ok) return render();
    mine.busy = true;
    mine.tried = r;
    render();
    let playedCp;
    if (r.uci === m.analysis.bestMove) playedCp = m.analysis.bestCp;
    else if (game.status().over) playedCp = game.status().reason === 'checkmate' ? 10_000 : 0;
    else {
      try {
        const uci = await (engine ?? (engine = startEngine())).ready;
        const after = await uci.go({ fen: m.before, moves: [r.uci], multipv: 1, options: ANALYSIS_OPTIONS, ...(fast ? { depth: 8 } : { movetime: 300 }) });
        if (destroyed || after.stale || retry !== mine) return;
        playedCp = after.lines[0] ? -scoreToCp(after.lines[0].score) : 0;
      } catch {
        if (!destroyed && retry === mine) { mine.busy = false; mine.tried = null; mine.kind = 'wrong'; mine.message = 'The engine is not available right now.'; render(); }
        return;
      }
    }
    if (retry !== mine) return;
    const { grade } = classifyMove({ bestCp: m.analysis.bestCp, playedCp, isBest: r.uci === m.analysis.bestMove });
    mine.busy = false;
    if (!BAD.has(grade)) {
      mine.solved = true;
      mine.kind = 'success';
      mine.message = `${r.san} — ${GRADE_LABEL[grade].toLowerCase()}! That keeps the game on track${r.uci === m.analysis.bestMove ? '' : ` (the engine's top choice was ${sanFor(m.before, m.analysis.bestMove)})`}.`;
      playSound(soundForMove(r));
      if (markRetried(record.id, mine.ply)) bus.emit('review:retry-solved', { id: record.id, ply: mine.ply });
    } else {
      mine.tried = null;
      mine.kind = 'wrong';
      mine.message = `${r.san} is also a ${GRADE_LABEL[grade].toLowerCase()}. Try another move.`;
      playSound('notify');
    }
    render();
  }

  const sanFor = (fen, uci) => {
    const g = createGame({ fen });
    return g.move(uci).san ?? uci;
  };

  function render() {
    if (destroyed) return;
    const m = ply ? (review?.moves[ply - 1] ?? null) : null;
    const position = retry ? (retry.tried ? retry.tried.after : history[retry.ply - 1].before) : ply ? history[ply - 1].after : record.startFen;
    board.setPosition(position, true);
    board.highlight({ lastMove: retry ? (retry.tried ?? null) : history[ply - 1] ?? null });
    const explanation = m && !retry ? explainMove({ move: history[ply - 1], analysis: m.analysis, level: 'amateur', history: history.slice(0, ply) }) : null;
    board.setArrows(explanation ? explanation.arrows : []);
    board.setInput(retry && !retry.solved ? history[retry.ply - 1].color : null);
    panel.dataset.state = review ? 'ready' : progress < 0 ? 'failed' : 'analysing';
    panel.setAttribute('aria-busy', String(!review && progress >= 0));
    panel.dataset.ply = String(ply);

    const summary = review ? h('div', { class: 'review-summary', testid: 'review-summary' },
      ['w', 'b'].map((c) => h('div', { class: `acc-card${c === you ? ' you' : ''}` },
        h('span', { class: 'muted' }, `${c === 'w' ? record.white : record.black}${c === you ? ' (you)' : ''}`),
        h('strong', { testid: `accuracy-${c}` }, review.accuracy[c] == null ? '—' : `${review.accuracy[c]}%`),
        h('span', { class: 'acc-counts' }, ['great', 'best', 'inaccuracy', 'mistake', 'blunder'].filter((g) => review.counts[c][g]).map((g) => h('span', { dataset: { grade: g } }, `${review.counts[c][g]} ${GRADE_LABEL[g].toLowerCase()}${review.counts[c][g] > 1 && !g.startsWith('best') && !g.startsWith('great') ? 's' : ''}`)))))) : null;

    const moveList = h('ol', { class: 'review-moves', 'aria-label': 'Moves' },
      history.map((mv, i) => {
        const g = review?.moves[i]?.grade;
        return h('li', {},
          h('button', {
            type: 'button', class: `rv-move${i + 1 === ply ? ' current' : ''}`, testid: `rv-move-${i + 1}`, dataset: { grade: g ?? '' },
            'aria-label': `${Math.ceil((i + 1) / 2)}${mv.color === 'w' ? '.' : '...'} ${mv.san}${g ? `, ${GRADE_LABEL[g]}` : ''}`,
            onClick: () => go(i + 1),
          }, `${mv.color === 'w' ? `${Math.ceil((i + 1) / 2)}. ` : ''}${mv.san}${g ? GRADE_MARK[g] : ''}`));
      }));

    const nav = h('div', { class: 'review-nav', role: 'group', 'aria-label': 'Move navigation' },
      h('button', { class: 'btn btn-small', type: 'button', testid: 'rv-first', onClick: () => go(0), 'aria-label': 'Start' }, '⏮'),
      h('button', { class: 'btn btn-small', type: 'button', testid: 'rv-prev', onClick: () => go(ply - 1), 'aria-label': 'Previous move' }, '◂'),
      h('button', { class: 'btn btn-small', type: 'button', testid: 'rv-next', onClick: () => go(ply + 1), 'aria-label': 'Next move' }, '▸'),
      h('button', { class: 'btn btn-small', type: 'button', testid: 'rv-last', onClick: () => go(history.length), 'aria-label': 'End' }, '⏭'));

    const current = m ? h('div', { class: 'review-current', testid: 'review-current' },
      h('p', { class: 'rv-head' }, h('strong', {}, `${Math.ceil(ply / 2)}${m.color === 'w' ? '.' : '...'} ${m.san}`), ' ', h('span', { class: 'coach-grade', dataset: { grade: m.grade } }, GRADE_LABEL[m.grade])),
      retry ? h('p', { class: `lesson-feedback lesson-${retry.kind ?? 'prompt'}`, testid: 'retry-feedback' },
        retry.busy ? 'Checking your move…' : retry.message ?? `Find a better move for ${m.color === 'w' ? 'White' : 'Black'}.`)
        : explanation ? [h('p', {}, explanation.headline), h('ul', { class: 'coach-points' }, explanation.points.map((p) => h('li', { dataset: { kind: p.kind } }, p.text)))] : null,
      BAD.has(m.grade) && (!you || m.color === you) && !retry
        ? h('button', { class: 'btn btn-primary btn-small', type: 'button', testid: 'btn-retry', onClick: () => { retry = { ply }; render(); } }, '↻ Retry this move')
        : retry ? h('button', { class: 'btn btn-small', type: 'button', testid: 'btn-retry-done', onClick: () => go(ply) }, retry.solved ? 'Continue review' : 'Back to the review') : null) : null;

    const keys = review?.keyMoments.length ? h('div', { class: 'key-moments' },
      h('span', { class: 'muted' }, 'Key moments: '),
      review.keyMoments.map((p) => h('button', { class: 'btn btn-small', type: 'button', testid: `key-${p}`, onClick: () => go(p) }, `${Math.ceil(p / 2)}${history[p - 1].color === 'w' ? '.' : '...'} ${history[p - 1].san}`))) : null;

    fill(panel,
      review ? null : h('div', { class: 'review-progress', testid: 'review-progress' },
        progress < 0 ? h('p', {}, 'The engine could not analyse this game. Reload to try again.')
          : [h('p', {}, `Analysing the game… ${Math.round(progress * 100)}%`), h('div', { class: 'xp-bar', role: 'progressbar', 'aria-label': 'Analysis progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progress * 100) }, h('span', { style: `width: ${Math.round(progress * 100)}%` }))]),
      summary,
      review ? evalGraph(review.evals, review.keyMoments, ply, go) : null,
      keys,
      current,
      nav,
      moveList);
  }

  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return; // keep browser shortcuts (Alt+← is Back)
    if (e.target.closest?.('input, textarea, select, [contenteditable], [role="dialog"]') || document.querySelector('.modal-backdrop.show, dialog[open]')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1); }
  };
  document.addEventListener('keydown', onKey);
  render();
  if (!review) analyse();
  return () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    engine?.stop();
    board.destroy();
  };
}
