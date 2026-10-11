// Installable app: registers the service worker (offline play), shows a banner when a new
// version is ready, and keeps the browser's install prompt for an "Install app" button.
import { h } from './dom.js';
import { bus } from '../core/events.js';

const debug = (globalThis.__oc ??= {});
let installPrompt = null;

export const canInstall = () => Boolean(installPrompt);

export async function install() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  bus.emit('pwa:install-changed');
  return choice?.outcome === 'accepted';
}

function updateBanner(registration) {
  if (document.querySelector('[data-testid="update-banner"]')) return;
  // Reloading ends a game in progress (in every open tab), so say so when one is on screen.
  const playing = document.querySelector('[data-testid="game"][data-status="playing"]');
  const banner = h('div', { class: 'update-banner', testid: 'update-banner', role: 'status' },
    h('span', {}, playing
      ? 'A new version is ready. Reload after your game — reloading now ends it.'
      : 'A new version of OnlineChess is ready. (Reloading ends any game open in another tab.)'),
    h('button', { class: 'btn btn-small btn-primary', type: 'button', testid: 'btn-update', onClick: () => registration.waiting?.postMessage('skip-waiting') }, 'Reload'),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Dismiss', onClick: () => banner.remove() }, '✕'));
  document.body.append(banner);
}

const OFFER_KEY = 'oc.v1.install-offered';

// Offer installation at a good moment (a win, a solved daily), at most once a week.
function offerInstall() {
  if (!installPrompt || document.querySelector('[data-testid="install-banner"]')) return;
  try {
    const last = Number(localStorage.getItem(OFFER_KEY) ?? 0);
    if (Date.now() - last < 7 * 86_400_000) return;
    localStorage.setItem(OFFER_KEY, String(Date.now()));
  } catch { /* storage unavailable: offer anyway */ }
  const banner = h('div', { class: 'update-banner', testid: 'install-banner', role: 'status' },
    h('span', {}, 'Install OnlineChess for one-tap access — it works offline too.'),
    h('button', { class: 'btn btn-small btn-primary', type: 'button', testid: 'btn-install', onClick: () => { banner.remove(); install(); } }, 'Install'),
    h('button', { class: 'btn btn-small', type: 'button', 'aria-label': 'Not now', onClick: () => banner.remove() }, '✕'));
  document.body.append(banner);
}

export function installPwa() {
  bus.on('profile:change', ({ event, xp }) => {
    const won = event?.type === 'game' && event.status?.winner && event.status.winner === event.color;
    if (won || (event?.type === 'daily' && xp > 0)) offerInstall();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // offered from our own button instead of the browser's mini-infobar
    installPrompt = event;
    bus.emit('pwa:install-changed');
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; bus.emit('pwa:install-changed'); });

  // Service workers need a secure context (https, or localhost while developing).
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over after "Reload" (not the very first install).
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    debug.sw = registration;
    // Long-lived app windows look for a new version whenever they come back into view.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
    if (registration.waiting && hadController) updateBanner(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) updateBanner(registration);
      });
    });
  }).catch(() => { /* offline support is optional */ });
}
