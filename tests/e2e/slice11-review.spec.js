import { test, expect, move, openLocal } from './helpers.js';

async function foolsMate(page) {
  await openLocal(page);
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) await move(page, from, to);
  await expect(page.getByTestId('game-over-modal')).toBeVisible();
}

test('after a game, Review grades every move and finds the blunder', async ({ page }) => {
  await foolsMate(page);
  await page.getByTestId('btn-review').click();
  await expect(page).toHaveURL(/#\/review\/[a-z0-9]+$/);
  const id = page.url().split('/review/')[1];
  await page.goto(`/#/review/${id}?engine=fast`);
  await expect(page.getByTestId('review-summary')).toBeVisible({ timeout: 30_000 });
  const w = Number((await page.getByTestId('accuracy-w').textContent()).replace('%', ''));
  const b = Number((await page.getByTestId('accuracy-b').textContent()).replace('%', ''));
  expect(b).toBeGreaterThan(w);
  await expect(page.getByTestId('key-3')).toBeVisible();
  await expect(page.getByTestId('rv-move-3')).toHaveAttribute('data-grade', 'blunder');
  await page.getByTestId('rv-move-3').click();
  await expect(page.getByTestId('review-current')).toContainText('Blunder');
  // The review is cached: reopening is instant.
  await page.goto(`/#/review/${id}`);
  await expect(page.getByTestId('review-summary')).toBeVisible();
  await expect(page.getByTestId('review-panel')).toHaveAttribute('data-state', 'ready');
});

test('Retry turns a mistake into a puzzle', async ({ page }) => {
  await foolsMate(page);
  await page.getByTestId('btn-review').click();
  const id = page.url().split('/review/')[1];
  await page.goto(`/#/review/${id}?engine=fast`);
  await expect(page.getByTestId('review-summary')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('rv-move-3').click();
  await page.getByTestId('btn-retry').click();
  await expect(page.getByTestId('retry-feedback')).toContainText('Find a better move for White');
  await move(page, 'b1', 'c3');
  await expect(page.getByTestId('retry-feedback')).toContainText('keeps the game on track', { timeout: 15_000 });
  await page.getByTestId('btn-retry-done').click();
  await expect(page.getByTestId('review-current')).toContainText('Blunder');
});

test('arrow keys step through the moves; the games list links to the review', async ({ page }) => {
  await foolsMate(page);
  await page.getByTestId('btn-close-result').click();
  await page.goto('/#/games');
  const row = page.locator('[data-testid^="game-"].game-row').first();
  await expect(row).toContainText('0-1');
  await row.click();
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('review-panel')).toHaveAttribute('data-ply', /\d+/);
  await page.getByTestId('rv-first').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('review-panel')).toHaveAttribute('data-ply', '1');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('review-panel')).toHaveAttribute('data-ply', '2');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('review-panel')).toHaveAttribute('data-ply', '1');
});

test('an unknown game id says so', async ({ page }) => {
  await page.goto('/#/review/zzzzzzzz');
  await expect(page.getByText('Game not found')).toBeVisible();
});
