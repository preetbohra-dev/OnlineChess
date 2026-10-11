// UciEngine failure handling with a scripted fake transport (no real engine needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { UciEngine, EngineError } from '../../public/js/engine/uci-engine.js';
import { createBotSession } from '../../public/js/sessions/bot-session.js';
import { personaById } from '../../public/js/data/personas.js';
import { createRng } from '../../public/js/core/rng.js';

// replies: command -> lines to answer with (or null to stay silent).
function fakeTransport(replies = {}) {
  let listener = () => {};
  let errorHandler = () => {};
  const sent = [];
  const t = {
    sent,
    terminated: false,
    post(command) {
      sent.push(command);
      const key = Object.keys(replies).find((k) => command.startsWith(k));
      const out = key ? replies[key] : null;
      if (out) setTimeout(() => out.forEach((line) => listener(line)), 1);
    },
    onLine(fn) { listener = fn; },
    onError(fn) { errorHandler = fn; },
    crash() { errorHandler(new Error('boom')); },
    terminate() { t.terminated = true; },
  };
  return t;
}

const HANDSHAKE = { uci: ['option name MultiPV type spin default 1 min 1 max 256', 'uciok'], isready: ['readyok'] };

test('a crashed worker rejects pending work immediately and marks the engine dead', async () => {
  const transport = fakeTransport({ ...HANDSHAKE, go: null });
  const engine = await new UciEngine(transport, { timeoutMs: 60_000 }).init();
  const search = engine.go({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', depth: 5 });
  setTimeout(() => transport.crash(), 10);
  await assert.rejects(search, (err) => err instanceof EngineError && err.reason === 'crashed');
  assert.equal(engine.alive, false);
  await assert.rejects(engine.go({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', depth: 1 }), EngineError);
});

test('a reply timeout kills the engine instead of letting a late answer leak into the next search', async () => {
  const transport = fakeTransport({ ...HANDSHAKE, go: null });
  const engine = await new UciEngine(transport, { timeoutMs: 30 }).init();
  await assert.rejects(engine.go({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', depth: 5 }), (err) => err.reason === 'timeout');
  assert.equal(engine.alive, false);
  assert.equal(transport.terminated, true);
});

test('terminate during init rejects at once with reason "terminated"', async () => {
  const transport = fakeTransport({}); // never answers "uci"
  const engine = new UciEngine(transport, { timeoutMs: 60_000 });
  const init = engine.init();
  engine.terminate();
  await assert.rejects(init, (err) => err.reason === 'terminated');
});

test('a bot whose engine fails still makes a legal move instead of freezing the game', async () => {
  const transport = fakeTransport({ ...HANDSHAKE, go: null });
  const engine = await new UciEngine(transport, { timeoutMs: 20 }).init();
  const s = createBotSession({ persona: personaById('beyond'), engine: Promise.resolve(engine), minThinkMs: 0, rng: createRng(1) });
  const feed = [];
  s.on('feed', (f) => feed.push(f.text));
  s.start();
  await new Promise((r) => setTimeout(r, 0));
  const replied = new Promise((resolve) => s.on('change', (d) => d.by === 'bot' && resolve(d)));
  assert.equal(s.submitMove('e4').ok, true);
  const d = await replied;
  assert.equal(d.move.color, 'b');
  assert.equal(s.inputColor(), 'w', 'the player can keep going');
  assert.ok(feed.some((t) => t.includes('improvising')));
  s.destroy();
});
