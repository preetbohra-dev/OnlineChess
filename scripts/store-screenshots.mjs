#!/usr/bin/env node
// Renders the Google Play listing images into store/play/: phone screenshots at 1080x1920 (Play
// rejects phone shots taller than 2:1) and the 1024x500 feature graphic. Starts its own server.
//   PW_CHANNEL=chrome node scripts/store-screenshots.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'play');
const PORT = 4196; // not 4190: fetch() refuses that port (it is on the spec's blocked list)
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: ':memory:', PUSH: 'off', WEEKLY_POOL_FILE: 'tests/fixtures/weekly-puzzles.json' },
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

async function clickSquare(page, square) {
  const box = await page.locator(`.board rect[data-square="${square}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function move(page, from, to) {
  await clickSquare(page, from);
  await clickSquare(page, to);
}
const settle = (page, ms = 600) => page.waitForTimeout(ms);

const SHOTS = [
  ['1-home', async (page) => {
    await page.goto(`${BASE}/#/`);
    await page.getByTestId('dashboard').waitFor();
  }],
  ['2-computer', async (page) => {
    await page.goto(`${BASE}/#/play/bot/new?persona=pro`);
    await page.getByTestId('color-w').check({ force: true });
    await page.getByTestId('btn-start').click();
    await page.getByTestId('status-banner').filter({ hasNotText: 'waking up' }).waitFor({ timeout: 20_000 });
    for (const [from, to, n] of [['e2', 'e4', 2], ['g1', 'f3', 4], ['f1', 'c4', 6]]) {
      await move(page, from, to);
      await page.getByTestId('move-item').nth(n - 1).waitFor({ timeout: 20_000 });
    }
    await page.locator('.player-card').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -12));
  }],
  ['3-coach', async (page) => {
    await page.goto(`${BASE}/#/train`);
    await page.getByTestId('opt-coach').click();
    await page.getByTestId('level-novice').check({ force: true });
    await page.getByTestId('color-w').check({ force: true });
    await page.getByTestId('btn-start').click();
    await page.getByTestId('coach-panel').waitFor();
    await page.getByTestId('status-banner').filter({ hasNotText: 'waking up' }).waitFor({ timeout: 20_000 });
    await move(page, 'e2', 'e4');
    await page.getByTestId('coach-grade').filter({ hasText: 'e4' }).waitFor({ timeout: 20_000 });
    await page.getByTestId('coach-panel').evaluate((el) => el.scrollIntoView({ block: 'end' })); // the coach's words under the board
  }],
  ['4-puzzles', async (page) => {
    await page.goto(`${BASE}/#/puzzles`);
    await page.locator('.board rect[data-square="e4"]').waitFor();
  }],
  ['5-train', async (page) => {
    await page.goto(`${BASE}/#/train`);
    await page.getByTestId('opt-lessons').waitFor();
  }],
  ['6-lesson', async (page) => {
    await page.goto(`${BASE}/#/learn/novice-board`);
    await page.getByTestId('btn-next').waitFor();
  }],
];

const FEATURE = `<!doctype html><html><head><style>
  body { margin: 0; width: 1024px; height: 500px; background: radial-gradient(circle at 30% 40%, #22352d 0%, #16181d 60%); font-family: Georgia, 'Times New Roman', serif; color: #fff; display: flex; align-items: center; overflow: hidden; }
  .knight { font-size: 330px; color: #7cc4a4; margin: 0 40px 30px 70px; line-height: 1; }
  h1 { font-size: 78px; margin: 0 0 14px; letter-spacing: -1px; }
  p { font: 500 32px/1.35 system-ui, sans-serif; color: #c9d1cc; margin: 0; max-width: 560px; }
</style></head><body><div class="knight">♞</div><div><h1>OnlineChess</h1><p>Play friends or the computer. Learn with a coach that explains every move.</p></div></body></html>`;

try {
  await waitForServer();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  for (const [name, show] of SHOTS) {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    await show(page);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`store/play/${name}.png`);
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(FEATURE);
  await page.screenshot({ path: path.join(OUT, 'feature-graphic.png') });
  console.log('store/play/feature-graphic.png');
  // Play wants a full square; it rounds the corners itself.
  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1d2029"/><text x="256" y="381" font-size="379" text-anchor="middle" fill="#7cc4a4" font-family="Georgia, 'Times New Roman', serif">♞</text></svg></body>`);
  await page.locator('svg').screenshot({ path: path.join(OUT, 'icon-512.png') });
  console.log('store/play/icon-512.png');
  await browser.close();
} finally {
  stop();
}
