import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appIndex, APP_CSP, CAPACITOR_SCRIPTS } from '../../scripts/app-www.mjs';

const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

test('the app index gets a CSP, edge-to-edge layout and the Capacitor scripts before the app', () => {
  const out = appIndex(html);
  assert.ok(out.includes(`<meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`));
  assert.match(out, /viewport-fit=cover/);
  const scripts = [...out.matchAll(/<script src="\/vendor\/capacitor\/([\w-]+\.js)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, CAPACITOR_SCRIPTS.map(([, , name]) => name));
  assert.ok(out.indexOf('/vendor/capacitor/capacitor.js') < out.indexOf('/js/main.js'), 'plugins load before the app');
});

test('the app may only talk to itself and the public site', () => {
  assert.match(APP_CSP, /connect-src 'self' https:\/\/chess\.solankidigitaldrafts\.com wss:\/\/chess\.solankidigitaldrafts\.com;/);
  assert.match(APP_CSP, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.equal(APP_CSP.split(/[ ;]+/).includes("'unsafe-eval'"), false);
  assert.equal(APP_CSP.includes('*'), false);
});

test('a changed index.html fails loudly instead of building a broken app', () => {
  assert.throws(() => appIndex('<html></html>'), /changed shape/);
});
