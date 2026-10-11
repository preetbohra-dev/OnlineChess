import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServiceWorker } from '../../server/service-worker.js';

function tempPublic(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sw-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test('lists every public file (not dotfiles), with / for the page', () => {
  const dir = tempPublic({ 'index.html': '<p>', 'js/main.js': 'x', 'data/p.json': '{}', '.hidden': 's', 'js/.secret': 's' });
  const sw = buildServiceWorker(dir);
  assert.deepEqual(sw.assets, ['/', '/data/p.json', '/js/main.js']);
  assert.match(sw.body, /^\/\/ OnlineChess service worker/);
  assert.match(sw.body, /const ASSETS = \["\/","\/data\/p.json","\/js\/main.js"\];/);
  assert.match(sw.body, /addEventListener\('fetch'/);
});

test('the version changes when any file changes, and only then', () => {
  const dir = tempPublic({ 'index.html': 'a', 'js/main.js': 'x' });
  const v1 = buildServiceWorker(dir).version;
  assert.equal(buildServiceWorker(dir).version, v1);
  fs.writeFileSync(path.join(dir, 'js/main.js'), 'y');
  assert.notEqual(buildServiceWorker(dir).version, v1);
});

test('the real app precaches the engine, the piece sprites and the puzzles', () => {
  const { assets } = buildServiceWorker(new URL('../../public', import.meta.url).pathname);
  for (const must of ['/vendor/stockfish/stockfish-19-lite-single.wasm', '/vendor/cm-chessboard/assets/pieces/staunty.svg',
    '/vendor/cm-chessboard/assets/pieces/standard.svg', '/data/puzzles.json', '/manifest.webmanifest', '/icons/icon-192.png']) {
    assert.ok(assets.includes(must), must);
  }
});

test('the worker never answers the API, online play or itself from the cache, and falls back to the app offline', () => {
  const dir = tempPublic({ 'index.html': '<p>' });
  const { body } = buildServiceWorker(dir);
  assert.match(body, /url\.pathname === '\/ws' \|\| url\.pathname\.startsWith\('\/api\/'\)\) return;/);
  assert.match(body, /url\.pathname === '\/sw\.js'/);
  assert.match(body, /caches\.open\(CACHE\)\.then/, 'only this version\'s cache');
  assert.match(body, /request\.mode === 'navigate'/);
});
