// Rated puzzles (#/puzzles) and Puzzle Rush (#/rush), from the bundled Lichess puzzle library.
import { h, fill, liveRegion } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';
import { createPuzzle } from '../core/puzzle.js';
import { parseRow, toLesson, choosePuzzle, THEMES, RUSH, rushTarget } from '../core/puzzle-library.js';
import { loadLibrary, loadPuzzleStats, recordPuzzle, recordRush, markSeen } from '../store/puzzle-stats.js';
import { playSound, soundForMove } from '../ui/sound.js';
import { prepareShare, sharePrepared } from '../ui/share.js';
import { challengeUrl, challengeText } from '../core/challenge.js';
import { siteOrigin } from '../net/platform.js';

const SETUP_MS = 500;

// One puzzle on a board: plays the opponent's setup move, then takes the solver's moves.
// onResult({ result: 'solved' | 'wrong' | 'correct', message }) after every attempt.
function mountPuzzle(board, lesson, onResult) {
  const puzzle = createPuzzle(lesson);
  const color = puzzle.game.turn();
  let ready = false;
  let busy = false;
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  board.setOrientation(color);
  board.setPosition(lesson.setupFen, false);
  board.highlight({});
  board.setArrows([]);
  board.setInput(null);
  later(() => {
    board.setPosition(lesson.fen, true);
    board.highlight({ lastMove: lesson.setupMove });
    playSound('move');
    ready = true;
    board.setInput(color);
  }, SETUP_MS);

  return {
    color,
    puzzle,
    legalMoves: (sq) => (ready && !busy && !puzzle.solved ? puzzle.game.legalMoves(sq) : []),
    attempt(move) {
      if (!ready || busy) return;
      const r = puzzle.tryMove(move);
      if (r.result === 'illegal') { board.setPosition(puzzle.game.fen(), false); return; }
      if (r.result === 'wrong') {
        board.setPosition(puzzle.game.fen(), true);
        playSound('notify');
        onResult({ result: 'wrong', message: r.message });
        return;
      }
      playSound(soundForMove(r.move));
      board.setPosition(puzzle.game.fen(), true);
      board.highlight({ lastMove: r.move });
      if (r.result === 'solved') { board.setInput(null); onResult({ result: 'solved' }); return; }
      busy = true;
      const shown = puzzle.game.history({ verbose: true });
      board.setPosition(shown[shown.length - 2].after, false);
      later(() => {
        busy = false;
        board.setPosition(puzzle.game.fen(), true);
        board.highlight({ lastMove: r.reply });
        playSound(soundForMove(r.reply));
      }, 350);
      onResult({ result: 'correct' });
    },
    // Play the rest of the solution on the board.
    showSolution() {
      busy = true;
      board.setInput(null);
      const game = puzzle.game;
      const rest = lesson.solution.slice(game.history().length);
      rest.forEach((uci, i) => later(() => {
        const m = game.move(uci);
        if (!m.ok) return;
        board.setPosition(game.fen(), true);
        board.highlight({ lastMove: m });
        playSound(soundForMove(m));
      }, 450 * (i + 1)));
    },
    hintSquare: () => puzzle.hintSquare(),
    destroy() { ready = false; timers.forEach(clearTimeout); timers = []; },
  };
}

function loadingPage(outlet, title) {
  const page = h('div', { class: 'page menu' }, h('h1', {}, title), h('p', { class: 'muted', testid: 'puzzles-loading' }, 'Loading puzzles…'));
  outlet.append(page);
  return page;
}

function failPage(page) {
  fill(page, h('h1', {}, 'Puzzles unavailable'), h('p', {}, 'The puzzle library could not be loaded. Check your connection and reload.'));
}

// Rated puzzles: one at a time near your rating, optionally of one theme.
export function renderPuzzles(outlet, { query }) {
  let destroyed = false;
  let cleanup = () => {};
  const requested = query?.get('theme');
  const theme = requested && Object.hasOwn(THEMES, requested) ? requested : null;
  const page = loadingPage(outlet, 'Puzzles');
  loadLibrary().then((rows) => {
    if (destroyed) return;
    page.remove();
    cleanup = mountRated(outlet, rows.map(parseRow), theme);
  }).catch(() => { if (!destroyed) failPage(page); });
  return () => { destroyed = true; cleanup(); };
}

