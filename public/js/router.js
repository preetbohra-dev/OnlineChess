// Hash router: "#/play/local?fen=..." -> { path: '/play/local', query: URLSearchParams }.
// Each route handler renders into the outlet and may return a cleanup function.
import { closeAllModals } from './ui/modal.js';

let routes = [];
let outlet = null;
let cleanup = null;

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(search) };
}

export function navigate(path) {
  if (location.hash === `#${path}`) refresh();
  else location.hash = path;
}

export function refresh() {
  const { path, query } = parseHash();
  closeAllModals();
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  outlet.replaceChildren();
  const match = routes.find((r) => r.pattern.test(path)) ?? routes.find((r) => r.notFound);
  const params = match.pattern.exec(path)?.groups ?? {};
  document.title = match.title ? `${match.title} · OnlineChess` : 'OnlineChess';
  for (const link of document.querySelectorAll('[data-nav]')) {
    link.classList.toggle('active', path.startsWith(link.dataset.nav));
  }
  cleanup = match.render(outlet, { path, query, params }) ?? null;
  outlet.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export function startRouter(target, table) {
  outlet = target;
  routes = table;
  window.addEventListener('hashchange', refresh);
  refresh();
}
