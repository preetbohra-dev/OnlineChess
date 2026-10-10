import { test, expect, move, openLocal } from './helpers.js';

async function openOpening(page, id, query = '') {
  await page.goto(`/#/openings/${id}${query}`);
  await expect(page.getByTestId('opening')).toBeVisible();
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
}

test('Training → Openings lists 15 openings for White and Black', async ({ page }) => {
  await page.goto('/#/train');
  await page.getByTestId('opt-openings').click();
  await expect(page.getByTestId('openings-w')).toBeVisible();
  await expect(page.getByTestId('openings-b')).toBeVisible();
  await expect(page.locator('[data-testid^="opening-"].lesson-card')).toHaveCount(15);
  await expect(page.getByTestId('opening-sicilian-najdorf')).toContainText('B90');
});

test('Learn mode walks through the line with a note for every move', async ({ page }) => {
  await openOpening(page, 'italian');
  await expect(page.getByTestId('opening-text')).toContainText('Quick development');
  await page.getByTestId('btn-next').click();
  await expect(page.getByTestId('opening-text')).toContainText('1. e4');
  await expect(page.getByTestId('opening-text')).toContainText('centre');
  await page.getByTestId('btn-next').click();
  await expect(page.getByTestId('opening-text')).toContainText('1... e5');
  await page.getByTestId('btn-prev').click();
  await expect(page.getByTestId('opening-text')).toContainText('1. e4');
});

test('Practice: a wrong move is refused with help, the right line completes and is remembered', async ({ page }) => {
  await openOpening(page, 'italian', '?mode=practice');
  await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-selected', 'true');
  await move(page, 'd2', 'd4');
  await expect(page.getByTestId('lesson-feedback')).toContainText('not the Italian Game main line');
  await expect(page.locator('.marker-hint')).toHaveCount(1);
  const line = [['e2', 'e4'], ['g1', 'f3'], ['f1', 'c4'], ['c2', 'c3'], ['d2', 'd3']];
  for (const [from, to] of line) {
    await move(page, from, to);
    await expect(page.getByTestId('lesson-feedback')).not.toContainText('not the');
    await page.waitForTimeout(600); // the book reply
  }
  // Castling: king two squares.
  await move(page, 'e1', 'g1');
  await expect(page.getByTestId('opening-panel')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('lesson-feedback')).toContainText('1 mistake');
  await expect(page.getByTestId('btn-play-it-out')).toBeVisible();
  await page.goto('/#/openings');
  await expect(page.getByTestId('opening-italian')).toHaveClass(/done/);
});

test('Practice as Black: White opens automatically', async ({ page }) => {
  await openOpening(page, 'slav', '?mode=practice');
  await expect(page.getByTestId('lesson-feedback')).toContainText('White opened with d4');
  await move(page, 'd7', 'd5');
  await expect(page.getByTestId('lesson-feedback')).toContainText('d5');
});

test('two misses show the book move as an arrow', async ({ page }) => {
  await openOpening(page, 'london', '?mode=practice');
  await move(page, 'e2', 'e4');
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('lesson-feedback')).toContainText('arrow');
});

test('the game screen names the opening and links to the trainer at the end', async ({ page }) => {
  await openLocal(page);
  await expect(page.getByTestId('opening-name')).toBeHidden();
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('opening-name')).toContainText('King\'s Pawn');
  await move(page, 'c7', 'c6');
  await expect(page.getByTestId('opening-name')).toContainText('B10 · Caro-Kann Defence');
  await expect(page.getByTestId('opening-learn')).toHaveCount(0);
  await page.getByTestId('btn-resign').click();
  await page.getByTestId('btn-confirm').click();
  await page.getByTestId('btn-close-result').click();
  await expect(page.getByTestId('opening-learn')).toHaveAttribute('href', '#/openings/caro-kann');
});