function mountRated(outlet, puzzles, theme) {
  const boardHost = h('div', { class: 'board-host' });
  const panel = h('div', { class: 'lesson-panel', testid: 'puzzle-panel' });
  const live = liveRegion();
  outlet.append(h('div', { class: 'game lesson', testid: 'puzzles' },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/train' }, 'Training Mode'), ' / Puzzles'),
      h('h1', { class: 'game-title' }, theme ? `Puzzles: ${THEMES[theme]}` : 'Rated puzzles'),
      live.el,
      panel)));

  let current = null;
  let lesson = null;
  let state = null; // { failed, done, change, message, kind, hints }
  const board = new BoardView(boardHost, {
    fen: puzzles[0].fen,
    legalMoves: (sq) => current?.legalMoves(sq) ?? [],
    onMove: (m) => current?.attempt(m),
    choosePromotion,
  });

  function next() {
    current?.destroy();
    const stats = loadPuzzleStats();
    const p = choosePuzzle(puzzles, stats.rating, { theme, exclude: new Set(stats.recent) });
    lesson = toLesson(p);
    state = { failed: false, done: false, change: null, message: lesson.prompt, kind: 'prompt', hints: 0 };
    current = mountPuzzle(board, lesson, onResult);
    render();
  }

  function onResult({ result, message }) {
    if (result === 'correct') { state.message = 'Correct — keep going.'; state.kind = 'good'; }
    if (result === 'wrong') {
      const first = !state.failed;
      if (first) {
        state.failed = true;
        state.change = recordPuzzle(lesson, false).change;
      }
      state.message = first ? `${message} (This puzzle now counts as missed, but you can still find the answer.)` : message;
      state.kind = 'wrong';
    }
    if (result === 'solved') {
      state.done = true;
      if (!state.failed) state.change = recordPuzzle(lesson, true).change;
      else markSeen(lesson.id);
      state.message = state.failed ? 'Solved — but it was missed first, so your rating went down.' : 'Solved!';
      state.kind = 'success';
      playSound('end');
    }
    render();
  }

  function giveUp() {
    if (!state.failed) { state.failed = true; state.change = recordPuzzle(lesson, false).change; }
    state.done = true;
    state.message = 'Here is the solution.';
    state.kind = 'wrong';
    current.showSolution();
    render();
  }

  function render() {
    const stats = loadPuzzleStats();
    const showHint = state.hints && !state.done;
    board.highlight({ hint: showHint ? current.hintSquare() : null });
    panel.dataset.state = state.done ? 'done' : state.failed ? 'failed' : 'playing';
    panel.dataset.puzzle = lesson.id;
    live.say(state.message);
    const change = state.change == null ? null : h('span', { class: `rating-change ${state.change >= 0 ? 'up' : 'down'}`, testid: 'rating-change' }, `${state.change >= 0 ? '+' : ''}${state.change}`);
    fill(panel,
      h('p', { class: 'puzzle-rating' }, 'Your rating: ', h('strong', { testid: 'puzzle-rating' }, String(stats.rating)), ' ', change),
      h('p', { class: 'muted' }, state.done || state.failed ? `Puzzle rating ${lesson.rating} · ${lesson.themes.filter((t) => THEMES[t]).map((t) => THEMES[t]).join(', ') || 'mixed'}` : `${current.color === 'w' ? 'White' : 'Black'} to move`),
      h('p', { class: `lesson-feedback lesson-${state.kind}`, testid: 'lesson-feedback' }, state.message),
      showHint ? h('p', { class: 'lesson-hint muted', testid: 'lesson-hint' }, lesson.hints[0]) : null,
      h('div', { class: 'lesson-actions' },
        state.done
          ? h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-next-puzzle', onClick: next }, 'Next puzzle ▸')
          : [h('button', { class: 'btn', type: 'button', testid: 'btn-lesson-hint', disabled: state.hints > 0, onClick: () => { state.hints++; render(); } }, '💡 Hint'),
            h('button', { class: 'btn', type: 'button', testid: 'btn-solution', onClick: giveUp }, '👁 Solution')]),
      h('details', { class: 'theme-filter' },
        h('summary', {}, 'Choose a theme'),
        h('div', { class: 'theme-links' },
          h('a', { href: '#/puzzles', class: `btn btn-small${theme ? '' : ' btn-primary'}` }, 'All'),
          Object.entries(THEMES).map(([id, name]) => h('a', { href: `#/puzzles?theme=${id}`, class: `btn btn-small${theme === id ? ' btn-primary' : ''}`, testid: `theme-${id}` }, name)))),
      h('p', { class: 'muted small' }, `Solved ${stats.solved} · Missed ${stats.failed} · Puzzles from the Lichess database (CC0).`));
  }

  next();
  return () => { current?.destroy(); board.destroy(); };
}

