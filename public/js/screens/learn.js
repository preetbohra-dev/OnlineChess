// Training → Lessons: the hub (tracks by level) and the lesson player (read steps, puzzles, or
// playouts against Stockfish).
import { h, fill, liveRegion } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';
import { LESSON_TRACKS, ALL_LESSONS, lessonById } from '../data/lessons/index.js';
import { completedLessons, markLessonComplete } from '../store/progress.js';
import { createPuzzle } from '../core/puzzle.js';
import { createPlayout } from '../core/playout.js';
import { dailyPuzzle, dailyTier } from '../core/daily.js';
import { parseRow, toLesson, dailyFromLibrary } from '../core/puzzle-library.js';
import { loadLibrary, loadPuzzleStats, markSeen, pinDaily } from '../store/puzzle-stats.js';
import { dayKey, currentStreak, previousDay } from '../core/progression.js';
import { loadProfile } from '../store/profile.js';
import { bus } from '../core/events.js';
import { createGame } from '../core/rules.js';
import { ANALYSIS_OPTIONS } from '../engine/analysis.js';
import { playSound, soundForMove } from '../ui/sound.js';

export function renderLearnHub(outlet) {
  const done = completedLessons();
  outlet.append(h('div', { class: 'page menu learn' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/train' }, 'Training Mode'), ' / Lessons'),
    h('h1', {}, 'Lessons'),
    h('p', { class: 'lede muted' }, 'Short lessons and puzzles, from your first move to grandmaster ideas. Your progress is saved on this device.'),
    LESSON_TRACKS.map((track) => {
      const count = track.lessons.filter((l) => done.has(l.id)).length;
      return h('section', { class: 'menu-section', testid: `track-${track.level}` },
        h('h2', {}, `${track.label} `, h('span', { class: 'track-progress' }, `${count}/${track.lessons.length}`)),
        h('p', { class: 'muted' }, track.blurb),
        h('div', { class: 'lesson-grid' }, track.lessons.map((l) => h('a', {
          class: `lesson-card${done.has(l.id) ? ' done' : ''}`, href: `#/learn/${l.id}`, testid: `lesson-${l.id}`,
        },
        h('span', { class: 'lesson-kind' }, KIND_LABEL[l.type]),
        h('strong', {}, l.title),
        h('span', { class: 'muted' }, l.summary),
        done.has(l.id) ? h('span', { class: 'lesson-done', 'aria-label': 'Completed' }, '✓') : null))));
    })));
}

const KIND_LABEL = { read: 'Lesson', puzzle: 'Puzzle', playout: 'vs Stockfish' };

// The daily puzzle: one puzzle per calendar day from the puzzle library, near your puzzle rating;
// solving it keeps your streak alive. Without the library (offline), a lesson puzzle stands in.
export function renderDaily(outlet) {
  const day = dayKey();
  const page = h('div', { class: 'page menu' }, h('h1', {}, 'Daily puzzle'), h('p', { class: 'muted', testid: 'puzzles-loading' }, 'Loading today\'s puzzle…'));
  outlet.append(page);
  let cleanup = () => {};
  let destroyed = false;
  loadLibrary()
    .then((rows) => {
      const puzzles = rows.map(parseRow);
      const id = pinDaily(day, (rating) => dailyFromLibrary(puzzles, day, rating).id);
      return toLesson(puzzles.find((p) => p.id === id) ?? dailyFromLibrary(puzzles, day, loadPuzzleStats().rating));
    })
    .catch(() => dailyPuzzle(day, dailyTier(loadProfile().xp)))
    .then((lesson) => {
      if (destroyed) return;
      page.remove();
      cleanup = mountDaily(outlet, lesson, day);
    });
  return () => { destroyed = true; cleanup(); };
}

function mountDaily(outlet, lesson, day) {
  const library = lesson.level === 'library';
  const boardHost = h('div', { class: 'board-host lesson-board' });
  const panel = h('div', { class: 'lesson-panel' });
  const streakNote = h('p', { class: 'muted daily-streak', testid: 'daily-streak' });
  const showStreak = () => {
    const profile = loadProfile();
    const streak = currentStreak(profile, day);
    const frozen = streak && profile.daily.last !== previousDay(day);
    if (profile.daily.last === day) streakNote.textContent = `Solved today · 🔥 ${streak}-day streak. Come back tomorrow for a new puzzle.`;
    else if (!streak) streakNote.textContent = 'Solve one puzzle a day to build a streak.';
    else streakNote.textContent = `🔥 ${streak}-day streak — solve today's puzzle to keep it going.${frozen ? ' 🧊 A streak freeze will cover the missed day.' : ''}`;
  };
  outlet.append(h('div', { class: 'game lesson', testid: 'daily', dataset: { lesson: lesson.id, source: library ? 'library' : 'lessons' } },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ` / Daily puzzle · ${day}`),
      h('h1', { class: 'game-title' }, library ? `Daily puzzle · rated ${lesson.rating}` : `Daily puzzle: ${lesson.title}`),
      streakNote,
      panel)));
  showStreak();
  const homeLink = () => h('a', { class: 'btn btn-primary', href: '#/', testid: 'btn-next-lesson' }, 'Back home');
  return playPuzzle(lesson, boardHost, panel, homeLink, {
    onSolved: () => {
      if (library) markSeen(lesson.id);
      else markLessonComplete(lesson.id);
      bus.emit('daily:solved', { day: dayKey() }); // the day it was solved, even past midnight
      showStreak();
    },
  });
}

