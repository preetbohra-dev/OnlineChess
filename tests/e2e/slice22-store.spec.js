import { test, expect, signUp, signInWithPassword } from './helpers.js';

const PW = 'correct horse battery';
const unique = () => `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);


test('the privacy policy and support page are linked from home and settings', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('footer-privacy').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await expect(page.locator('main')).toContainText('Delete account');
  await expect(page.locator('a[href="mailto:preetbohra30@gmail.com"]')).toBeVisible();
  await page.goto('/#/');
  await page.getByTestId('footer-support').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Support');
  await page.goto('/#/');
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('link-privacy')).toHaveAttribute('href', '/privacy.html');
  await expect(page.getByTestId('link-support')).toHaveAttribute('href', '/support.html');
});

test('a player deletes their account with their password, and can clear this device too', async ({ page }) => {
  const name = unique();
  await page.goto('/#/learn/novice-board');
  await page.getByTestId('btn-next').click();
  await signUp(page, name);

  await page.getByTestId('btn-delete-account').click();
  const dialog = page.getByTestId('delete-account-dialog');
  await expect(dialog).toContainText(name);
  await page.getByTestId('delete-password').fill('not my password');
  await page.getByTestId('btn-confirm-delete').click();
  await expect(page.getByTestId('delete-error')).toHaveText('Wrong password.');
  await expect(dialog).toBeVisible();

  await page.getByTestId('delete-password').fill(PW);
  await page.getByTestId('delete-clear-device').check();
  await page.getByTestId('btn-confirm-delete').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('account-email')).toBeVisible();
  await expect(page.getByTestId('account-user')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('oc.v1.lessons.completed'))).toBeNull();

  // The account is gone on the server too.
  await signInWithPassword(page, name);
  await expect(page.getByTestId('account-error')).toHaveText('Wrong email, username or password.');
});

test('offensive names are refused at sign-up', async ({ page }) => {
  await page.goto('/#/profile');
  await page.getByTestId('btn-create-account').click();
  await page.getByTestId('signup-email').fill('rude@example.com');
  await page.getByTestId('signup-name').fill('sh1t_head');
  await page.getByTestId('btn-signup-submit').click();
  await expect(page.getByTestId('account-error')).toHaveText('Please choose a different name.');
});

test('signed-in players can report a name on the leaderboard, but not their own', async ({ page, browser }) => {
  const other = unique();
  const ctx = await browser.newContext();
  await signUp(await ctx.newPage(), other);
  await ctx.close();

  const me = unique();
  await signUp(page, me);
  // The public table is cached on the server; show a fixed one so the test does not wait for it.
  await page.route('**/api/challenge/leaderboard', (route) => route.fulfill({
    json: { week: '2026-10-12', top: [{ rank: 1, username: other, score: 20 }, { rank: 2, username: me, score: 10 }], me: { username: me, rank: 2, score: 10 }, lastWeek: [] },
  }));
  await page.goto('/#/weekly');
  await expect(page.getByTestId(`report-${me}`)).toHaveCount(0);
  await page.getByTestId(`report-${other}`).click();
  await page.getByTestId('btn-confirm').click();
  await expect(page.getByTestId(`report-${other}`)).toHaveText('Reported');
  await expect(page.getByTestId(`report-${other}`)).toBeDisabled();
});
