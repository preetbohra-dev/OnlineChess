// Training → Lessons: the hub (tracks by level) and the lesson player (read steps, puzzles, or
// playouts against Stockfish).
import { h } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';
import { LESSON_TRACKS, ALL_LESSONS, lessonById } from '../data/lessons/index.js';
import { completedLessons, markLessonComplete } from '../store/progress.js';
import { createPuzzle } from '../core/puzzle.js';
import { createPlayout } from '../core/playout.js';
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
    panel.replaceChildren(
      h('p', { class: 'lesson-step-count muted' }, `Step ${step + 1} of ${lesson.steps.length}`),
      h('p', { class: 'lesson-text', testid: 'lesson-text' }, s.text),
      h('div', { class: 'lesson-actions' },
        h('button', { class: 'btn', type: 'button', testid: 'btn-prev', disabled: step === 0, onClick: () => { step--; render(); } }, '◂ Back'),
        last ? nextLink() : h('button', { class: 'btn btn-primary', type: 'button', testid: 'btn-next', onClick: () => { step++; render(); } }, 'Next ▸')));
  }
  render();
  return () => board.destroy();
}

function playPuzzle(lesson, boardHost, panel, nextLink) {
  const puzzle = createPuzzle(lesson);
  const playerColor = puzzle.game.turn();
  let hintsShown = 0;
  let message = { kind: 'prompt', text: lesson.prompt };
  let busy = false;

  const board = new BoardView(boardHost, {
    fen: lesson.fen,
    orientation: playerColor,
    legalMoves: (sq) => (busy || puzzle.solved ? [] : puzzle.game.legalMoves(sq)),
    onMove: (move) => attempt(move),
    choosePromotion,
  });
  board.setInput(playerColor);

  function attempt(move) {
    const outcome = puzzle.tryMove(move);
    if (outcome.result === 'illegal') return render();
    if (outcome.result === 'wrong') {
      playSound('notify');
      message = { kind: 'wrong', text: outcome.message };
      return render();
    }
    playSound(soundForMove(outcome.move));
    if (outcome.result === 'solved') {
      markLessonComplete(lesson.id);
      playSound('end');
      message = { kind: 'success', text: outcome.message };
      return render();
    }
    message = { kind: 'good', text: 'Correct! Keep going.' };
    busy = true;
    render();
    setTimeout(() => { busy = false; playSound(soundForMove(outcome.reply)); render(); }, 450);
    return undefined;
  }

  function render() {
    const history = puzzle.game.history({ verbose: true });
    const shownPly = busy ? history.length - 1 : history.length;
    const fen = shownPly === 0 ? lesson.fen : history[shownPly - 1].after;
    board.setPosition(fen, true);
    board.highlight({ lastMove: history[shownPly - 1] ?? null, hint: hintsShown && !puzzle.solved ? puzzle.hintSquare() : null });
    panel.dataset.state = puzzle.solved ? 'solved' : 'playing';
    panel.replaceChildren(
      h('p', { class: 'lesson-to-move' }, puzzle.solved ? 'Solved!' : `${playerColor === 'w' ? 'White' : 'Black'} to move`),
      h('p', { class: `lesson-feedback lesson-${message.kind}`, testid: 'lesson-feedback', role: 'status' }, message.text),
      hintsShown ? h('p', { class: 'lesson-hint muted', testid: 'lesson-hint' }, lesson.hints[Math.min(hintsShown, lesson.hints.length) - 1]) : null,
      h('div', { class: 'lesson-actions' },
        puzzle.solved
          ? nextLink()
          : h('button', {
            class: 'btn', type: 'button', testid: 'btn-lesson-hint',
            onClick: () => { hintsShown++; render(); },
          }, '💡 Hint'),
        h('button', { class: 'btn', type: 'button', testid: 'btn-lesson-reset', onClick: () => { puzzle.reset(); hintsShown = 0; message = { kind: 'prompt', text: lesson.prompt }; render(); } }, '↺ Restart')));
  }
  render();
  return () => board.destroy();
}

// Play a position out against full-strength Stockfish on its own worker.
function playPlayout(lesson, boardHost, panel, nextLink, { startEngine, fast }) {
  const playout = createPlayout(lesson);
  const { playerColor } = playout;
  const engine = startEngine();
  const limits = fast ? { depth: 6 } : { movetime: 400 };
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
      message = { kind: 'success', text: outcome.message };
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
    panel.replaceChildren(
      h('p', { class: 'lesson-to-move' },
        playout.result === 'won' ? 'Done!' : `You play ${playerColor === 'w' ? 'White' : 'Black'} against Stockfish`),
      h('p', { class: 'playout-moves muted', testid: 'playout-moves' }, `Moves left: ${playout.movesLeft()} of ${lesson.moves}`),
      h('p', { class: `lesson-feedback lesson-${message.kind}`, testid: 'lesson-feedback', role: 'status' }, message.text),
      hintText ? h('p', { class: 'lesson-hint muted', testid: 'lesson-hint' }, hintSquare && !playout.over ? `${hintText} The highlighted piece has the engine's move.` : hintText) : null,
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
