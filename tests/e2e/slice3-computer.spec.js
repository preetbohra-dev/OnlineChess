import { test, expect, move, fenOf } from './helpers.js';

async function openBot(page, params) {
  await page.goto(`/#/play/bot?${new URLSearchParams({ engine: 'fast', seed: '1', ...params })}`);
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await engineAwake(page);
}

// Player input unlocks once Stockfish has loaded.
async function engineAwake(page) {
  await expect(page.getByTestId('status-banner')).not.toContainText('waking up', { timeout: 15_000 });
}

test('Normal Mode lists all five computer opponents and opens their setup', async ({ page }) => {
  await page.goto('/#/play');
  for (const id of ['novice', 'amateur', 'pro', 'grandmaster', 'beyond']) await expect(page.getByTestId(`opt-bot-${id}`)).toBeVisible();
  await page.getByTestId('opt-bot-pro').click();
  await expect(page.getByTestId('persona-pro')).toBeChecked();
});

test('setup → start → the bot replies to the first move', async ({ page }) => {
  await page.goto('/#/play/bot/new?persona=novice');
  await page.getByTestId('color-w').check({ force: true });
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('feed-item').filter({ hasText: /./ }).first()).toBeVisible();
  await expect(page.locator('[data-kind="bot"]').first()).toBeVisible();
  await engineAwake(page);
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('move-item')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId('status-banner')).toContainText('White to move');
});

test('as Black the computer moves first', async ({ page }) => {
  await openBot(page, { persona: 'amateur', color: 'b' });
  await expect(page.getByTestId('game')).toHaveAttribute('data-orientation', 'b');
  await expect(page.getByTestId('move-item')).toHaveCount(1, { timeout: 15_000 });
  expect((await fenOf(page)).split(' ')[1]).toBe('b');
});

test('you cannot move the computer\'s pieces', async ({ page }) => {
  await openBot(page, { persona: 'pro', color: 'w' });
  await move(page, 'e7', 'e5');
  await expect(page.getByTestId('move-item')).toHaveCount(0);
});

test('every persona plays a move without errors', async ({ page }) => {
  test.setTimeout(90_000);
  for (const persona of ['novice', 'amateur', 'pro', 'grandmaster', 'beyond']) {
    await openBot(page, { persona, color: 'b' });
    await expect(page.getByTestId('move-item')).toHaveCount(1, { timeout: 15_000 });
  }
});

test('resigning against the computer shows its reaction', async ({ page }) => {
  await openBot(page, { persona: 'grandmaster', color: 'w' });
  await page.getByTestId('btn-resign').click();
  await page.getByTestId('btn-confirm').click();
  await expect(page.getByTestId('game-reason')).toHaveText('Black wins — White resigned');
  await expect(page.locator('.modal-title')).toHaveText('Magnus the Wizard wins');
});

test('the engine loads as WebAssembly and is shut down when you leave', async ({ page }) => {
  const wasm = page.waitForResponse((r) => r.url().endsWith('.wasm'));
  await openBot(page, { persona: 'novice', color: 'w' });
  const response = await wasm;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/wasm');
  expect(await page.evaluate(() => window.__oc.engines)).toBe(2); // opponent + move analysis (taunts on by default)
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.getByTestId('mode-normal')).toBeVisible();
  expect(await page.evaluate(() => window.__oc.engines)).toBe(0);
});
