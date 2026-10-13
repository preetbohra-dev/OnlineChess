// Phone features inside the iPhone and Android apps, through Capacitor's plugins. The app build
// (scripts/app-www.mjs) loads the plugins' browser scripts, which define globals such as
// `capacitorHaptics`; on the website none of this runs and every function does nothing.
import { isNativeApp } from './platform.js';

const plugin = (global, name) => (isNativeApp() ? globalThis[global]?.[name] ?? null : null);

// A light tap on moves, a firmer one on captures and checks.
export function haptic(kind) {
  const Haptics = plugin('capacitorHaptics', 'Haptics');
  if (!Haptics) return;
  Haptics.impact({ style: kind === 'move' ? 'LIGHT' : 'MEDIUM' }).catch(() => {});
}

// The phone's share sheet for text and a link. Resolves to 'shared' | 'cancelled', or null when
// there is no native sharing (the caller then uses the browser's).
export function nativeShare({ title = 'OnlineChess', text, url }) {
  const Share = plugin('capacitorShare', 'Share');
  if (!Share) return null;
  return Share.share({ title, text, url, dialogTitle: 'Share' }).then(() => 'shared', () => 'cancelled');
}

// "Continue with Google" inside the app. Google does not allow its sign-in inside an app's web
// view, so it opens in the phone's browser; the server sends the browser back to the app's own
// link scheme with a one-time code, which only this app (holding the PKCE verifier) can redeem.
// -> { code, verifier } | { cancelled: true } | null when the browser plugin is missing
export const APP_RETURN = 'com.solankidigitaldrafts.chess://auth';
let pendingGoogle = null;
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function googleInBrowser(site) {
  const Browser = plugin('capacitorBrowser', 'Browser');
  if (!Browser) return null;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  pendingGoogle?.resolve({ cancelled: true });
  const result = new Promise((resolve) => { pendingGoogle = { resolve, verifier }; });
  await Browser.open({ url: `${site}/auth/google/start?app=${challenge}` });
  return result;
}
function finishGoogle(url) {
  if (!pendingGoogle) return;
  const code = new URL(url).searchParams.get('code');
  const { resolve, verifier } = pendingGoogle;
  pendingGoogle = null;
  plugin('capacitorBrowser', 'Browser')?.close().catch(() => {});
  resolve(code ? { code, verifier } : { cancelled: true });
}

// The route inside the app for a link to the public site (https://…/#/room/abc -> #/room/abc).
export function routeForLink(href, site) {
  try {
    const url = new URL(href);
    if (url.origin !== new URL(site).origin) return null;
    return url.hash && url.hash.startsWith('#/') ? url.hash : '#/';
  } catch {
    return null;
  }
}

// The theme in use: the one chosen in Settings, else the phone's.
const darkTheme = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

// Start-up inside the app: the Android back button walks back through the screens and leaves
// the app from home; links to the site that open the app go to their screen; the splash screen
// goes once the first screen is drawn; the status bar follows the theme.
export function startNative({ site, isDark = darkTheme } = {}) {
  if (!isNativeApp()) return;
  // First, so nothing below can leave the splash screen up for good.
  requestAnimationFrame(() => plugin('capacitorSplashScreen', 'SplashScreen')?.hide().catch(() => {}));
  const App = plugin('capacitorApp', 'App');
  App?.addListener('backButton', ({ canGoBack }) => {
    if (location.hash && location.hash !== '#/' && canGoBack) history.back();
    else if (location.hash && location.hash !== '#/') location.hash = '#/';
    else App.exitApp();
  });
  App?.addListener('appUrlOpen', ({ url }) => {
    if (url.startsWith(`${APP_RETURN}?`)) return finishGoogle(url);
    const route = routeForLink(url, site);
    if (route) location.hash = route;
  });
  // The player closed the browser before Google sent them back.
  plugin('capacitorBrowser', 'Browser')?.addListener('browserFinished', () => {
    setTimeout(() => { if (pendingGoogle) { pendingGoogle.resolve({ cancelled: true }); pendingGoogle = null; } }, 800);
  });
  const StatusBar = plugin('capacitorStatusBar', 'StatusBar');
  const paintStatusBar = () => StatusBar?.setStyle({ style: isDark() ? 'DARK' : 'LIGHT' }).catch(() => {});
  paintStatusBar();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintStatusBar);
  new MutationObserver(paintStatusBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return { paintStatusBar };
}
