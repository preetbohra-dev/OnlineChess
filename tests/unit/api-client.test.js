import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../../public/js/net/api.js';

function capture() {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}'); };
  return calls;
}

test('same-origin path, cookie credentials, no token', async () => {
  const calls = capture();
  await apiFetch('/api/state', { method: 'PUT', body: { a: 1 } });
  assert.equal(calls[0].url, '/api/state');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers['X-OC-Request'], '1');
  assert.equal(calls[0].init.body, '{"a":1}');
});
