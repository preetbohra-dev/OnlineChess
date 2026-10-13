// Links to the site can open the apps: Android checks /.well-known/assetlinks.json and iOS checks
// /.well-known/apple-app-site-association. Both need values from the store accounts, so they are
// configured by environment and answer 404 until then.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appLinkFiles, APP_ID } from '../../server/app-links.js';

const CERT = 'AB:CD:'.repeat(15) + 'AB:CD';

test('without configuration there are no app-link files', () => {
  assert.deepEqual(appLinkFiles({}), {});
});

test('Android: the app id and its signing certificates', () => {
  const files = appLinkFiles({ ANDROID_CERT_SHA256: `${CERT}, ${CERT.toLowerCase()}` });
  assert.deepEqual(JSON.parse(files['/.well-known/assetlinks.json']), [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: [CERT, CERT] },
  }]);
  assert.equal(appLinkFiles({ ANDROID_CERT_SHA256: 'not a fingerprint' })['/.well-known/assetlinks.json'], undefined);
});

test('iOS: the team and app, for the site root and its screens', () => {
  const aasa = JSON.parse(appLinkFiles({ APPLE_TEAM_ID: 'ABCDE12345' })['/.well-known/apple-app-site-association']);
  assert.deepEqual(aasa.applinks.details[0].appIDs, [`ABCDE12345.${APP_ID}`]);
  assert.deepEqual(aasa.applinks.details[0].components, [{ '/': '/', comment: 'the app and its #/ screens' }]);
  assert.equal(appLinkFiles({ APPLE_TEAM_ID: 'bad id!' })['/.well-known/apple-app-site-association'], undefined);
});

test('the server serves them as JSON', async () => {
  const { createAppServer } = await import('../../server/index.js');
  const app = createAppServer({ appLinks: appLinkFiles({ APPLE_TEAM_ID: 'ABCDE12345' }) });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${app.http.address().port}`;
    const r = await fetch(`${base}/.well-known/apple-app-site-association`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/json');
    assert.ok((await r.json()).applinks);
    assert.equal((await fetch(`${base}/.well-known/assetlinks.json`)).status, 404);
  } finally {
    await app.close();
  }
});
