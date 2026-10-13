import test from 'node:test';
import assert from 'node:assert/strict';
import { routeForLink, haptic, nativeShare } from '../../public/js/net/native.js';

const SITE = 'https://chess.solankidigitaldrafts.com';

test('links to the site open the matching screen in the app; other links do not', () => {
  assert.equal(routeForLink(`${SITE}/#/room/abc123`, SITE), '#/room/abc123');
  assert.equal(routeForLink(`${SITE}/#/challenge?bot=pro&moves=30`, SITE), '#/challenge?bot=pro&moves=30');
  assert.equal(routeForLink(`${SITE}/`, SITE), '#/');
  assert.equal(routeForLink('https://evil.example/#/room/abc', SITE), null);
  assert.equal(routeForLink('not a url', SITE), null);
});

test('on the website the phone features do nothing', () => {
  delete globalThis.Capacitor;
  globalThis.capacitorHaptics = { Haptics: { impact: () => { throw new Error('must not run'); } } };
  try {
    haptic('move');
    assert.equal(nativeShare({ text: 't', url: 'u' }), null);
  } finally {
    delete globalThis.capacitorHaptics;
  }
});

test('inside the app: haptics by kind, the native share sheet', async () => {
  globalThis.Capacitor = { isNativePlatform: () => true };
  const impacts = [];
  globalThis.capacitorHaptics = { Haptics: { impact: (o) => { impacts.push(o.style); return Promise.resolve(); } } };
  let shared;
  globalThis.capacitorShare = { Share: { share: (o) => { shared = o; return Promise.resolve(); } } };
  try {
    haptic('move');
    haptic('capture');
    assert.deepEqual(impacts, ['LIGHT', 'MEDIUM']);
    assert.equal(await nativeShare({ text: 'Beat this', url: `${SITE}/#/challenge?rush=12` }), 'shared');
    assert.equal(shared.url, `${SITE}/#/challenge?rush=12`);
    globalThis.capacitorShare.Share.share = () => Promise.reject(new Error('cancelled'));
    assert.equal(await nativeShare({ text: 'x', url: 'y' }), 'cancelled');
  } finally {
    delete globalThis.Capacitor;
    delete globalThis.capacitorHaptics;
    delete globalThis.capacitorShare;
  }
});

test('inside the app, Google opens in the browser and the one-time code comes back through the app link', async () => {
  const { startNative, googleInBrowser, APP_RETURN } = await import('../../public/js/net/native.js');
  const listeners = {};
  let opened = null;
  let closed = 0;
  Object.assign(globalThis, {
    Capacitor: { isNativePlatform: () => true },
    capacitorApp: { App: { addListener: (name, fn) => { listeners[name] = fn; }, exitApp() {} } },
    capacitorBrowser: { Browser: { open: async ({ url }) => { opened = url; }, close: async () => { closed++; }, addListener: (name, fn) => { listeners[`browser:${name}`] = fn; } } },
    document: { documentElement: { dataset: {} } },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    MutationObserver: class { observe() {} },
    requestAnimationFrame: () => {},
  });
  try {
    startNative({ site: 'https://chess.example' });
    const result = googleInBrowser('https://chess.example');
    const waitOpen = async () => { for (let i = 0; i < 100 && !opened; i++) await new Promise((r) => setTimeout(r, 5)); };
    await waitOpen();
    const challenge = new URL(opened).searchParams.get('app');
    assert.match(opened, /^https:\/\/chess\.example\/auth\/google\/start\?app=[\w-]{43}$/);
    listeners.appUrlOpen({ url: `${APP_RETURN}?code=junk` }); // another app poking the scheme: ignored
    const goodCode = 'a'.repeat(43);
    listeners.appUrlOpen({ url: `${APP_RETURN}?code=${goodCode}` });
    const back = await result;
    assert.equal(back.code, goodCode);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(back.verifier));
    assert.equal(Buffer.from(digest).toString('base64url'), challenge, 'the verifier matches the challenge sent');
    assert.equal(closed, 1, 'the browser closes');

    // Closing the browser without finishing is a cancel.
    opened = null;
    const again = googleInBrowser('https://chess.example');
    await waitOpen();
    listeners['browser:browserFinished']();
    assert.deepEqual(await again, { cancelled: true });
  } finally {
    for (const k of ['Capacitor', 'capacitorApp', 'capacitorBrowser', 'document', 'matchMedia', 'MutationObserver', 'requestAnimationFrame']) delete globalThis[k];
  }
});

test('the app and the server agree on the app\'s return address', async () => {
  const { APP_RETURN: client } = await import('../../public/js/net/native.js');
  const { APP_RETURN: server } = await import('../../server/google-auth.js');
  assert.equal(client, server);
});
