#!/usr/bin/env node
// Builds build/app-www, the files the iPhone and Android apps carry (Capacitor's webDir):
// public/ as it is, plus Capacitor's browser scripts for the plugins we use, a Content Security
// Policy (the app's pages have no server to send one) and edge-to-edge layout on phones.
//   node scripts/app-www.mjs        (npm run app:sync also copies it into ios/ and android/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'app-www');
const SITE = 'https://chess.solankidigitaldrafts.com';

// Capacitor's core and plugin scripts (no bundler: each defines a global, e.g. capacitorHaptics).
export const CAPACITOR_SCRIPTS = [
  ['core', 'dist/capacitor.js', 'capacitor.js'],
  ['app', 'dist/plugin.js', 'app.js'],
  ['haptics', 'dist/plugin.js', 'haptics.js'],
  ['share', 'dist/plugin.js', 'share.js'],
  ['splash-screen', 'dist/plugin.js', 'splash-screen.js'],
  ['status-bar', 'dist/plugin.js', 'status-bar.js'],
  ['browser', 'dist/plugin.js', 'browser.js'],
];

export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  `connect-src 'self' ${SITE} ${SITE.replace('https', 'wss')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

// index.html for the apps: the CSP, viewport-fit=cover (so the safe-area insets apply) and the
// Capacitor scripts before the app's own module.
export function appIndex(html) {
  const scripts = CAPACITOR_SCRIPTS.map(([, , name]) => `  <script src="/vendor/capacitor/${name}"></script>\n`).join('');
  const out = html
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`)
    .replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"')
    .replace('  <script type="module" src="/js/main.js"></script>', `${scripts}  <script type="module" src="/js/main.js"></script>`);
  for (const must of ['Content-Security-Policy', 'viewport-fit=cover', '/vendor/capacitor/capacitor.js']) {
    if (!out.includes(must)) throw new Error(`public/index.html changed shape: could not add ${must}`);
  }
  return out;
}

// Regular files only (no symlinks), like scripts/vendor.mjs.
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

export function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyTree(path.join(ROOT, 'public'), OUT);
  const vendor = path.join(OUT, 'vendor', 'capacitor');
  fs.mkdirSync(vendor, { recursive: true });
  for (const [pkg, file, name] of CAPACITOR_SCRIPTS) {
    fs.copyFileSync(path.join(ROOT, 'node_modules', '@capacitor', pkg, file), path.join(vendor, name));
  }
  fs.copyFileSync(path.join(ROOT, 'node_modules', '@capacitor', 'core', 'LICENSE'), path.join(vendor, 'LICENSE'));
  const index = path.join(OUT, 'index.html');
  fs.writeFileSync(index, appIndex(fs.readFileSync(index, 'utf8')));
  return OUT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Built ${path.relative(ROOT, build())}`);
