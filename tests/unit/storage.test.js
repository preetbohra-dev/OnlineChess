import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend } from '../../public/js/store/storage.js';
import { loadSettings, saveSettings, createSettings, DEFAULT_SETTINGS } from '../../public/js/store/settings.js';

test('live settings persist updates and notify listeners', () => {
  const backend = memoryBackend();
  const settings = createSettings(createStore({ backend }));
  const seen = [];
  settings.on('change', (s) => seen.push(s.sound));
  settings.update({ sound: false, theme: 'bogus' });
  assert.equal(settings.get().sound, false);
  assert.equal(settings.get().theme, 'system');
  assert.deepEqual(seen, [false]);
  assert.equal(createSettings(createStore({ backend })).get().sound, false, 'survives a reload');
});

test('live settings work with broken storage', () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  const settings = createSettings(createStore({ backend: broken }));
  assert.deepEqual(settings.get(), DEFAULT_SETTINGS);
  assert.equal(settings.update({ sound: false }).sound, false);
});

test('store round-trips JSON under a versioned prefix', () => {
  const backend = memoryBackend();
  const store = createStore({ backend });
  assert.equal(store.get('missing', 42), 42);
  assert.equal(store.set('k', { a: [1, 2] }), true);
  assert.deepEqual(store.get('k'), { a: [1, 2] });
  assert.equal(backend.getItem('oc.v1.k'), '{"a":[1,2]}');
  store.remove('k');
  assert.equal(store.get('k', null), null);
});

test('corrupt data is backed up and replaced by the fallback', () => {
  const backend = memoryBackend();
  backend.setItem('oc.v1.k', '{not json');
  const store = createStore({ backend });
  assert.deepEqual(store.get('k', { ok: true }), { ok: true });
  assert.equal(backend.getItem('oc.v1.k.corrupt'), '{not json');
  assert.equal(backend.getItem('oc.v1.k'), null);
});

test('quota errors and broken storage are swallowed', () => {
  const throwing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('denied'); },
  };
  const store = createStore({ backend: throwing });
  assert.equal(store.set('k', 1), false);
  assert.equal(store.get('k', 'fallback'), 'fallback');
  assert.doesNotThrow(() => store.remove('k'));
});

test('settings fall back to defaults and drop invalid or unknown values', () => {
  const store = createStore({ backend: memoryBackend() });
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);
  store.set('settings', { version: 0, theme: 'neon', sound: 'yes', autoFlip: true, animation: 'fast', junk: 1, showCoordinates: false });
  const s = loadSettings(store);
  assert.equal(s.theme, DEFAULT_SETTINGS.theme, 'unknown theme replaced');
  assert.equal(s.sound, DEFAULT_SETTINGS.sound, 'wrong type replaced');
  assert.equal(s.autoFlip, true);
  assert.equal(s.animation, 'fast');
  assert.equal(s.showCoordinates, false);
  assert.equal('junk' in s, false);
  assert.equal(s.version, DEFAULT_SETTINGS.version);
});

test('saveSettings persists only valid settings', () => {
  const store = createStore({ backend: memoryBackend() });
  saveSettings(store, { ...DEFAULT_SETTINGS, theme: 'light', sound: false });
  assert.equal(loadSettings(store).theme, 'light');
  assert.equal(loadSettings(store).sound, false);
});
