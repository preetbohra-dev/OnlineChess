import { test, expect, move } from './helpers.js';

// These tests need the service worker (blocked for the rest of the suite).
test.use({ serviceWorkers: 'allow' });

async function installed(page) {
  await page.goto('/#/');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    return reg.active?.state;
  });
}

test('the app is installable: manifest, icons and a service worker', async ({ page }) => {
  await page.goto('/#/');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  await installed(page);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
});

test('offline: the app, lessons, puzzles and a game against the computer still work', async ({ page, context }) => {
  test.setTimeout(60_000);
  await installed(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.goto('/#/learn/novice-board');
  await expect(page.getByTestId('lesson-text')).toBeVisible();
  await page.goto('/#/puzzles');
  await expect(page.getByTestId('puzzle-panel')).toHaveAttribute('data-puzzle', /.+/);
  await page.goto('/#/play/bot?persona=novice&color=w&engine=fast&seed=1');
  await expect(page.getByTestId('status-banner')).not.toContainText('waking up', { timeout: 20_000 });
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('move-item')).toHaveCount(2, { timeout: 15_000 });
  await context.setOffline(false);
});
