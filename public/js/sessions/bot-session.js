// Player vs computer persona. The engine is a Promise<UciEngine> so the board is usable while
// Stockfish loads. Every bot search is tagged with a generation; destroy/new positions bump it so
// a late answer is never played into the wrong position.
import { createGame, otherColor } from '../core/rules.js';
import { createEmitter } from '../core/events.js';
import { attachClock } from './clocked.js';
import { engineOptionsFor, searchFor, pickMove, scoreCp } from '../engine/personas.js';
import { createBook, bookMove } from '../engine/book.js';
import { linesFor } from '../data/repertoires.js';
import { createRng, pick } from '../core/rng.js';
import { START_FEN } from '../core/rules.js';
import { createTaunter, tauntTriggerFor } from '../core/taunts.js';
import { TAUNTS } from '../data/taunts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBotSession({
  persona,
  playerColor = 'w',
  fen,
  timeControl = null,
  engine,
  rng = createRng(),
  fast = false,
  minThinkMs = 350,
  now,
  analyzer = null, // engine/analysis.js analyzer on its own engine; enables taunts and coaching
  tauntsEnabled = () => true,
  allowTakeback = false, // training only
  coaching = false, // analyse every player move even with taunts off (training)
  beforeReply = null, // async hook awaited before each bot move (training: pause after mistakes)
}) {
  const rules = createGame({ fen });
  const startFen = rules.fen();
  const botColor = otherColor(playerColor);
  const events = createEmitter();
  const timing = attachClock(rules, timeControl, { now });
  const book = startFen === START_FEN && persona.bookPlies ? createBook(linesFor(persona.id)) : null;
  const clockNow = now ?? (() => performance.now());
  let thinking = false;
  let gen = 0;
  let destroyed = false;
  let lastEval = null; // centipawns from the bot's point of view
  let endAnnounced = false;
  let engineState = 'loading'; // loading | ready | failed
  let warnedFallback = false;

  // The player waits for the engine before the first move, so loading time never eats the bot's clock.
  Promise.resolve(engine).then(
    () => { engineState = 'ready'; if (!destroyed) events.emit('change', { action: 'engineReady' }); },
    () => { engineState = 'failed'; if (!destroyed) events.emit('change', { action: 'engineFailed' }); },
  );

  const say = (kind) => events.emit('feed', { kind: 'bot', text: pick(rng, persona.lines[kind]), avatar: persona.avatar });
  const taunter = createTaunter({ lines: TAUNTS[persona.id], rng });

  function taunt(trigger, ply, vars) {
    if (!tauntsEnabled()) return;
    const text = taunter.pick(trigger, { ply, vars });
    if (text) events.emit('feed', { kind: 'taunt', text: persona.shouts ? text.toUpperCase() : text, avatar: persona.avatar, trigger });
  }

  // Facts about the move the taunt can mention: the best move's SAN, and which of the player's
  // pieces the engine's refutation captures.
  function describe(move, analysis, previous) {
    const gameOver = rules.status().over;
    try {
      const legalBefore = createGame({ fen: move.before }).legalMoves();
      const best = legalBefore.find((m) => m.uci === analysis.bestMove);
      // Forced moves earn no praise: the only legal move, or simply taking back a captured piece.
      const forced = legalBefore.length <= 1 || Boolean(previous?.captured && move.captured && previous.to === move.to);
      let refutationTarget = null;
      if (analysis.refutation) {
        const square = analysis.refutation.slice(2, 4);
        const piece = createGame({ fen: move.after }).get(square);
        if (piece && piece.color === move.color) refutationTarget = { type: piece.type, square };
      }
      return { bestSan: best?.san ?? analysis.bestMove, refutationTarget, forced, gameOver };
    } catch {
      return { bestSan: analysis.bestMove, refutationTarget: null, forced: false, gameOver };
    }
  }

  // Analyse the player's move on the analysis engine and react to mistakes (or brilliance).
  async function react(move) {
    if (!analyzer || (!coaching && !tauntsEnabled())) return;
    const history = rules.history({ verbose: true });
    const ply = history.length;
    let analysis;
    try {
      analysis = await analyzer.analyzeMove({
        startFen,
        moves: history.slice(0, -1).map((m) => m.uci),
        move: move.uci,
        afterStatus: rules.status(),
      });
    } catch {
      analysis = null; // analysis is best-effort; the game goes on without commentary
    }
    if (!analysis && !destroyed) {
      events.emit('analysis-failed', { ply });
      return;
    }
    const current = rules.history({ verbose: true });
    const stillThere = current[ply - 1]?.uci === move.uci;
    // Too late to comment: the game ended after this move, or the player has moved again since.
    const endedLater = rules.status().over && current.length > ply;
    if (!analysis || destroyed || !stillThere || endedLater || current.length > ply + 1) return;
    events.emit('analysis', { ply, analysis });
    const verdict = tauntTriggerFor(analysis, describe(move, analysis, history[ply - 2]), rng);
    if (verdict) taunt(verdict.trigger, ply, verdict.vars);
  }

  function changed(detail) {
    timing?.settle();
    events.emit('change', detail);
    const status = rules.status();
    if (status.over && !endAnnounced) {
      endAnnounced = true;
      gen++; // drop any search still running for this finished game
      thinking = false;
      Promise.resolve(engine).then((e) => e?.cancel?.()).catch(() => {});
      say(status.winner === botColor ? 'botWins' : status.winner === playerColor ? 'botLoses' : 'draw');
    }
    if (!status.over && rules.turn() === botColor) botMove();
  }

  function flag(color) {
    const r = rules.flag(color);
    if (r.ok) changed({ action: 'flag', color });
    return r;
  }

  async function chooseMove(myGen) {
    if (book) {
      const san = bookMove(book, rules.history(), rng, persona.bookPlies);
      if (san) return san;
    }
    const uciEngine = await engine;
    if (myGen !== gen || destroyed) return null;
    const result = await uciEngine.go({
      fen: startFen,
      moves: rules.history({ verbose: true }).map((m) => m.uci),
      ...searchFor(persona, { remainingMs: timing ? timing.clock.remaining(botColor) : null, fast }),
      options: engineOptionsFor(persona),
    });
    if (result.stale || myGen !== gen || destroyed) return null;
    lastEval = scoreCp(result.lines[0]);
    const legal = rules.legalMoves().map((m) => m.uci);
    const choice = pickMove(persona, result, legal, rng);
    return legal.includes(choice) ? choice : result.bestmove;
  }

  async function botMove() {
    if (thinking || destroyed) return;
    const myGen = ++gen;
    thinking = true;
    events.emit('change', { action: 'thinking' });
    const started = clockNow();
    try {
      // A bot that stands worse claims an available draw instead of playing on.
      const claimable = rules.claimableDraws();
      if (claimable.length && lastEval !== null && lastEval < -50) {
        rules.claimDraw(claimable[0]);
        thinking = false;
        changed({ action: 'claimDraw', kind: claimable[0] });
        return;
      }
      if (beforeReply) {
        await beforeReply();
        if (myGen !== gen || destroyed || rules.status().over) return;
      }
      const move = await chooseMove(myGen);
      if (move == null || myGen !== gen || destroyed) return;
      // A natural pause before replying, but never one that costs the bot on the clock.
      const pause = timing ? Math.min(minThinkMs, timing.clock.remaining(botColor) / 30) : minThinkMs;
      const wait = pause - (clockNow() - started);
      if (wait > 0) await sleep(wait);
      if (myGen !== gen || destroyed || rules.status().over) return;
      if (timing?.expired(botColor)) {
        thinking = false;
        flag(botColor);
        return;
      }
      const result = rules.move(move);
      if (!result.ok) throw new Error(`engine suggested an illegal move: ${move}`);
      timing?.moved(botColor);
      thinking = false;
      changed({ move: result, by: 'bot' });
      if (result.san.endsWith('+')) taunt('botCheck', rules.history().length, {});
    } catch (err) {
      // Never leave the game stuck on the bot's turn: fall back to a random legal move.
      if (myGen !== gen || destroyed || rules.status().over) return;
      console.warn('Computer move failed, playing a fallback move:', err);
      if (!warnedFallback) {
        warnedFallback = true;
        events.emit('feed', { kind: 'system', text: `The chess engine stopped responding, so ${persona.name} is improvising. Start a new game for full strength.` });
      }
      if (timing?.expired(botColor)) {
        thinking = false;
        flag(botColor);
        return;
      }
      const result = rules.move(pick(rng, rules.legalMoves()).uci);
      timing?.moved(botColor);
      thinking = false;
      changed({ move: result, by: 'bot' });
    } finally {
      if (myGen === gen) thinking = false;
    }
  }

  // The bot accepts a draw only when it stands clearly worse, or late in a dead-level game.
  function answerDraw() {
    const plies = rules.history().length;
    const accept = lastEval !== null && (lastEval <= -150 || (plies >= 60 && Math.abs(lastEval) <= 30));
    setTimeout(() => {
      if (destroyed || rules.drawOffer() !== playerColor) return;
      if (accept) {
        say('drawAccept');
        rules.acceptDraw(botColor);
        changed({ action: 'acceptDraw', color: botColor });
      } else {
        say('drawDecline');
        rules.declineDraw(botColor);
        changed({ action: 'declineDraw', color: botColor });
      }
    }, 600);
  }

  const session = {
    kind: 'bot',
    title: `vs ${persona.name}`,
    persona,
    playerColor,
    rules,
    clock: timing?.clock ?? null,
    flag,
    players: {
      [playerColor]: { name: 'You', avatar: '🙂' },
      [botColor]: { name: persona.name, avatar: persona.avatar },
    },
    capabilities: { resign: true, offerDraw: true, claimDraw: true, takeback: allowTakeback },
    on: events.on,
    emit: events.emit, // for wrappers such as the training session

    isThinking: () => thinking,
    statusNote: () => (engineState === 'loading' ? `waking up ${persona.name}…` : thinking ? `${persona.name} is thinking…` : ''),
    inputColor: () => (rules.status().over || thinking || engineState === 'loading' || rules.turn() !== playerColor ? null : playerColor),
    actingColor: () => playerColor,
    drawAnswerer: () => null,
    resultTitle: (status) => (status.winner === playerColor ? 'You win!' : status.winner === botColor ? `${persona.name} wins` : 'Draw'),

    // Starts the game: greets, and lets the bot open when it has White.
    start() {
      say('greeting');
      if (!rules.status().over && rules.turn() === botColor) botMove();
    },

    submitMove(move) {
      if (rules.turn() !== playerColor || thinking || engineState === 'loading') return { ok: false, reason: 'not-your-turn' };
      if (timing?.expired(playerColor)) {
        flag(playerColor);
        return { ok: false, reason: 'flag' };
      }
      const result = rules.move(move);
      if (result.ok) {
        timing?.moved(playerColor);
        changed({ move: result, by: 'player' });
        react(result);
      }
      return result;
    },
    resign() {
      const r = rules.resign(playerColor);
      if (r.ok) changed({ action: 'resign', color: playerColor });
      return r;
    },
    offerDraw() {
      const r = rules.offerDraw(playerColor);
      if (r.ok) {
        events.emit('change', { action: 'offerDraw', color: playerColor });
        answerDraw();
      }
      return r;
    },
    acceptDraw: () => ({ ok: false, reason: 'no-offer' }),
    declineDraw: () => ({ ok: false, reason: 'no-offer' }),
    claimDraw(kind) {
      const r = rules.claimDraw(kind);
      if (r.ok) changed({ action: 'claimDraw', kind });
      return r;
    },
    canTakeback: () => allowTakeback && rules.history().length >= (rules.turn() === playerColor ? 2 : 1),

    // Training: undo back to the player's previous turn (the bot's reply and the player's move).
    takeback() {
      if (!allowTakeback) return { ok: false, reason: 'not-allowed' };
      const plies = rules.history().length;
      const undo = rules.turn() === playerColor ? 2 : 1;
      // Moves alternate, so with the player to move the last two plies are bot reply + player move.
      if (plies < undo) return { ok: false, reason: 'nothing-to-undo' };
      gen++;
      thinking = false;
      Promise.resolve(engine).then((e) => e?.cancel?.()).catch(() => {});
      for (let i = 0; i < undo; i++) rules.undo();
      endAnnounced = false;
      events.emit('change', { action: 'takeback' });
      return { ok: true };
    },

    destroy() {
      destroyed = true;
      gen++;
      Promise.resolve(engine).then((e) => e?.cancel?.()).catch(() => {});
      events.clear();
    },
  };
  return session;
}
