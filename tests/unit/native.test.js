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
