import { test, expect, move } from './helpers.js';

async function openLesson(page, id, query = '') {
  await page.goto(`/#/learn/${id}${query}`);
  await expect(page.getByTestId('lesson')).toBeVisible();
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
}


test('Lessons list Pro and Grand Master tracks with playout lessons', async ({ page }) => {
  await page.goto('/#/learn');
  await expect(page.getByTestId('track-pro')).toBeVisible();
  await expect(page.getByTestId('track-grandmaster')).toBeVisible();
  await expect(page.getByTestId('lesson-pro-lucena')).toContainText('vs Stockfish');
  await expect(page.getByTestId('lesson-gm-saavedra')).toContainText('Puzzle');
});

test('a playout: the player moves, Stockfish replies, the move budget counts down', async ({ page }) => {
  await openLesson(page, 'pro-queen-mate', '?engine=fast');
  await expect(page.getByTestId('playout-moves')).toHaveText('Moves left: 10 of 10');
  await expect.poll(() => page.evaluate(() => globalThis.__oc.engines)).toBe(1);
  await move(page, 'h1', 'h4');
  await expect(page.getByTestId('playout-moves')).toHaveText('Moves left: 9 of 10');
  await expect(page.getByTestId('lesson-feedback')).toHaveText('Your move.', { timeout: 15_000 });
  await expect(page.locator('.lesson-panel')).toHaveAttribute('data-state', 'playing');
  // White to move again, and the black king has left e5.
  await expect(page.locator('.lesson-panel')).toHaveAttribute('data-fen', / w /);
  await expect(page.locator('.lesson-panel')).not.toHaveAttribute('data-fen', /^8\/8\/8\/4k3\//);
});

test('playout hints: the second press highlights the engine\'s piece', async ({ page }) => {
  await openLesson(page, 'pro-rook-mate', '?engine=fast');
  await page.getByTestId('btn-lesson-hint').click();
  await expect(page.getByTestId('lesson-hint')).toContainText('Cut the king off');
  await page.getByTestId('btn-lesson-hint').click();
  await expect(page.locator('.marker-hint')).toHaveCount(1, { timeout: 15_000 });
});

test('playout restart resets the board and budget; leaving stops the engine', async ({ page }) => {
  await openLesson(page, 'pro-queen-mate', '?engine=fast');
  await move(page, 'h1', 'h4');
  await expect(page.getByTestId('lesson-feedback')).toHaveText('Your move.', { timeout: 15_000 });
  await page.getByTestId('btn-lesson-reset').click();
  await expect(page.getByTestId('playout-moves')).toHaveText('Moves left: 10 of 10');
  await expect(page.locator('.lesson-panel')).toHaveAttribute('data-fen', '8/8/8/4k3/8/8/8/4K2Q w - - 0 1');
  await page.goto('/#/learn');
  await expect.poll(() => page.evaluate(() => globalThis.__oc.engines)).toBe(0);
});

test('Philidor\'s legacy: the smothered mate solves the puzzle', async ({ page }) => {
  await openLesson(page, 'gm-philidors-legacy');
  for (const [from, to] of [['e5', 'f7'], ['f7', 'h6'], ['c4', 'g8'], ['h6', 'f7']]) {
    await move(page, from, to);
    await page.waitForTimeout(600); // the scripted reply
  }
  await expect(page.getByTestId('lesson-feedback')).toContainText('smothered');
});

test('Saavedra: promoting to a queen is rejected, the rook underpromotion is right', async ({ page }) => {
  await openLesson(page, 'gm-saavedra');
  const line = [['c6', 'c7'], ['b6', 'b5'], ['b5', 'b4'], ['b4', 'b3'], ['b3', 'c2']];
  for (const [from, to] of line) {
    await move(page, from, to);
    await expect(page.getByTestId('lesson-feedback')).toContainText('Correct');
    await page.waitForTimeout(600);
  }
  await move(page, 'c7', 'c8');
  await page.getByTestId('promo-q').click();
  await expect(page.getByTestId('lesson-feedback')).toContainText('stalemate');
  await move(page, 'c7', 'c8');
  await page.getByTestId('promo-r').click();
  await expect(page.getByTestId('lesson-feedback')).toContainText('Correct');
  await page.waitForTimeout(600);
  await move(page, 'c2', 'b3');
  await expect(page.getByTestId('lesson-feedback')).toContainText('c8=R');
});
