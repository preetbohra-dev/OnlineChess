import { test as base, expect } from '@playwright/test';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Every test fails on an uncaught page error or a console error.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
    await use(page);
    expect(errors, 'page/console errors').toEqual([]);
  },
});
export { expect };

export async function openLocal(page, fen) {
  await page.goto(fen ? `/#/play/local?fen=${encodeURIComponent(fen)}` : '/#/play/local');
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
}

export const fenOf = (page) => page.getByTestId('game').getAttribute('data-fen');

export async function expectFen(page, fen) {
  await expect(page.getByTestId('game')).toHaveAttribute('data-fen', fen);
}

// Clicks the centre of a board square (pieces and markers ignore pointer events).
export async function clickSquare(page, square) {
  const box = await page.locator(`.board rect[data-square="${square}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function move(page, from, to) {
  await clickSquare(page, from);
  await clickSquare(page, to);
  await page.waitForTimeout(250); // let the piece animation finish

}
