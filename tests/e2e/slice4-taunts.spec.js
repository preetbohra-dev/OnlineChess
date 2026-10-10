import { test, expect, move, openSettings } from './helpers.js';

// After 1.e4 e5 2.Nf3 with Black (you) to move: ...Qg5?? hangs the queen to Nxg5.
const QUEEN_BLUNDER = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

async function openBlunderGame(page, persona = 'pro') {
  const params = new URLSearchParams({ persona, color: 'b', fen: QUEEN_BLUNDER, engine: 'fast', seed: '3' });
  await page.goto(`/#/play/bot?${params}`);
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await expect(page.getByTestId('status-banner')).not.toContainText('waking up', { timeout: 15_000 });
}

test('the computer teases a hung queen by name', async ({ page }) => {
  await openBlunderGame(page);
  await move(page, 'd8', 'g5');
  const taunt = page.locator('[data-testid="feed-item"][data-kind="taunt"]');
  await expect(taunt.first()).toContainText(/queen/i, { timeout: 15_000 });
});

test('each persona has its own voice', async ({ page }) => {
  await openBlunderGame(page, 'beyond');
  await move(page, 'd8', 'g5');
  await expect(page.locator('[data-kind="taunt"]').first()).toContainText(/QUEEN/, { timeout: 15_000 });
});

test('no taunts when trash talk is switched off', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByTestId('setting-taunts').uncheck();
  await page.getByTestId('btn-settings-done').click();
  await openBlunderGame(page);
  expect(await page.evaluate(() => window.__oc.engines)).toBe(1); // no analysis engine started
  await move(page, 'd8', 'g5');
  await expect(page.getByTestId('move-item')).toHaveCount(2, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page.locator('[data-kind="taunt"]')).toHaveCount(0);
});

test('a taunt for the old game never shows up in a new one', async ({ page }) => {
  await openBlunderGame(page);
  await move(page, 'd8', 'g5');
  await page.evaluate(() => { location.hash = '#/play/local'; });
  await expect(page.getByTestId('status-banner')).toContainText('White to move');
  await page.waitForTimeout(1_500);
  await expect(page.locator('[data-kind="taunt"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__oc.engines)).toBe(0);
});
