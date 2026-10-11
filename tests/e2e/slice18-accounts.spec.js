import { test, expect } from './helpers.js';

const PW = 'correct horse battery';
const unique = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

async function signUp(page, username) {
  await page.goto('/#/profile');
  await page.getByTestId('btn-account-mode').click();
  await page.getByTestId('account-username').fill(username);
  await page.getByTestId('account-password').fill(PW);
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-user')).toContainText(username);
}

test('create an account: guest progress moves into it and syncs to a second browser', async ({ page, browser }) => {
  const name = unique();
  // Some guest progress first.
  await page.goto('/#/learn/novice-board');
  for (let i = 0; i < 2; i++) await page.getByTestId('btn-next').click();
  await signUp(page, name);
  await expect(page.getByTestId('account-synced')).toContainText('Last synced');
  await expect(page.getByTestId('reset-signed-in')).toBeVisible();

  // A different browser (another device): sign in and get the progress.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto('/#/profile');
  await page2.getByTestId('account-username').fill(name);
  await page2.getByTestId('account-password').fill(PW);
  await page2.getByTestId('btn-account-submit').click();
  await expect(page2.getByTestId('account-synced')).toContainText('Last synced');
  await page2.goto('/#/learn');
  await expect(page2.getByTestId('lesson-novice-board')).toHaveClass(/done/);
  await page2.goto('/#/');
  await page2.goto('/#/profile');
  await expect(page2.getByTestId('xp')).toContainText('25 XP');
  await other.close();
});

test('wrong passwords and taken usernames are explained; sign out keeps this device\'s progress', async ({ page }) => {
  const name = unique();
  await signUp(page, name);
  await page.getByTestId('btn-logout').click();
  await expect(page.getByTestId('account-username')).toBeVisible();
  await page.getByTestId('account-username').fill(name);
  await page.getByTestId('account-password').fill('not my password');
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-error')).toHaveText('Wrong username or password.');
  await expect(page.getByTestId('account-username')).toHaveValue(name, { timeout: 2000 });
  await page.getByTestId('btn-account-mode').click();
  await page.getByTestId('account-username').fill(name);
  await page.getByTestId('account-password').fill(PW);
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-error')).toHaveText('That username is taken.');
  await page.getByTestId('account-password').fill('short');
  await page.getByTestId('account-username').fill(unique());
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-password')).toHaveJSProperty('validity.valid', false);
});

test('the online name defaults to the account name', async ({ page }) => {
  const name = unique();
  await signUp(page, name);
  await page.goto('/#/play/online/new');
  await expect(page.getByTestId('online-name')).toHaveValue(name);
});