// Puzzle Rush: three minutes, three strikes, puzzles getting harder. ?seconds=N shortens the clock
// (for tests); only full-length runs count for the best score and XP. A relaxed run has no clock.
export function renderRush(outlet, { query }) {
  let destroyed = false;
  let cleanup = () => {};
  const seconds = Math.min(RUSH.seconds, Math.max(5, Number(query?.get('seconds')) || RUSH.seconds));
  const page = loadingPage(outlet, 'Puzzle Rush');
  loadLibrary().then((rows) => {
    if (destroyed) return;
    page.remove();
    cleanup = mountRush(outlet, rows.map(parseRow), seconds);
  }).catch(() => { if (!destroyed) failPage(page); });
  return () => { destroyed = true; cleanup(); };
}

function mountRush(outlet, puzzles, seconds) {
  const boardHost = h('div', { class: 'board-host' });
  const panel = h('div', { class: 'lesson-panel', testid: 'rush-panel' });
  const live = liveRegion();
  outlet.append(h('div', { class: 'game lesson', testid: 'rush' },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/train' }, 'Training Mode'), ' / Puzzle Rush'),
      h('h1', { class: 'game-title' }, 'Puzzle Rush'),
      live.el,
      panel)));

  let current = null;
  let lesson = null;
  let run = null; // { score, strikes, endsAt (null = relaxed), seen, over, best, counted }
  let tick = null;
  let nextTimer = null;
  let destroyed = false;
  const board = new BoardView(boardHost, {
    fen: puzzles[0].fen,
    legalMoves: (sq) => (run && !run.over ? current?.legalMoves(sq) ?? [] : []),
    onMove: (m) => current?.attempt(m),
    choosePromotion,
  });

  function start({ relaxed = false } = {}) {
    clearInterval(tick);
    clearTimeout(nextTimer);
    // The clock starts after the first puzzle's setup move has been shown.
    run = { score: 0, strikes: 0, endsAt: relaxed ? null : performance.now() + seconds * 1000 + SETUP_MS, seen: new Set(), over: false, best: false, counted: !relaxed && seconds === RUSH.seconds };
    if (!relaxed) {
      tick = setInterval(() => {
        if (performance.now() >= run.endsAt) finish('Time is up!');
        else renderClock();
      }, 250);
    }
    nextPuzzle();
  }

  function nextPuzzle() {
    current?.destroy();
    const p = choosePuzzle(puzzles, rushTarget(run.score), { exclude: run.seen });
    run.seen.add(p.id);
    lesson = toLesson(p);
    current = mountPuzzle(board, lesson, onResult);
    render();
  }

  function onResult({ result }) {
    if (run.over) return;
    if (result === 'solved') {
      run.score++;
      live.say(`Solved. Score ${run.score}.`);
      nextTimer = setTimeout(() => { if (!run.over && !destroyed) nextPuzzle(); }, 300);
    } else if (result === 'wrong') {
      run.strikes++;
      live.say(`Wrong. ${RUSH.strikes - run.strikes} strikes left.`);
      if (run.strikes >= RUSH.strikes) return finish('Three strikes!');
      return nextPuzzle();
    }
    return render();
  }

  function finish(reason) {
    if (run.over) return;
    run.over = true;
    clearInterval(tick);
    clearTimeout(nextTimer);
    current?.destroy();
    board.setInput(null);
    if (run.counted) run.best = recordRush(run.score).best;
    if (run.counted && run.score > 0) prepareRushShare(run.score);
    run.reason = reason;
    live.say(`${reason} Final score ${run.score}.`);
    playSound('end');
    render();
  }

  const timeLeft = () => Math.max(0, Math.ceil((run.endsAt - performance.now()) / 1000));
  const clockText = () => (run.endsAt == null ? 'Relaxed' : `${Math.floor(timeLeft() / 60)}:${String(Math.min(59, timeLeft() % 60)).padStart(2, '0')}`);
  function renderClock() {
    const el = panel.querySelector('[data-testid="rush-timer"]');
    if (el) el.textContent = clockText();
  }

  function render() {
    const stats = loadPuzzleStats();
    panel.dataset.state = !run ? 'ready' : run.over ? 'over' : 'running';
    if (lesson) panel.dataset.puzzle = lesson.id;
    if (!run) {
      fill(panel,
        h('p', {}, `Solve as many puzzles as you can in ${Math.round(seconds / 60 * 10) / 10 === 3 ? 'three minutes' : `${seconds} seconds`}. They get harder as you go, and three wrong moves end the run.`),
        h('p', { class: 'muted' }, `Your best: `, h('strong', { testid: 'rush-best' }, String(stats.rushBest))),
        h('div', { class: 'lesson-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-rush-start', onClick: () => start() }, 'Start ▸'),
          h('button', { class: 'btn', type: 'button', testid: 'btn-rush-relaxed', onClick: () => start({ relaxed: true }) }, 'Relaxed (no clock)')),
        h('p', { class: 'muted small' }, 'Relaxed runs have no time limit and do not count for your best score.'));
      return;
    }
    fill(panel,
      h('div', { class: 'rush-bar' },
        h('span', { class: 'rush-timer', testid: 'rush-timer' }, clockText()),
        h('span', { class: 'rush-score' }, 'Score ', h('strong', { testid: 'rush-score' }, String(run.score))),
        h('span', { class: 'rush-strikes', testid: 'rush-strikes', role: 'img', 'aria-label': `${run.strikes} of ${RUSH.strikes} strikes` }, '✖'.repeat(run.strikes) + '○'.repeat(RUSH.strikes - run.strikes))),
      run.over
        ? [h('p', { class: 'lesson-feedback lesson-success', testid: 'rush-result' }, `${run.reason} You scored ${run.score}.${!run.counted ? ' (Practice run: not counted.)' : run.best ? ' New personal best!' : ` Your best is ${stats.rushBest}.`}`),
          h('div', { class: 'lesson-actions' },
            h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-rush-again', onClick: () => start({ relaxed: run.endsAt == null }) }, 'Play again'),
            run.counted && run.score > 0 ? h('button', { class: 'btn', type: 'button', testid: 'btn-rush-share', onClick: shareRush }, 'Share') : null,
            h('a', { class: 'btn', href: '#/puzzles' }, 'Rated puzzles'))]
        : h('p', { class: 'muted' }, `${current?.color === 'w' ? 'White' : 'Black'} to move · puzzle rating ~${lesson.rating}`));
  }

  // Drawn when the run ends, so the Share tap opens the share sheet at once.
  let preparedShare = null;
  let sharing = false;
  function prepareRushShare(score) {
    const c = { kind: 'rush', score };
    preparedShare = prepareShare({
      card: { fen: lesson.fen, orientation: current?.color ?? 'w', title: `I scored ${score} in Puzzle Rush!`, lines: ['Three minutes, three strikes.', 'Can you beat it?'] },
      text: challengeText(c, { self: true }),
      url: challengeUrl(siteOrigin(), c),
      filename: 'onlinechess-rush.png',
    });
  }
  function shareRush() {
    if (!preparedShare || sharing) return;
    sharing = true;
    sharePrepared(preparedShare).finally(() => { sharing = false; });
  }

  render();
  return () => { destroyed = true; clearInterval(tick); clearTimeout(nextTimer); current?.destroy(); board.destroy(); };
}
