import { test, expect } from './helpers.js';

test('a challenge link shows what the friend did and starts the same opponent', async ({ page }) => {
  await page.goto('/#/challenge?bot=grandmaster&moves=34&acc=92');
  await expect(page.getByTestId('challenge-text')).toHaveText('Your friend beat Magnus the Wizard (Grand Master) in 34 moves with 92% accuracy. Can you?');
  await page.getByTestId('btn-accept-challenge').click();
  await expect(page).toHaveURL(/#\/play\/bot\/new\?persona=grandmaster$/);
});

test('a Rush challenge and a broken link', async ({ page }) => {
  await page.goto('/#/challenge?rush=17');
  await expect(page.getByTestId('challenge-text')).toContainText('scored 17 in Puzzle Rush');
  await expect(page.getByTestId('btn-accept-challenge')).toHaveAttribute('href', '#/rush');
  await page.goto('/#/challenge?bot=hacker&moves=1');
  await expect(page.getByText('Challenge not found')).toBeVisible();
});

test('the share card is a 1200×630 PNG, and without a share sheet it downloads and copies the link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto('/#/');
  const info = await page.evaluate(async () => {
    const { drawShareCard } = await import('/js/ui/share.js');
    const blob = await drawShareCard({ fen: 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4', title: 'I beat Pip the Pawn in 4 moves!', lines: ['Novice', 'Can you?'] });
    const img = await createImageBitmap(blob);
    return { type: blob.type, size: blob.size, w: img.width, h: img.height };
  });
  expect(info).toMatchObject({ type: 'image/png', w: 1200, h: 630 });
  expect(info.size).toBeGreaterThan(5000);
  const download = page.waitForEvent('download');
  const mode = await page.evaluate(async () => {
    globalThis.__oc.forceDownload = true;
    const { prepareShare, sharePrepared } = await import('/js/ui/share.js');
    const prepared = prepareShare({ card: { fen: '8/8/8/8/8/8/8/K6k w - - 0 1', title: 't', lines: ['A very long line that would never fit on the card without shrinking or cutting it short at all'] }, text: 'I beat', url: 'https://x/#/challenge?rush=3', filename: 'card.png' });
    await prepared.ready;
    return sharePrepared(prepared);
  });
  expect(mode).toBe('downloaded');
  expect((await download).suggestedFilename()).toBe('card.png');
});
