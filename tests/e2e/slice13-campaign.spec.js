import { test, expect, openLocal, openSettings } from './helpers.js';

async function seedProfile(page, profile) {
  await page.goto('/#/');
  await page.evaluate((p) => localStorage.setItem('oc.v1.profile', JSON.stringify(p)), profile);
}

test('the campaign opens with Pip; beating Pip opens Rex and shows the stars', async ({ page }) => {
  await page.goto('/#/play');
  await page.getByTestId('opt-campaign').click();
  await expect(page.getByTestId('stop-novice')).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('stop-amateur')).toHaveAttribute('data-unlocked', 'false');
  await expect(page.getByTestId('campaign-total')).toContainText('0/15');

  await seedProfile(page, { xp: 40, campaign: { novice: { win: true, fast: true, clean: false } }, bots: { novice: { w: 1, d: 0, l: 0, streak: 1, best: 1 } } });
  await page.goto('/#/campaign');
  await expect(page.getByTestId('stop-amateur')).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('stars-novice')).toHaveAttribute('aria-label', /^2 of 3 stars: win, win in 40 moves/);
  await expect(page.getByTestId('campaign-total')).toContainText('2/15');
  await expect(page.getByTestId('play-amateur')).toHaveAttribute('href', '#/play/bot/new?persona=amateur');
  await page.goto('/#/');
  await expect(page.getByTestId('dash-campaign')).toContainText('2/15');
});

test('board themes unlock with rank and recolour every board', async ({ page }) => {
  await page.goto('/#/');
  await openSettings(page);
  const select = page.getByTestId('setting-boardTheme');
  await expect(select).toHaveValue('wood');
  await expect(select.locator('option[value="marble"]')).toHaveAttribute('disabled', '');
  await page.getByTestId('btn-settings-done').click();

  await seedProfile(page, { xp: 450 }); // Bishop
  await page.reload();
  await openSettings(page);
  await expect(page.getByTestId('setting-boardTheme').locator('option[value="marble"]')).not.toHaveAttribute('disabled', '');
  await page.getByTestId('setting-boardTheme').selectOption('marble');
  await expect(page.locator('html')).toHaveAttribute('data-board', 'marble');
  await page.getByTestId('setting-pieceSet').selectOption('standard');
  await page.getByTestId('btn-settings-done').click();
  await openLocal(page);
  await expect(page.locator('use.piece[href*="standard.svg"]').first()).toBeAttached();

  // A reset profile falls back to the free board.
  await seedProfile(page, { xp: 0 });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-board', 'wood');
});
