// Transport-agnostic UCI engine driver. A transport is
//   { post(command), onLine(fn), onError?(fn), terminate() }
// — a Web Worker in the browser (transport-worker.js), Stockfish-in-Node in tests.
//
// One UciEngine per role (bot opponent, move analysis, coach): strength options persist on the
// engine between searches, so never share an instance across roles.
//
// Searches run one at a time through a queue. cancel() bumps a generation counter: queued and
// running searches from an older generation resolve with { stale: true }, so a takeback or new
// game never receives an answer meant for an older position.
//
// Failure is final: a transport error, a timed-out reply or terminate() marks the engine dead and
// rejects everything pending with an EngineError immediately (owners create a new engine).
import { parseInfo, parseBestmove, parseOption } from './uci-parse.js';

export class EngineError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'EngineError';
    this.reason = reason; // 'terminated' | 'timeout' | 'crashed'
  }
}

export class UciEngine {
  #transport;
  #listeners = new Set();
  #waiters = new Set();
  #queue = Promise.resolve();
  #gen = 0;
  #searching = false;
  #multipv = 1;
  #dead = null; // EngineError once the engine is unusable
  options = new Map();

  constructor(transport, { timeoutMs = 20_000 } = {}) {
    this.#transport = transport;
    this.timeoutMs = timeoutMs;
    transport.onLine((line) => { for (const fn of [...this.#listeners]) fn(line); });
    transport.onError?.((err) => this.#die(new EngineError(`Engine crashed: ${err?.message ?? err}`, 'crashed')));
  }

  get generation() { return this.#gen; }
  get alive() { return !this.#dead; }

  #send(command) {
    if (!this.#dead) this.#transport.post(command);
  }

  #die(error) {
    if (this.#dead) return;
    this.#dead = error;
    for (const waiter of [...this.#waiters]) waiter.fail(error);
    this.#waiters.clear();
    this.#listeners.clear();
    try { this.#transport.terminate(); } catch { /* already gone */ }
  }

  // Resolves with the first line accepted by `match`, while `collect` sees every line.
  // A timeout means the engine can no longer be trusted (it may still be searching), so it dies.
  #waitFor(match, { collect, timeoutMs = this.timeoutMs } = {}) {
    if (this.#dead) return Promise.reject(this.#dead);
    return new Promise((resolve, reject) => {
      const waiter = {
        fail: (error) => { clearTimeout(timer); this.#listeners.delete(onLine); reject(error); },
      };
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        this.#listeners.delete(onLine);
        reject(new EngineError('Engine did not respond in time', 'timeout'));
        this.#die(new EngineError('Engine did not respond in time', 'timeout'));
      }, timeoutMs);
      const onLine = (line) => {
        collect?.(line);
        if (!match(line)) return;
        clearTimeout(timer);
        this.#listeners.delete(onLine);
        this.#waiters.delete(waiter);
        resolve(line);
      };
      this.#waiters.add(waiter);
      this.#listeners.add(onLine);
    });
  }

  async init() {
    const waiting = this.#waitFor((l) => l === 'uciok', {
      collect: (line) => {
        const option = line.startsWith('option ') ? parseOption(line) : null;
        if (option) this.options.set(option.name, option);
      },
    });
    this.#send('uci');
    await waiting;
    await this.ready();
    return this;
  }

  async ready() {
    const waiting = this.#waitFor((l) => l === 'readyok');
    this.#send('isready');
    await waiting;
  }

  // Unknown options are skipped and spin values clamped rather than sent blindly.
  setOption(name, value) {
    const option = this.options.get(name);
    if (!option) {
      console.warn(`Engine has no option "${name}"; skipped`);
      return false;
    }
    let v = value;
    if (option.type === 'spin') v = Math.min(option.max ?? v, Math.max(option.min ?? v, Number(v)));
    if (name === 'MultiPV') this.#multipv = v;
    this.#send(`setoption name ${name} value ${v}`);
    return true;
  }

  newGame() {
    return this.#enqueue(async () => {
      this.#send('ucinewgame');
      await this.ready();
    });
  }

  // go({ fen, moves, movetime, depth, nodes, multipv, options }) ->
  //   { bestmove, ponder, lines: [{ multipv, depth, score, bound, wdl, pv }], fen } | { stale: true }
  // Rejects with EngineError when the engine is (or becomes) unusable.
  go({ fen, moves = [], movetime, depth, nodes, multipv = 1, options = [] }) {
    const gen = this.#gen;
    return this.#enqueue(async () => {
      if (this.#dead) throw this.#dead;
      if (gen !== this.#gen) return { stale: true };
      for (const [name, value] of options) this.setOption(name, value);
      if (multipv !== this.#multipv) this.setOption('MultiPV', multipv);
      const lines = new Map();
      const limits = [movetime && `movetime ${Math.max(1, Math.round(movetime))}`, depth && `depth ${depth}`, nodes && `nodes ${nodes}`].filter(Boolean);
      const waiting = this.#waitFor((l) => l.startsWith('bestmove'), {
        timeoutMs: (movetime ?? 0) + this.timeoutMs,
        collect: (line) => {
          const info = parseInfo(line);
          if (info && !info.bound && info.multipv <= multipv) lines.set(info.multipv, info);
        },
      });
      this.#send(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
      this.#send(`go ${limits.length ? limits.join(' ') : 'depth 12'}`);
      this.#searching = true;
      let best;
      try {
        best = parseBestmove(await waiting);
      } finally {
        this.#searching = false;
      }
      if (gen !== this.#gen) return { stale: true };
      return { ...best, fen, lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) };
    });
  }

  // Abandon every queued and running search (their promises resolve as stale).
  cancel() {
    this.#gen++;
    if (this.#searching) this.#send('stop');
  }

  terminate() {
    this.cancel();
    this.#die(new EngineError('Engine was shut down', 'terminated'));
  }

  #enqueue(job) {
    const run = this.#queue.then(job, job);
    this.#queue = run.catch(() => {});
    return run;
  }
}
