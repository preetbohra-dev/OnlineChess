import { test, expect, PW, uniqueName, emailedCode, signUp, signInWithPassword } from './helpers.js';

test('create an account with an email: guest progress moves into it and syncs to a second browser', async ({ page, browser }) => {
  // Some guest progress first.
  await page.goto('/#/learn/novice-board');
  for (let i = 0; i < 2; i++) await page.getByTestId('btn-next').click();
  const { email } = await signUp(page);
  await expect(page.getByTestId('account-synced')).toContainText('Last synced');
  await expect(page.getByTestId('account-email-line')).toContainText(email);
  await expect(page.getByTestId('reset-signed-in')).toBeVisible();

  // A different browser (another device): sign in with the email and password, get the progress.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto('/#/profile');
  await signInWithPassword(page2, email.toUpperCase());
  await expect(page2.getByTestId('account-synced')).toContainText('Last synced');
  await page2.goto('/#/learn');
  await expect(page2.getByTestId('lesson-novice-board')).toHaveClass(/done/);
  await page2.goto('/#/');
  await page2.goto('/#/profile');
  await expect(page2.getByTestId('xp')).toContainText('25 XP');
  await other.close();
});

test('no password needed: an emailed code signs in (and signs up), then a name can be chosen', async ({ page }) => {
  const email = `${uniqueName('c')}@example.com`;
  await page.goto('/#/profile');
  await page.getByTestId('account-email').fill(email);
  await page.getByTestId('btn-email-code').click();
  await expect(page.getByTestId('account-info')).toContainText(`code to ${email}`);
  await page.getByTestId('account-code').fill('000000' === (await emailedCode(page, email)) ? '111111' : '000000');
  await page.getByTestId('btn-code-submit').click();
  await expect(page.getByTestId('account-error')).toContainText('wrong or has expired');
  await page.getByTestId('account-code').fill(await emailedCode(page, email));
  await page.getByTestId('btn-code-submit').click();
  // A new account gets a suggested name and the chance to pick one.
  const name = uniqueName('n');
  await page.getByTestId('rename-input').fill(name);
  await page.getByTestId('btn-rename').click();
  await expect(page.getByTestId('account-user')).toContainText(name);
  await expect(page.getByTestId('btn-password-open')).toHaveText('Set a password');
});

test('forgot password: an emailed code and a new password; the old one stops working', async ({ page }) => {
  const { email } = await signUp(page);
  const first = await emailedCode(page, email);
  await page.getByTestId('btn-logout').click();
  await page.getByTestId('btn-use-password').click();
  await page.getByTestId('btn-forgot').click();
  await page.getByTestId('account-email').fill(email);
  await page.getByTestId('btn-email-code').click();
  await page.getByTestId('account-code').fill(await emailedCode(page, email, { previous: first }));
  await page.getByTestId('account-new-password').fill('my new long password');
  await page.getByTestId('btn-code-submit').click();
  await expect(page.getByTestId('account-user')).toBeVisible();
  await page.getByTestId('btn-logout').click();
  await signInWithPassword(page, email, PW);
  await expect(page.getByTestId('account-error')).toHaveText('Wrong email, username or password.');
  await page.getByTestId('account-password').fill('my new long password');
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-user')).toBeVisible();
});

test('sign-up mistakes are explained; sign out keeps this device\'s progress', async ({ page }) => {
  await page.goto('/#/profile');
  await page.getByTestId('btn-create-account').click();
  await page.getByTestId('signup-email').fill(`${uniqueName('x')}@example.com`);
  await page.getByTestId('signup-name').fill('admin');
  await page.getByTestId('btn-signup-submit').click();
  await expect(page.getByTestId('account-error')).toHaveText('Please choose a different name.');
  const name = uniqueName();
  await expect(page.getByTestId('signup-email')).not.toHaveValue('', { timeout: 2000 }); // kept after the error
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('btn-signup-submit').click();
  await page.getByTestId('account-new-password').fill('short');
  await page.getByTestId('account-code').fill('123456');
  await page.getByTestId('btn-code-submit').click();
  await expect(page.getByTestId('account-new-password')).toHaveJSProperty('validity.valid', false);
});

test('the online name defaults to the account name', async ({ page }) => {
  const { name } = await signUp(page);
  await page.goto('/#/play/online/new');
  await expect(page.getByTestId('online-name')).toHaveValue(name);
});

test('the emailed link: opening it changes nothing until the button, and the token leaves the address bar', async ({ page }) => {
  const email = `${uniqueName('l')}@example.com`;
  await page.goto('/#/profile');
  await page.getByTestId('account-email').fill(email);
  await page.getByTestId('btn-email-code').click();
  await emailedCode(page, email);
  const { emails } = await (await page.request.get(`/api/_test/outbox?to=${encodeURIComponent(email)}`)).json();
  const link = /(http\S+#\/auth\?t=[\w-]+)/.exec(emails.at(-1).text)[1];
  await page.goto(link);
  await expect(page.getByTestId('btn-link-signin')).toBeVisible();
  expect(page.url()).not.toContain('?t=');
  await page.reload(); // nothing was used: still the same page, now without the token
  await expect(page.getByTestId('auth-link')).toContainText('not complete');
  await page.goto(link);
  await page.getByTestId('btn-link-signin').click();
  await expect(page.getByTestId('rename-input')).toBeVisible(); // signed in, a new account
});
