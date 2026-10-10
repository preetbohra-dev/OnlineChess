import { startRouter, navigate } from './router.js';
import { renderHome, renderPlayMenu, renderTrainMenu, renderNotFound } from './screens/home.js';
import { mountGameScreen } from './ui/game-screen.js';
import { createLocalSession } from './sessions/local-session.js';
import { isValidFen } from './core/rules.js';
import { parseTimeControl } from './core/clock.js';
import { toast } from './ui/toast.js';
import { h } from './ui/dom.js';
import { renderLocalSetup } from './screens/local-setup.js';
import { openSettings } from './ui/settings-panel.js';
import { installSoundUnlock } from './ui/sound.js';
import { appSettings, applyTheme } from './store/settings.js';
import { renderBotSetup } from './screens/bot-setup.js';
import { createBotSession } from './sessions/bot-session.js';
import { personaById } from './data/personas.js';
import { UciEngine } from './engine/uci-engine.js';
import { createWorkerTransport } from './engine/transport-worker.js';
import { createRng } from './core/rng.js';

import { createAnalyzer } from './engine/analysis.js';
import { renderOnlineNew, renderRoom } from './screens/online.js';

const debug = (globalThis.__oc ??= {});
debug.engines = 0;
const settings = appSettings();

// ?fen= lets lessons, tests and shared links start from a position; anything invalid is ignored.
function startFen(query) {
  const fen = query.get('fen');
  if (!fen) return undefined;
  if (isValidFen(fen)) return fen;
  toast('Invalid FEN in the link — starting from the initial position.', { kind: 'warn' });
  return undefined;
}

function renderLocalGame(outlet, { query }) {
  const tc = query.get('tc');
  const timeControl = parseTimeControl(tc);
  if (tc && !timeControl) toast('Invalid time control in the link — playing without a clock.', { kind: 'warn' });
  const screen = mountGameScreen(outlet, createLocalSession({ fen: startFen(query), timeControl }), {
    onNewGame: () => navigate('/play/local/new'),
  });
  return () => screen.destroy();
}

// ?engine=fast caps search time (tests); ?seed=N makes the persona's choices reproducible.
function renderBotGame(outlet, { query }) {
  const persona = personaById(query.get('persona'));
  if (query.get('persona') && persona.id !== query.get('persona')) toast(`Unknown opponent — you're playing ${persona.name}.`, { kind: 'warn' });
  const requested = query.get('color');
  const playerColor = requested === 'w' || requested === 'b' ? requested : Math.random() < 0.5 ? 'w' : 'b';
  const tc = query.get('tc');
  const timeControl = parseTimeControl(tc);
  if (tc && !timeControl) toast('Invalid time control in the link — playing without a clock.', { kind: 'warn' });
  const seed = Number.parseInt(query.get('seed') ?? '', 10);

  const engine = new UciEngine(createWorkerTransport());
  debug.engines++;
  const ready = engine.init().then(() => engine.newGame()).then(() => engine);
  ready.catch((err) => {
    if (err?.reason !== 'terminated') toast('The chess engine could not start. Reload the page to try again.', { kind: 'warn' });
  });

  // A second, full-strength engine judges your moves so the persona can tease your mistakes.
  let analysisEngine = null;
  let analyzer = null;
  if (settings.get().taunts) {
    analysisEngine = new UciEngine(createWorkerTransport());
    debug.engines++;
    const analysisReady = analysisEngine.init().then(() => analysisEngine);
    analysisReady.catch(() => {}); // taunts are optional; the game works without them
    analyzer = createAnalyzer(analysisReady, query.get('engine') === 'fast' ? { depth: 8 } : { movetime: 200 });
  }

  const session = createBotSession({
    persona,
    playerColor,
    fen: startFen(query),
    timeControl,
    engine: ready,
    rng: createRng(Number.isFinite(seed) ? seed : undefined),
    fast: query.get('engine') === 'fast',
    analyzer,
    tauntsEnabled: () => settings.get().taunts,
  });
  const screen = mountGameScreen(outlet, session, {
    orientation: playerColor,
    onNewGame: () => navigate(`/play/bot/new?persona=${persona.id}`),
  });
  session.start();
  return () => {
    screen.destroy();
    engine.terminate();
    debug.engines--;
    if (analysisEngine) {
      analysisEngine.terminate();
      debug.engines--;
    }
  };
}
applyTheme(settings.get().theme);
settings.on('change', (s) => applyTheme(s.theme));
installSoundUnlock();
document.getElementById('btn-settings').addEventListener('click', () => openSettings());

if (location.protocol === 'file:') {
  document.body.prepend(h('div', { class: 'file-banner', role: 'alert' },
    'OnlineChess must be served over http. Run "npm start" and open http://localhost:3200.'));
}

startRouter(document.getElementById('app'), [
  { pattern: /^\/$/, title: '', render: renderHome },
  { pattern: /^\/play$/, title: 'Normal Mode', render: renderPlayMenu },
  { pattern: /^\/play\/local$/, title: 'Pass & Play', render: renderLocalGame },
  { pattern: /^\/play\/local\/new$/, title: 'Pass & Play', render: renderLocalSetup },
  { pattern: /^\/play\/bot$/, title: 'vs Computer', render: renderBotGame },
  { pattern: /^\/play\/bot\/new$/, title: 'Play the computer', render: renderBotSetup },
  { pattern: /^\/play\/online\/new$/, title: 'Play online', render: renderOnlineNew },
  { pattern: /^\/room\/(?<id>new|[A-HJ-NP-Z2-9]{6})$/, title: 'Online game', render: renderRoom },
  { pattern: /^\/train$/, title: 'Training Mode', render: renderTrainMenu },
  { pattern: /^$/, notFound: true, title: 'Not found', render: renderNotFound },
]);
