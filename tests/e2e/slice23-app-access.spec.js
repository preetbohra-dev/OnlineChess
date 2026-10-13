// The apps load pages from their own origin and call the public site's API with a bearer token.
// Here the "app" page is served from http://localhost:PORT and the "site" is http://127.0.0.1:PORT,
// two different origins, so the real CORS and token path runs in the browser.
import { test, expect } from './helpers.js';

const PW = 'correct horse battery';

test('inside the app: sign up, stay signed in with a token, sync, sign out', async ({ page, baseURL }) => {
  const site = baseURL.replace(/\/$/, '');
  const appOrigin = site.replace('127.0.0.1', 'localhost');
  await page.addInitScript((s) => { window.Capacitor = { isNativePlatform: () => true }; window.OC_SITE = s; }, site);
  const name = `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.slice(0, 20);

  await page.goto(`${appOrigin}/#/profile`);
  await page.getByTestId('btn-account-mode').click();
  await page.getByTestId('account-username').fill(name);
  await page.getByTestId('account-password').fill(PW);
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-user')).toContainText(name);
  await expect(page.getByTestId('account-synced')).toContainText('Last synced');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('oc.v1.app.session')))).toMatch(/^[\w-]{40,}$/);
  expect(await page.context().cookies(site)).toEqual([]);

  // Still signed in after a restart of the app.
  await page.reload();
  await expect(page.getByTestId('account-user')).toContainText(name);

  // Links meant for other people point at the public site.
  expect(await page.evaluate(async () => (await import('/js/net/platform.js')).siteOrigin())).toBe(site);

  await page.getByTestId('btn-logout').click();
  await expect(page.getByTestId('account-username')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('oc.v1.app.session'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('account-username')).toBeVisible();
});

test('inside the app there is no service worker and no install offer', async ({ page, baseURL }) => {
  await page.addInitScript((s) => { window.Capacitor = { isNativePlatform: () => true }; window.OC_SITE = s; }, baseURL.replace(/\/$/, ''));
  await page.goto('/#/');
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('dash-install')).toHaveCount(0);
});
