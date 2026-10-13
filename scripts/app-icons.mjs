#!/usr/bin/env node
// Replaces Capacitor's placeholder icons and splash screens in ios/ and android/ with the
// OnlineChess knight, rendered with the installed Chrome at each file's own size.
//   node scripts/app-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILE = '#1d2029'; // the icon tile, as in public/icons
const SPLASH = '#16181d'; // the app background
const KNIGHT = '#7cc4a4';

// Width and height from a PNG header.
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// shape: 'square' (full bleed, opaque), 'rounded', 'circle', 'foreground' (transparent, knight in
// the adaptive-icon safe zone), 'splash' (background, small knight in the middle).
function art({ width, height, shape }) {
  const s = Math.min(width, height);
  const glyph = { square: 0.74, rounded: 0.68, circle: 0.6, foreground: 0.56, splash: 0.22 }[shape] * s;
  const bg = {
    square: `<rect width="${width}" height="${height}" fill="${TILE}"/>`,
    rounded: `<rect width="${width}" height="${height}" rx="${s * 0.22}" fill="${TILE}"/>`,
    circle: `<circle cx="${width / 2}" cy="${height / 2}" r="${s / 2}" fill="${TILE}"/>`,
    foreground: '',
    splash: `<rect width="${width}" height="${height}" fill="${SPLASH}"/>`,
  }[shape];
  return `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${bg}
  <text x="${width / 2}" y="${height / 2 + glyph * 0.33}" font-size="${glyph}" text-anchor="middle" fill="${KNIGHT}" font-family="Georgia, 'Times New Roman', serif">♞</text>
</svg></body></html>`;
}

const targets = [];
const res = path.join(ROOT, 'android/app/src/main/res');
for (const dir of fs.readdirSync(res)) {
  for (const [name, shape] of [['ic_launcher.png', 'rounded'], ['ic_launcher_round.png', 'circle'], ['ic_launcher_foreground.png', 'foreground'], ['splash.png', 'splash']]) {
    const file = path.join(res, dir, name);
    if (fs.existsSync(file)) targets.push({ file, shape });
  }
}
const assets = path.join(ROOT, 'ios/App/App/Assets.xcassets');
for (const f of fs.readdirSync(path.join(assets, 'AppIcon.appiconset')).filter((f) => f.endsWith('.png'))) {
  targets.push({ file: path.join(assets, 'AppIcon.appiconset', f), shape: 'square' }); // iOS rounds it; no transparency allowed
}
for (const f of fs.readdirSync(path.join(assets, 'Splash.imageset')).filter((f) => f.endsWith('.png'))) {
  targets.push({ file: path.join(assets, 'Splash.imageset', f), shape: 'splash' });
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage();
for (const { file, shape } of targets) {
  const { width, height } = pngSize(file);
  await page.setViewportSize({ width, height });
  await page.setContent(art({ width, height, shape }));
  await page.locator('svg').screenshot({ path: file, omitBackground: shape === 'rounded' || shape === 'circle' || shape === 'foreground' });
  console.log(`${path.relative(ROOT, file)} ${width}x${height} ${shape}`);
}
await browser.close();

// The adaptive icon's background layer.
const bgXml = path.join(res, 'values/ic_launcher_background.xml');
fs.writeFileSync(bgXml, fs.readFileSync(bgXml, 'utf8').replace(/#[0-9A-Fa-f]{6}/, TILE.toUpperCase()));
