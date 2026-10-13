import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, setAppToken, appToken } from '../../public/js/net/api.js';
import { SITE, siteOrigin } from '../../public/js/net/platform.js';
import { createStore, memoryBackend } from '../../public/js/store/storage.js';

function capture() {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}'); };
  return calls;
}

test('on the website: same-origin path, cookie credentials, no token', async () => {
  delete globalThis.Capacitor;
  const calls = capture();
  const store = createStore({ backend: memoryBackend() });
  setAppToken('t'.repeat(43), store);
  await apiFetch('/api/state', { method: 'PUT', body: { a: 1 }, store });
  assert.equal(calls[0].url, '/api/state');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers['X-OC-Request'], '1');
  assert.equal(calls[0].init.body, '{"a":1}');
});

test('inside the apps: the public site, a bearer token, no cookies', async () => {
  globalThis.Capacitor = { isNativePlatform: () => true };
  try {
    const calls = capture();
    const store = createStore({ backend: memoryBackend() });
    await apiFetch('/api/me', { store });
    assert.equal(calls[0].url, `${SITE}/api/me`);
    assert.equal(calls[0].init.credentials, 'omit');
    assert.equal(calls[0].init.headers['X-OC-Client'], 'app');
    assert.equal(calls[0].init.headers.Authorization, undefined, 'no token yet');
    setAppToken('abc_DEF-123'.repeat(4), store);
    await apiFetch('/api/me', { store });
    assert.equal(calls[1].init.headers.Authorization, `Bearer ${'abc_DEF-123'.repeat(4)}`);
    setAppToken(null, store);
    assert.equal(appToken(store), null);
    assert.equal(siteOrigin(), 'https://chess.solankidigitaldrafts.com');
  } finally {
    delete globalThis.Capacitor;
  }
});
