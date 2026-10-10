import { test, expect, START_FEN, openLocal, move, clickSquare, expectFen, fenOf } from './helpers.js';

test('home → Normal → Against Person → Same device opens a fresh game', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('mode-normal').click();
  await expect(page.getByTestId('opt-computer')).toBeVisible();
  await page.getByTestId('opt-local').click();
  await expectFen(page, START_FEN);
  await expect(page.getByTestId('status-banner')).toContainText('White to move');
});

test('click moves update the FEN and the move list', async ({ page }) => {
  await openLocal(page);
  await move(page, 'e2', 'e4');
  await move(page, 'e7', 'e5');
  const items = page.getByTestId('move-item');
  await expect(items).toHaveText(['e4', 'e5']);
  await expect(page.getByTestId('status-banner')).toContainText('White to move');
});

test('illegal moves are rejected', async ({ page }) => {
  await openLocal(page);
  await move(page, 'e2', 'e5');
  await expectFen(page, START_FEN);
  await move(page, 'e7', 'e5');
  await expectFen(page, START_FEN);
});

test('scholar\'s mate ends the game with a result modal', async ({ page }) => {
  await openLocal(page);
  for (const [f, t] of [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']]) await move(page, f, t);
  await expect(page.getByTestId('game-over-modal')).toBeVisible();
  await expect(page.getByTestId('game-result')).toHaveText('1-0');
  await expect(page.getByTestId('game-reason')).toHaveText('White wins by checkmate');
  await expect(page.getByTestId('game')).toHaveAttribute('data-status', 'over');
});

test('promotion asks which piece to take', async ({ page }) => {
  await openLocal(page, '8/P7/8/8/8/8/8/k6K w - - 0 1');
  await move(page, 'a7', 'a8');
  await page.getByTestId('promo-n').click();
  await expect.poll(() => fenOf(page)).toMatch(/^N7\//);
});

test('castling through check is refused, legal castling moves the rook', async ({ page }) => {
  const fen = 'r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1';
  await openLocal(page, fen);
  await move(page, 'e1', 'g1');
  await expectFen(page, fen);
  await move(page, 'e1', 'c1');
  await expect.poll(() => fenOf(page)).toMatch(/\/2KR3R b kq - 1 1$/);
});

test('en passant removes the passed pawn', async ({ page }) => {
  await openLocal(page, '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  await move(page, 'e5', 'd6');
  await expect.poll(() => fenOf(page)).toMatch(/^4k3\/8\/3P4\/8\//);
});

test('threefold repetition can be claimed but does not end the game by itself', async ({ page }) => {
  await openLocal(page);
  const claim = page.getByTestId('btn-claim-draw');
  for (let i = 0; i < 2; i++) {
    for (const [f, t] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) await move(page, f, t);
  }
  await expect(claim).toBeEnabled();
  await expect(page.getByTestId('game')).toHaveAttribute('data-status', 'playing');
  await claim.click();
  await expect(page.getByTestId('game-reason')).toHaveText('Draw by threefold repetition');
});

test('reviewing an earlier move blocks input until back to live', async ({ page }) => {
  await openLocal(page);
  await move(page, 'e2', 'e4');
  await move(page, 'e7', 'e5');
  await page.getByTestId('move-item').first().click();
  await expect(page.getByTestId('game')).toHaveAttribute('data-review', 'true');
  const live = await fenOf(page);
  await move(page, 'g1', 'f3');
  await expectFen(page, live);
  await page.getByTestId('btn-live').click();
  await expect(page.getByTestId('game')).toHaveAttribute('data-review', 'false');
  await move(page, 'g1', 'f3');
  await expect(page.getByTestId('move-item')).toHaveCount(3);
});

test('resigning asks for confirmation and ends the game', async ({ page }) => {
  await openLocal(page);
  await page.getByTestId('btn-resign').click();
  await page.getByTestId('btn-confirm').click();
  await expect(page.getByTestId('game-reason')).toHaveText('Black wins — White resigned');
});

test('a draw offer can be accepted by the other player', async ({ page }) => {
  await openLocal(page);
  await page.getByTestId('btn-offer-draw').click();
  await page.getByTestId('btn-accept-draw').click();
  await expect(page.getByTestId('game-reason')).toHaveText('Draw by agreement');
});

test('an invalid ?fen falls back to the start position', async ({ page }) => {
  await page.goto('/#/play/local?fen=not-a-fen');
  await expectFen(page, START_FEN);
  await expect(page.getByTestId('toast')).toContainText('Invalid FEN');
});

test('a FEN where the side not to move is in check is rejected', async ({ page }) => {
  await page.goto(`/#/play/local?fen=${encodeURIComponent('7k/8/5QK1/8/8/8/8/8 w - - 0 1')}`);
  await expectFen(page, START_FEN);
  await expect(page.getByTestId('toast')).toContainText('Invalid FEN');
});

test('Escape closes the game-over dialog', async ({ page }) => {
  await openLocal(page);
  await page.getByTestId('btn-offer-draw').click();
  await page.getByTestId('btn-accept-draw').click();
  await expect(page.getByTestId('game-over-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-over-modal')).toHaveCount(0);
});

test('leaving the game closes any open dialog', async ({ page }) => {
  await openLocal(page);
  await page.getByTestId('btn-resign').click();
  await expect(page.getByTestId('btn-confirm')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.getByTestId('mode-normal')).toBeVisible();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
});

test('game controls are visible without scrolling', async ({ page }) => {
  await openLocal(page);
  await expect(page.getByTestId('btn-resign')).toBeInViewport();
  await expect(page.getByTestId('status-banner')).toBeInViewport();
});

test('layout fits the viewport without horizontal scrolling', async ({ page }) => {
  await openLocal(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await clickSquare(page, 'd2');
  await clickSquare(page, 'd4');
  await expect(page.getByTestId('move-item')).toHaveText(['d4']);
});
