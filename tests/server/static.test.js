import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../../server/index.js';

// Fixture: <tmp>/public is served, <tmp>/secret.txt must never be reachable.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-static-'));
const pub = path.join(root, 'public');
fs.mkdirSync(path.join(pub, 'sub'), { recursive: true });
fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><title>t</title>');
fs.writeFileSync(path.join(pub, 'app.js'), 'export {}');
fs.writeFileSync(path.join(pub, 'sub', 'style.css'), 'body{}');
fs.writeFileSync(path.join(pub, 'sub', 'icon.svg'), '<svg/>');
fs.writeFileSync(path.join(pub, 'engine.wasm'), Buffer.from([0, 97, 115, 109]));
fs.writeFileSync(path.join(pub, '.secret'), 'dotfile');
fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP-SECRET');

let server, port;
test.before(async () => {
  server = createAppServer({ publicDir: pub });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  port = server.http.address().port;
});
test.after(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

// Raw request so the client does not normalise "../" before it reaches the server.
function get(rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
      let body = '';
      res.setEncoding('latin1');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves index.html at / with security headers', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
});

test('serves files with correct MIME types', async () => {
  assert.match((await get('/app.js')).headers['content-type'], /^text\/javascript/);
  assert.match((await get('/sub/style.css')).headers['content-type'], /^text\/css/);
  assert.match((await get('/sub/icon.svg')).headers['content-type'], /^image\/svg\+xml/);
  assert.equal((await get('/engine.wasm')).headers['content-type'], 'application/wasm');
});

test('blocks path traversal in every encoding', async () => {
  const attempts = [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/sub/../../secret.txt',
    '/sub/%2e%2e/%2e%2e/secret.txt',
    '/..%5csecret.txt',
    '/%252e%252e/secret.txt',
    '/app.js%00.html',
    '//etc/passwd',
  ];
  for (const p of attempts) {
    const r = await get(p);
    assert.ok([400, 403, 404].includes(r.status), `${p} returned ${r.status}`);
    assert.ok(!r.body.includes('TOP-SECRET'), `${p} leaked a file outside public/`);
  }
});

test('hides dotfiles and directories', async () => {
  assert.equal((await get('/.secret')).status, 404);
  assert.equal((await get('/sub/')).status, 404);
  assert.equal((await get('/sub')).status, 404);
  assert.equal((await get('/missing.js')).status, 404);
});

test('only GET and HEAD are allowed', async () => {
  const post = await get('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  const head = await get('/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});
