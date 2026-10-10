import { test, expect, move } from './helpers.js';

const QUEEN_BLUNDER = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

async function openCoach(page, params) {
  await page.goto(`/#/train/coach/play?${new URLSearchParams({ engine: 'fast', seed: '2', ...params })}`);
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await expect(page.getByTestId('status-banner')).not.toContainText('waking up', { timeout: 15_000 });
}

test('Training → Coached game → pick a level → play', async ({ page }) => {
  await page.goto('/#/train');
  await page.getByTestId('opt-coach').click();
  await page.getByTestId('level-novice').check({ force: true });
  await page.getByTestId('color-w').check({ force: true });
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('coach-panel')).toBeVisible();
  await expect(page.getByTestId('btn-hint')).toBeVisible();
});

test('every move gets a grade and an explanation', async ({ page }) => {
  await openCoach(page, { level: 'novice', color: 'w' });
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('coach-grade')).toContainText('e4', { timeout: 15_000 });
  await expect(page.locator('.coach-headline')).not.toBeEmpty();
});

test('a blunder is named, with the better move and the refutation drawn on the board', async ({ page }) => {
  await openCoach(page, { level: 'amateur', color: 'b', fen: QUEEN_BLUNDER });
  await move(page, 'd8', 'g5');
  await expect(page.getByTestId('coach-grade')).toContainText('Blunder', { timeout: 15_000 });
  await expect(page.locator('.coach-points li[data-kind="allowed"]')).toContainText('wins your queen');
  await expect(page.locator('.coach-points li[data-kind="better"]')).toContainText('Better was');
  await expect(page.locator('.arrow-success').first()).toBeAttached();
  await expect(page.locator('.arrow-danger').first()).toBeAttached();
});

test('novice feedback avoids numbers; grandmaster feedback shows evaluations', async ({ page }) => {
  await openCoach(page, { level: 'novice', color: 'b', fen: QUEEN_BLUNDER });
  await move(page, 'd8', 'g5');
  await expect(page.getByTestId('coach-grade')).toContainText('Blunder', { timeout: 15_000 });
  const noviceText = (await page.getByTestId('coach-panel').textContent()).replace(/[a-h][1-8]/g, '');
  expect(noviceText).not.toMatch(/[+-]\d\.\d/);
  await openCoach(page, { level: 'grandmaster', color: 'b', fen: QUEEN_BLUNDER });
  await move(page, 'd8', 'g5');
  await expect(page.getByTestId('coach-grade')).toContainText('Blunder', { timeout: 15_000 });
  await expect(page.getByTestId('coach-panel')).toContainText(/[+-]\d\.\d/);
  await expect(page.getByTestId('coach-panel')).toContainText('Main line:');
});

test('hint highlights a piece, then shows the move', async ({ page }) => {
  await openCoach(page, { level: 'amateur', color: 'w' });
  await page.getByTestId('btn-hint').click();
  await expect(page.locator('.marker-hint')).toHaveCount(1, { timeout: 10_000 });
  await page.getByTestId('btn-hint').click();
  await expect(page.locator('.arrow-info').first()).toBeAttached();
});

test('takeback undoes your move and the reply', async ({ page }) => {
  await openCoach(page, { level: 'amateur', color: 'w' });
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('move-item')).toHaveCount(2, { timeout: 15_000 });
  await page.getByTestId('btn-takeback').click();
  await expect(page.getByTestId('move-item')).toHaveCount(0);
  await expect(page.getByTestId('game')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/);
});

test('the end-of-game summary shows your accuracy', async ({ page }) => {
  await openCoach(page, { level: 'pro', color: 'w' });
  await move(page, 'd2', 'd4');
  await expect(page.getByTestId('coach-grade')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('btn-resign').click();
  await page.getByTestId('btn-confirm').click();
  await expect(page.getByTestId('coach-accuracy')).toHaveText(/^\d{1,3}%$/);
});

test('after a blunder the opponent waits: Try again restores the position', async ({ page }) => {
  await openCoach(page, { level: 'amateur', color: 'b', fen: QUEEN_BLUNDER });
  await move(page, 'd8', 'g5');
  await expect(page.getByTestId('btn-try-again')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('move-item')).toHaveCount(1); // the opponent has not replied
  await page.getByTestId('btn-try-again').click();
  await expect(page.getByTestId('game')).toHaveAttribute('data-fen', QUEEN_BLUNDER);
  await expect(page.getByTestId('btn-try-again')).toHaveCount(0);
});

test('after a blunder, Continue lets the opponent punish it', async ({ page }) => {
  await openCoach(page, { level: 'amateur', color: 'b', fen: QUEEN_BLUNDER });
  await move(page, 'd8', 'g5');
  await page.getByTestId('btn-continue').click({ timeout: 15_000 });
  await expect(page.getByTestId('move-item')).toHaveCount(2, { timeout: 15_000 });
});
