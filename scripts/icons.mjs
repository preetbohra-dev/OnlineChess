#!/usr/bin/env node
// Renders the app icons (public/icons/*.png) from the knight logo with the installed Chrome.
//   node scripts/icons.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ICONS = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'maskable-512.png', size: 512, pad: 0.12, square: true }, // safe zone for adaptive icons
  { file: 'apple-touch-icon.png', size: 180, pad: 0, square: true },
];

const svg = ({ size, pad, square }) => {
  const inner = size * (1 - 2 * pad);
  return `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${square ? 0 : size * 0.22}" fill="#1d2029"/>
  <text x="${size / 2}" y="${size / 2 + inner * 0.27}" font-size="${inner * 0.68}" text-anchor="middle" fill="#7cc4a4" font-family="Georgia, 'Times New Roman', serif">♞</text>
</svg></body></html>`;
};

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage();
for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(svg(icon));
  await page.locator('svg').screenshot({ path: `public/icons/${icon.file}`, omitBackground: !icon.square });
  console.log(`public/icons/${icon.file}`);
}
await browser.close();
