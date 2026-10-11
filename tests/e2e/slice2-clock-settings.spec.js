import { test, expect, openLocal, move, openSettings } from './helpers.js';

test('the setup screen starts a timed game with both clocks', async ({ page }) => {
  await page.goto('/#/play/local/new');
  await page.getByTestId('tc-3+2').check({ force: true });
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('clock-w')).toHaveText('3:00');
  await expect(page.getByTestId('clock-b')).toHaveText('3:00');
});

test('increment is added after each completed move', async ({ page }) => {
  await page.goto('/#/play/local?tc=1%2B5');
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await move(page, 'e2', 'e4');
  await move(page, 'e7', 'e5');
  await expect(page.getByTestId('clock-b')).toHaveText(/^1:0[45]$/);
});

test('running out of time loses the game', async ({ page }) => {
  await page.goto('/#/play/local?tc=0.05%2B0');
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('game-reason')).toHaveText('White wins on time', { timeout: 8_000 });
  await expect(page.getByTestId('clock-b')).toHaveText('0:00.0');
});

test('running out of time against a bare king is a draw (FIDE 6.9)', async ({ page }) => {
  await page.goto(`/#/play/local?tc=0.05%2B0&fen=${encodeURIComponent('7k/8/8/8/8/8/8/KQ6 b - - 0 1')}`);
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await move(page, 'h8', 'g8');
  await expect(page.getByTestId('game-reason')).toHaveText('Draw — time ran out, but the opponent cannot checkmate', { timeout: 8_000 });
});

test('the theme choice persists across reloads', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByTestId('theme-light').check({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('btn-settings-done').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('sound effects play only while enabled', async ({ page }) => {
  await openLocal(page);
  await move(page, 'e2', 'e4');
  const played = await page.evaluate(() => window.__oc.soundsPlayed);
  expect(played).toBeGreaterThan(0);
  await openSettings(page);
  await page.getByTestId('setting-sound').uncheck();
  await page.getByTestId('btn-settings-done').click();
  await move(page, 'e7', 'e5');
  expect(await page.evaluate(() => window.__oc.soundsPlayed)).toBe(played);
  expect(await page.evaluate(() => window.__oc.soundEnabled)).toBe(false);
});

test('auto-flip turns the board toward the player to move', async ({ page }) => {
  await page.goto('/#/play/local/new');
  await page.getByTestId('setup-autoflip').check({ force: true });
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('game')).toHaveAttribute('data-orientation', 'w');
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('game')).toHaveAttribute('data-orientation', 'b');
});
