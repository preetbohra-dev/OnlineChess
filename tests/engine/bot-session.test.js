// Bot sessions against the real engine (fast search).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../helpers/node-engine-transport.js';
import { UciEngine } from '../../public/js/engine/uci-engine.js';
import { createBotSession } from '../../public/js/sessions/bot-session.js';
import { personaById } from '../../public/js/data/personas.js';
import { createRng } from '../../public/js/core/rng.js';

let engine;
test.before(async () => {
  engine = new UciEngine(await createNodeTransport(), { timeoutMs: 30_000 });
  await engine.init();
});
test.after(() => engine.terminate());

function nextChange(session, predicate = () => true) {
  return new Promise((resolve) => {
    const off = session.on('change', (d) => { if (predicate(d)) { off(); resolve(d); } });
  });
}
const botMoved = (s) => nextChange(s, (d) => d.by === 'bot');
// The session unlocks player input once the engine promise has settled (next microtask).
const settle = () => new Promise((r) => setTimeout(r, 0));

test('the bot answers the player\'s move', async () => {
  const s = createBotSession({ persona: personaById('beyond'), engine: Promise.resolve(engine), fast: true, minThinkMs: 0, rng: createRng(1) });
  const feed = [];
  s.on('feed', (f) => feed.push(f));
  s.start();
  await settle();
  assert.equal(feed[0].kind, 'bot', 'greets the player');
  assert.equal(s.inputColor(), 'w');
  const reply = botMoved(s);
  assert.equal(s.submitMove('e4').ok, true);
  assert.equal(s.inputColor(), null, 'no input while the bot thinks');
  const d = await reply;
  assert.equal(d.move.color, 'b');
  assert.equal(s.rules.history().length, 2);
  assert.equal(s.inputColor(), 'w');
  s.destroy();
});

test('the bot moves first when the player takes Black, using its opening book', async () => {
  const s = createBotSession({ persona: personaById('grandmaster'), playerColor: 'b', engine: Promise.resolve(engine), fast: true, minThinkMs: 0, rng: createRng(2) });
  const first = botMoved(s);
  s.start();
  const d = await first;
  assert.ok(['e4', 'd4', 'c4', 'Nf3'].includes(d.move.san), `book opening, got ${d.move.san}`);
  assert.equal(s.inputColor(), 'b', 'now it is the player\'s turn');
  assert.deepEqual(s.submitMove('Nf3'), { ok: false, reason: 'illegal' }, 'White pieces stay off-limits');
  s.destroy();
});

test('the bot finds a mate in one and announces the result', async () => {
  const s = createBotSession({ persona: personaById('pro'), playerColor: 'b', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', engine: Promise.resolve(engine), fast: true, minThinkMs: 0, rng: createRng(3) });
  const feed = [];
  s.on('feed', (f) => feed.push(f.text));
  const done = botMoved(s);
  s.start();
  await done;
  assert.equal(s.rules.status().reason, 'checkmate');
  assert.ok(feed.some((t) => s.persona.lines.botWins.includes(t)), 'gloats a little');
  assert.equal(s.resultTitle(s.rules.status()), 'Professor Hoot wins');
  s.destroy();
});

test('destroying the session drops a pending bot move', async () => {
  const s = createBotSession({ persona: personaById('beyond'), engine: Promise.resolve(engine), fast: true, minThinkMs: 0, rng: createRng(4) });
  s.start();
  await settle();
  s.submitMove('d4');
  s.destroy();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.rules.history().length, 1, 'no late move after destroy');
});

test('the bot declines a draw offer in an equal opening', async () => {
  const s = createBotSession({ persona: personaById('amateur'), engine: Promise.resolve(engine), fast: true, minThinkMs: 0, rng: createRng(5) });
  s.start();
  await settle();
  const replied = botMoved(s);
  s.submitMove('e4');
  await replied;
  const answered = nextChange(s, (d) => d.action === 'declineDraw' || d.action === 'acceptDraw');
  assert.equal(s.offerDraw().ok, true);
  assert.equal((await answered).action, 'declineDraw');
  assert.equal(s.rules.drawOffer(), null);
  s.destroy();
});