function nextLessonId(id) {
  const i = ALL_LESSONS.findIndex((l) => l.id === id);
  return ALL_LESSONS[i + 1]?.id ?? null;
}

export function renderLesson(outlet, { params, query, startEngine }) {
  const lesson = lessonById(params.id);
  if (!lesson) {
    outlet.append(h('div', { class: 'page menu' }, h('h1', {}, 'Lesson not found'), h('p', {}, h('a', { href: '#/learn' }, 'Back to lessons'))));
    return null;
  }
  const boardHost = h('div', { class: 'board-host lesson-board' });
  const panel = h('div', { class: 'lesson-panel' });
  outlet.append(h('div', { class: 'game lesson', testid: 'lesson', dataset: { lesson: lesson.id } },
    h('div', { class: 'game-board-col' }, boardHost),
    h('aside', { class: 'game-side' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/learn' }, 'Lessons'), ` / ${lesson.level[0].toUpperCase()}${lesson.level.slice(1)}`),
      h('h1', { class: 'game-title' }, lesson.title),
      panel)));

  const next = nextLessonId(lesson.id);
  const nextLink = () => (next
    ? h('a', { class: 'btn btn-primary', href: `#/learn/${next}`, testid: 'btn-next-lesson' }, 'Next lesson ▸')
    : h('a', { class: 'btn btn-primary', href: '#/learn', testid: 'btn-next-lesson' }, 'Back to lessons'));

  if (lesson.type === 'read') return playRead(lesson, boardHost, panel, nextLink);
  if (lesson.type === 'playout') return playPlayout(lesson, boardHost, panel, nextLink, { startEngine, fast: query?.get('engine') === 'fast' });
  return playPuzzle(lesson, boardHost, panel, nextLink);
}

function playRead(lesson, boardHost, panel, nextLink) {
  let step = 0;
  const firstFen = lesson.steps.find((s) => s.fen)?.fen ?? createGame().fen();
  const board = new BoardView(boardHost, { fen: firstFen, legalMoves: () => [], onMove: () => {}, choosePromotion });

  function render() {
    const s = lesson.steps[step];
    if (s.fen) board.setPosition(s.fen, true);
    board.setArrows(s.arrows ?? []);
    board.markSquares(s.highlights ?? []);
    const last = step === lesson.steps.length - 1;
    if (last) markLessonComplete(lesson.id);
    fill(panel,
      h('p', { class: 'lesson-step-count muted' }, `Step ${step + 1} of ${lesson.steps.length}`),
      h('p', { class: 'lesson-text', testid: 'lesson-text' }, s.text),
      h('div', { class: 'lesson-actions' },
        h('button', { class: 'btn', type: 'button', testid: 'btn-prev', disabled: step === 0, onClick: () => { step--; render(); } }, '◂ Back'),
        last ? nextLink() : h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-next', onClick: () => { step++; render(); } }, 'Next ▸')));
  }
  render();
  return () => board.destroy();
}

// Hints escalate: each press shows the next text hint (and highlights the piece to move); after
// the last text hint, one more press shows the move itself as an arrow.
function playPuzzle(lesson, boardHost, panel, nextLink, { onSolved = () => markLessonComplete(lesson.id) } = {}) {
  const puzzle = createPuzzle(lesson);
  const playerColor = puzzle.game.turn();
  const live = liveRegion();
  const maxHints = lesson.hints.length + 1;
  let hintsShown = 0;
  let message = { kind: 'prompt', text: lesson.prompt };
  let busy = false;
  let replyTimer = null;
  let destroyed = false;

  const board = new BoardView(boardHost, {
    fen: lesson.fen,
    orientation: playerColor,
    legalMoves: (sq) => (busy || puzzle.solved ? [] : puzzle.game.legalMoves(sq)),
    onMove: (move) => attempt(move),
    choosePromotion,
  });
  board.setInput(playerColor);

  function attempt(move) {
    if (destroyed || busy) return undefined;
    const outcome = puzzle.tryMove(move);
    if (outcome.result === 'illegal') return render();
    if (outcome.result === 'wrong') {
      playSound('notify');
      message = { kind: 'wrong', text: outcome.message };
      return render();
    }
    hintsShown = 0;
    if (outcome.result === 'solved') {
      onSolved();
      playSound('end');
      message = { kind: 'success', text: outcome.message };
      return render();
    }
    playSound(soundForMove(outcome.move));
    message = { kind: 'good', text: 'Correct! Keep going.' };
    busy = true;
    render();
    replyTimer = setTimeout(() => {
      replyTimer = null;
      if (destroyed) return;
      busy = false;
      playSound(soundForMove(outcome.reply));
      render();
    }, 450);
    return undefined;
  }

  function restart() {
    clearTimeout(replyTimer);
    replyTimer = null;
    busy = false;
    puzzle.reset();
    hintsShown = 0;
    message = { kind: 'prompt', text: lesson.prompt };
    render();
  }

  function render() {
    const history = puzzle.game.history({ verbose: true });
    const shownPly = busy ? history.length - 1 : history.length;
    const fen = shownPly === 0 ? lesson.fen : history[shownPly - 1].after;
    const showHint = hintsShown > 0 && !puzzle.solved && !busy;
    const move = showHint ? puzzle.hintMove() : null;
    board.setPosition(fen, true);
    board.highlight({ lastMove: history[shownPly - 1] ?? null, hint: move ? move.slice(0, 2) : null });
    board.setArrows(move && hintsShown >= maxHints ? [{ from: move.slice(0, 2), to: move.slice(2, 4), type: 'info' }] : []);
    panel.dataset.state = puzzle.solved ? 'solved' : 'playing';
    const hintText = !showHint ? null
      : hintsShown >= maxHints ? 'The arrow shows the move.' : lesson.hints[hintsShown - 1];
    live.say(message.text);
    fill(panel,
      live.el,
      h('p', { class: 'lesson-to-move' }, puzzle.solved ? 'Solved!' : `${playerColor === 'w' ? 'White' : 'Black'} to move`),
      h('p', { class: `lesson-feedback lesson-${message.kind}`, testid: 'lesson-feedback' }, message.text),
      hintText ? h('p', { class: 'lesson-hint muted', testid: 'lesson-hint' }, hintText) : null,
      h('div', { class: 'lesson-actions' },
        puzzle.solved
          ? nextLink()
          : h('button', {
            class: 'btn', type: 'button', testid: 'btn-lesson-hint', disabled: busy || hintsShown >= maxHints,
            onClick: () => { hintsShown = Math.min(maxHints, hintsShown + 1); render(); },
          }, hintsShown >= lesson.hints.length ? '👁 Show the move' : `💡 Hint${hintsShown ? ` ${hintsShown + 1}` : ''}`),
        h('button', { class: 'btn', type: 'button', testid: 'btn-lesson-reset', onClick: restart }, '↺ Restart')));
  }
  render();
  return () => {
    destroyed = true;
    clearTimeout(replyTimer);
    board.destroy();
  };
}

// How quickly a playout was won, against the lesson's par (the number of moves a strong player needs).
function parNote(lesson, used) {
  if (lesson.goal === 'hold') return `You held for ${used} moves.`;
  if (!lesson.par) return `Done in ${used} of ${lesson.moves} moves.`;
  return used <= lesson.par
    ? `Done in ${used} moves — par is ${lesson.par}. Excellent technique!`
    : `Done in ${used} moves — par is ${lesson.par}. Restart and try to be quicker.`;
}

// Play a position out against full-strength Stockfish on its own worker.
function playPlayout(lesson, boardHost, panel, nextLink, { startEngine, fast }) {
  const playout = createPlayout(lesson);
  const { playerColor } = playout;
  const engine = startEngine();
  const limits = fast ? { depth: 6 } : { movetime: 400 };
  const live = liveRegion();
  let hintsShown = 0;
  let hintSquare = null;
  let thinking = false;
  let hintPending = false;
  let failed = false;
  let message = { kind: 'prompt', text: lesson.prompt };
  let destroyed = false;

  const board = new BoardView(boardHost, {
    fen: lesson.fen,
    orientation: playerColor,
    legalMoves: (sq) => (thinking || failed || playout.over ? [] : playout.game.legalMoves(sq)),
    onMove: (move) => attempt(move),
    choosePromotion,
  });
  board.setInput(playerColor);

  const search = async () => {
    const uci = await engine.ready;
    const history = playout.game.history({ verbose: true });
    return uci.go({ fen: lesson.fen, moves: history.map((m) => m.uci), options: ANALYSIS_OPTIONS, ...limits });
  };

  function engineFailed() {
    failed = true;
    thinking = false;
    message = { kind: 'wrong', text: 'The chess engine stopped working. Reload the page to try again.' };
    render();
  }

  function report(outcome) {
    if (outcome.result === 'won') {
      markLessonComplete(lesson.id);
      playSound('end');
      message = { kind: 'success', text: `${outcome.message} ${parNote(lesson, lesson.moves - playout.movesLeft())}` };
    } else if (outcome.result === 'lost') {
      playSound('end');
      message = { kind: 'wrong', text: outcome.message };
    }
  }

  async function attempt(move) {
    const outcome = playout.playerMove(move);
    if (outcome.result === 'illegal') return render();
    engine.engine.cancel(); // drop a hint search still running for the old position
    hintPending = false;
    hintsShown = 0;
    hintSquare = null;
    if (!playout.over) playSound(soundForMove(outcome.move));
    report(outcome);
    if (playout.over) return render();
    message = { kind: 'good', text: 'Stockfish is thinking…' };
    thinking = true;
    render();
    const gen = playout.game.history().length;
    let reply;
    try { reply = await search(); } catch { if (!destroyed) engineFailed(); return undefined; }
    if (destroyed || reply.stale || playout.game.history().length !== gen) return undefined;
    thinking = false;
    const answer = playout.opponentMove(reply.bestmove);
    if (answer.result === 'illegal') return engineFailed();
    if (answer.result === 'continue') playSound(soundForMove(answer.move));
    report(answer);
    if (!playout.over) message = answer.message ? { kind: 'wrong', text: answer.message } : { kind: 'prompt', text: 'Your move.' };
    return render();
  }

  async function showHint() {
    hintsShown++;
    render();
    if (hintsShown < 2 || hintSquare || hintPending || playout.over || thinking) return;
    const gen = playout.game.history().length;
    hintPending = true;
    render();
    try {
      const best = await search();
      if (destroyed || best.stale || playout.game.history().length !== gen || playout.over) return;
      hintPending = false;
      hintSquare = best.bestmove.slice(0, 2);
      render();
    } catch { if (!destroyed) engineFailed(); }
  }

  function restart() {
    engine.engine.cancel();
    playout.reset();
    thinking = false;
    hintPending = false;
    hintsShown = 0;
    hintSquare = null;
    message = { kind: 'prompt', text: lesson.prompt };
    render();
  }

  function render() {
    const history = playout.game.history({ verbose: true });
    board.setPosition(playout.game.fen(), true);
    board.highlight({ lastMove: history[history.length - 1] ?? null, hint: hintSquare });
    panel.dataset.state = playout.result ?? (thinking ? 'thinking' : 'playing');
    panel.dataset.fen = playout.game.fen();
    const hintText = hintsShown ? lesson.hints[Math.min(hintsShown, lesson.hints.length) - 1] : null;
    live.say(message.text);
    fill(panel,
      live.el,
      h('p', { class: 'lesson-to-move' },
        playout.result === 'won' ? 'Done!' : `You play ${playerColor === 'w' ? 'White' : 'Black'} against Stockfish`),
      h('p', { class: 'playout-moves muted', testid: 'playout-moves' }, `Moves left: ${playout.movesLeft()} of ${lesson.moves}`),
      h('p', { class: `lesson-feedback lesson-${message.kind}`, testid: 'lesson-feedback' }, message.text),
      hintText ? h('p', { class: 'lesson-hint muted', testid: 'lesson-hint' }, hintSquare && !playout.over ? `${hintText} Try moving the highlighted piece.` : hintText) : null,
      h('div', { class: 'lesson-actions' },
        playout.result === 'won'
          ? nextLink()
          : h('button', {
            class: 'btn', type: 'button', testid: 'btn-lesson-hint', disabled: thinking || hintPending || failed || playout.over,
            onClick: showHint,
          }, '💡 Hint'),
        h('button', { class: 'btn', type: 'button', testid: 'btn-lesson-reset', disabled: failed, onClick: restart }, '↺ Restart')));
  }
  render();
  return () => {
    destroyed = true;
    engine.stop();
    board.destroy();
  };
}
