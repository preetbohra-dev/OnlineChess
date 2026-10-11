// Coached game: a bot game where a coach explains every one of your moves, warns about the
// opponent's threats, gives hints and allows takebacks. After a mistake the opponent waits so you
// can study the arrows and choose "Try again" or "Continue". Feedback depth follows the level.
import { createBotSession } from './bot-session.js';
import { personaById } from '../data/personas.js';
import { explainMove, explainThreat } from '../core/explain.js';
import { moveAccuracy, GRADE_LABEL } from '../core/classify.js';
import { otherColor } from '../core/rules.js';
import { hangingPieces, PIECE_NAME } from '../core/tactics.js';
import { h } from '../ui/dom.js';
import { bus } from '../core/events.js';

export const TRAINING_LEVELS = [
  { id: 'novice', label: 'Novice', blurb: 'Learning the basics. Plain-language tips, no numbers.' },
  { id: 'amateur', label: 'Amateur', blurb: 'Know the rules, building tactics. Names the patterns you miss.' },
  { id: 'pro', label: 'Pro', blurb: 'Club player. Adds engine evaluations.' },
  { id: 'grandmaster', label: 'Grand Master', blurb: 'Serious study. Evaluations and full engine lines.' },
];
const COACH = { name: 'Coach Castle', avatar: '🧑‍🏫' };
const GRADE_ORDER = ['great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const PAUSE_ON = new Set(['mistake', 'blunder']);
const FEEDBACK_WAIT_MS = 4_000;

export function createTrainingSession({ level = 'amateur', playerColor = 'w', fen, engine, analyzer, rng, fast = false, minThinkMs = 500 }) {
  const levelInfo = TRAINING_LEVELS.find((l) => l.id === level) ?? TRAINING_LEVELS[1];
  const persona = personaById(levelInfo.id);
  let decision = null; // { ply, resolve } while waiting for "Try again" / "Continue"

  const bot = createBotSession({
    persona, playerColor, fen, engine, analyzer, rng, fast, minThinkMs,
    tauntsEnabled: () => false,
    allowTakeback: true,
    coaching: true,
    beforeReply: () => pauseAfterMistake(),
  });
  const { rules } = bot;
  const botColor = otherColor(playerColor);
  const feedback = new Map(); // ply -> explanation
  const failed = new Set(); // plies the coach could not analyse
  let pendingPly = null;
  let threat = null; // { text, arrow, ply, fen }
  let hint = null; // { stage: 1 | 2, move, ply, fen }
  let destroyed = false;

  const coachSays = (text) => bot.emit('feed', { kind: 'coach', text, avatar: COACH.avatar });
  const plies = () => rules.history().length;
  const here = (mark) => mark && mark.ply === plies() && mark.fen === rules.fen();

  function waitForFeedback(ply) {
    return new Promise((resolve) => {
      const ready = () => feedback.has(ply) || failed.has(ply) || plies() !== ply || destroyed;
      if (ready()) return resolve();
      const timer = setTimeout(done, FEEDBACK_WAIT_MS);
      const off = bot.on('change', () => { if (ready()) done(); });
      function done() { clearTimeout(timer); off(); resolve(); }
    });
  }

  // Runs before every bot move: after a mistake, hold the reply until the player decides.
  async function pauseAfterMistake() {
    const ply = plies();
    if (rules.history({ verbose: true })[ply - 1]?.color !== playerColor) return;
    await waitForFeedback(ply);
    const f = feedback.get(ply);
    if (destroyed || plies() !== ply || !f || !PAUSE_ON.has(f.grade)) return;
    await new Promise((resolve) => {
      decision = { ply, resolve };
      bot.emit('change', { action: 'decision' });
    });
    decision = null;
  }

  function resolveDecision() {
    decision?.resolve();
    decision = null;
  }

  bot.on('analysis', ({ ply, analysis }) => {
    const history = rules.history({ verbose: true });
    const move = history[ply - 1];
    if (!move || move.color !== playerColor) return;
    const e = explainMove({ move, analysis, level: levelInfo.id, history: history.slice(0, ply) });
    feedback.set(ply, { ...e, san: move.san, fen: move.after, winPercentDrop: analysis.classification.winPercentDrop });
    // Mistakes become weak-spot cards (only when the analysis is for the move actually played).
    if (analysis.move === move.uci) bus.emit('coach:graded', { grade: e.grade, before: move.before, san: move.san, analysis });
    if (pendingPly === ply) pendingPly = null;
    const key = e.points.find((p) => p.kind === 'allowed' || p.kind === 'better' || p.kind === 'missed');
    coachSays(`${move.san}: ${e.label}.${key ? ` ${key.text}` : ''}`);
    bot.emit('change', { action: 'coach' });
  });

  bot.on('analysis-failed', ({ ply }) => {
    failed.add(ply);
    if (pendingPly === ply) pendingPly = null;
    coachSays('I couldn\'t analyse that move — carry on, I\'ll look at the next one.');
    bot.emit('change', { action: 'coach' });
  });

  async function checkThreat() {
    const ply = plies();
    const fen = rules.fen();
    let t = null;
    try { t = await analyzer.analyzeThreat({ fen }); } catch { return; }
    if (destroyed || plies() !== ply || rules.fen() !== fen || rules.status().over) return;
    let explained = explainThreat({ fen, threat: t, level: levelInfo.id, opponentColor: botColor });
    if (!explained) {
      // No engine-level threat: still point out a piece left completely undefended and attacked.
      const loose = hangingPieces(rules, playerColor).filter((p) => p.type !== 'p');
      if (!loose.length) return;
      const p = loose[0];
      explained = {
        text: `Careful: your ${PIECE_NAME[p.type]} on ${p.square} is attacked and nothing defends it.`,
        arrow: null,
      };
    }
    threat = { ...explained, ply, fen };
    coachSays(explained.text);
    bot.emit('change', { action: 'threat' });
  }

  bot.on('change', (d) => {
    if (d?.by === 'player') { pendingPly = plies(); threat = null; hint = null; }
    if (d?.by === 'bot' && !rules.status().over && analyzer) checkThreat();
    if (d?.action === 'takeback') {
      analyzer?.cancel();
      resolveDecision();
      for (const ply of [...feedback.keys()]) if (ply > plies()) feedback.delete(ply);
      pendingPly = null;
      threat = null;
      hint = null;
      coachSays('Move taken back. Have another look!');
    }
  });

  // Feedback for the player's last move (still shown while the opponent replies and after).
  function latestFeedback() {
    for (let ply = plies(); ply > 0 && ply >= plies() - 1; ply--) if (feedback.has(ply)) return feedback.get(ply);
    return null;
  }

  function summary() {
    const entries = [...feedback.values()];
    if (!entries.length) return null;
    const accuracy = Math.round(entries.reduce((sum, e) => sum + moveAccuracy(e.winPercentDrop ?? 0), 0) / entries.length);
    const counts = Object.fromEntries(GRADE_ORDER.map((g) => [g, entries.filter((e) => e.grade === g).length]));
    return { accuracy, counts, moves: entries.length };
  }

  return {
    ...bot,
    kind: 'training',
    title: `Coached game · ${levelInfo.label}`,
    level: levelInfo.id,
    capabilities: { ...bot.capabilities, hint: true, takeback: true },
    statusNote: () => (decision ? 'try that move again, or continue the game'
      : pendingPly ? 'coach is looking at your move…' : bot.statusNote()),
    awaitingDecision: () => Boolean(decision),
    // Status banner while paused: talk about the player's move, not whose turn it is.
    banner() {
      if (!decision) return null;
      const f = feedback.get(decision.ply);
      return f ? `${f.san} was a ${f.label.toLowerCase()} — try again or continue.` : null;
    },
    continueGame: resolveDecision,

    // Board annotations, only on the position they were made for: the explained move's arrows
    // (before the opponent replies), the opponent's threat, and the hint.
    arrows() {
      const out = [];
      const latest = feedback.get(plies());
      if (latest && latest.fen === rules.fen()) out.push(...latest.arrows);
      if (here(threat) && threat.arrow) out.push(threat.arrow);
      if (hint?.stage === 2 && here(hint)) out.push({ from: hint.move.slice(0, 2), to: hint.move.slice(2, 4), type: 'info' });
      return out;
    },
    hintSquare: () => (here(hint) ? hint.move.slice(0, 2) : null),

    // First press: highlight the piece to move. Second press: show the move.
    async hint() {
      if (rules.status().over || rules.turn() !== playerColor || !analyzer) return null;
      const ply = plies();
      const fen = rules.fen();
      if (here(hint)) {
        hint = { ...hint, stage: 2 };
      } else {
        const history = rules.history({ verbose: true });
        const best = await analyzer.bestMove({ startFen: history[0]?.before ?? fen, moves: history.map((m) => m.uci) });
        if (!best || destroyed || plies() !== ply || rules.fen() !== fen) return null;
        hint = { stage: 1, move: best.move, ply, fen };
        coachSays(levelInfo.id === 'novice' ? 'Hint: look at the highlighted piece. Press Hint again to see the move.' : 'Hint: the highlighted piece has a strong move. Press again to reveal it.');
      }
      bot.emit('change', { action: 'hint' });
      return hint;
    },

    renderExtras(container) {
      const latest = latestFeedback();
      const panel = h('section', { class: 'coach-panel', testid: 'coach-panel', 'aria-live': 'polite', 'aria-label': 'Coach' },
        h('div', { class: 'coach-head' },
          h('span', { class: 'coach-avatar', 'aria-hidden': 'true' }, COACH.avatar),
          h('strong', {}, COACH.name),
          latest ? h('span', { class: 'coach-grade', testid: 'coach-grade', dataset: { grade: latest.grade } }, `${latest.san} · ${latest.label}`) : null),
        pendingPly
          ? h('p', { class: 'coach-headline muted' }, 'Looking at your move…')
          : latest
            ? h('p', { class: 'coach-headline' }, latest.headline)
            : h('p', { class: 'coach-headline muted' }, rules.status().over ? 'Game over — your summary is in the result window.'
              : rules.turn() === playerColor ? 'Make your move — I\'ll tell you how it went.' : `${persona.name} is thinking…`),
        latest && !pendingPly ? h('ul', { class: 'coach-points' }, latest.points.map((p) => h('li', { dataset: { kind: p.kind } }, p.text))) : null,
        decision ? h('div', { class: 'coach-actions' },
          h('button', { class: 'btn btn-primary btn-small', type: 'button', testid: 'btn-try-again', onClick: () => bot.takeback() }, '↶ Try again'),
          h('button', { class: 'btn btn-small', type: 'button', testid: 'btn-continue', onClick: () => { resolveDecision(); bot.emit('change', { action: 'continue' }); } }, 'Continue ▸')) : null,
        here(threat) ? h('p', { class: 'coach-threat', testid: 'coach-threat' }, threat.text) : null);
      container.replaceChildren(panel);
    },

    resultDetails() {
      const s = summary();
      if (!s) return null;
      return h('div', { class: 'summary', testid: 'coach-summary' },
        h('p', { class: 'summary-accuracy' }, 'Your accuracy: ', h('strong', { testid: 'coach-accuracy' }, `${s.accuracy}%`)),
        h('ul', { class: 'summary-grades' },
          GRADE_ORDER.filter((g) => s.counts[g]).map((g) => h('li', { dataset: { grade: g } }, `${GRADE_LABEL[g]}: ${s.counts[g]}`))));
    },
    summary,

    destroy() {
      destroyed = true;
      resolveDecision();
      bot.destroy();
    },
  };
}
