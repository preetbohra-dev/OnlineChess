import { test, expect, move } from './helpers.js';

async function openLesson(page, id) {
  await page.goto(`/#/learn/${id}`);
  await expect(page.getByTestId('lesson')).toBeVisible();
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
}

test('Training → Lessons shows the Novice and Amateur tracks', async ({ page }) => {
  await page.goto('/#/train');
  await page.getByTestId('opt-lessons').click();
  await expect(page.getByTestId('track-novice')).toBeVisible();
  await expect(page.getByTestId('track-amateur')).toBeVisible();
  await expect(page.getByTestId('lesson-novice-castling')).toBeVisible();
});

test('a read lesson steps through to the end', async ({ page }) => {
  await openLesson(page, 'novice-board');
  await expect(page.getByTestId('lesson-text')).toContainText('8×8');
  await page.getByTestId('btn-next').click();
  await page.getByTestId('btn-next').click();
  await expect(page.getByTestId('btn-next-lesson')).toBeVisible();
  await page.getByTestId('btn-prev').click();
  await expect(page.getByTestId('btn-next')).toBeVisible();
});

test('a puzzle: wrong move is explained, right moves get replies, then solved and remembered', async ({ page }) => {
  await openLesson(page, 'amateur-knight-fork');
  await move(page, 'd5', 'b6');
  await expect(page.getByTestId('lesson-feedback')).toContainText('forcing move');
  await move(page, 'd5', 'c7');
  await expect(page.getByTestId('lesson-feedback')).toContainText('Correct');
  await page.waitForTimeout(700); // the scripted reply
  await move(page, 'c7', 'a8');
  await expect(page.getByTestId('lesson-feedback')).toContainText('fork');
  await expect(page.getByTestId('btn-next-lesson')).toBeVisible();
  await page.goto('/#/learn');
  await expect(page.getByTestId('lesson-amateur-knight-fork')).toHaveClass(/done/);
});

test('hints show text and highlight the piece to move', async ({ page }) => {
  await openLesson(page, 'novice-back-rank');
  await page.getByTestId('btn-lesson-hint').click();
  await expect(page.getByTestId('lesson-hint')).toBeVisible();
  await expect(page.locator('.marker-hint')).toHaveCount(1);
});

test('stalemate is explained in the mate-don\'t-stalemate puzzle', async ({ page }) => {
  await openLesson(page, 'novice-stalemate');
  await move(page, 'b1', 'b6');
  await expect(page.getByTestId('lesson-feedback')).toContainText('Stalemate');
  await move(page, 'b1', 'b7');
  await expect(page.getByTestId('lesson-feedback')).toContainText('Checkmate');
});

test('the rules handbook covers every rule', async ({ page }) => {
  await page.goto('/#/train');
  await page.getByTestId('opt-rules').click();
  for (const id of ['setup', 'moves', 'castling', 'en-passant', 'promotion', 'check', 'draws', 'time', 'resign']) {
    await expect(page.getByTestId(`rule-${id}`)).toBeAttached();
  }
  await expect(page.getByTestId('rule-draws')).toContainText('fifty-move');
});

test('leaving or restarting a puzzle right after a correct move causes no errors', async ({ page }) => {
  await openLesson(page, 'amateur-knight-fork');
  await move(page, 'd5', 'c7');
  await page.getByTestId('btn-lesson-reset').click();
  await expect(page.getByTestId('lesson-feedback')).not.toContainText('Correct');
  await page.waitForTimeout(600);
  await move(page, 'd5', 'c7');
  await page.goto('/#/learn');
  await page.waitForTimeout(600);
  await expect(page.getByTestId('track-novice')).toBeVisible();
});

test('puzzle panels never print "null", and hints escalate to showing the move', async ({ page }) => {
  await openLesson(page, 'amateur-pin');
  await expect(page.locator('.lesson-panel')).not.toContainText('null');
  const hint = page.getByTestId('btn-lesson-hint');
  await hint.click();
  await expect(page.getByTestId('lesson-hint')).toContainText('pawn');
  await expect(hint).toBeFocused();
  await hint.click();
  await expect(page.getByTestId('lesson-hint')).toContainText('arrow');
  await expect(hint).toBeDisabled();
});

test('a wrong move is explained, not just rejected', async ({ page }) => {
  await openLesson(page, 'novice-back-rank');
  await move(page, 'a1', 'a2');
  await expect(page.getByTestId('lesson-feedback')).toContainText('check');
});

test('#/rules?section= opens at that rule', async ({ page }) => {
  await page.goto('/#/rules?section=draws');
  await expect(page.getByTestId('rule-draws')).toBeInViewport();
});
