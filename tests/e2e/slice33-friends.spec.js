import { test, expect, signUp } from './helpers.js';

test('guests are invited to sign in', async ({ page }) => {
  await page.goto('/#/play');
  await page.getByTestId('opt-friends').click();
  await expect(page.getByTestId('friends-signin')).toBeVisible();
});

test('two players become friends with a friend code', async ({ page, browser }) => {
  const ana = await signUp(page);
  await page.goto('/#/friends');
  const code = await page.getByTestId('friend-code').textContent();
  expect(code).toMatch(/^OC-[A-Z2-9]{6}$/);

  const other = await browser.newContext();
  const page2 = await other.newPage();
  const ben = await signUp(page2);
  await page2.goto('/#/friends');
  await page2.getByTestId('friend-input').fill(code.toLowerCase());
  await page2.getByTestId('btn-add-friend').click();
  await expect(page2.getByTestId(`friend-${ana.name}`)).toBeVisible(); // waiting for an answer
  await expect(page2.getByTestId('friend-sent')).toContainText(ana.name);

  await page.reload();
  await page.getByTestId(`accept-${ben.name}`).click();
  await expect(page.getByTestId('friend-list')).toContainText(ben.name);
  await page2.reload();
  await expect(page2.getByTestId('friend-list')).toContainText(ana.name);

  // Adding by name works too, and a wrong one is explained.
  await page2.getByTestId('friend-input').fill('nobody_at_all');
  await page2.getByTestId('btn-add-friend').click();
  await expect(page2.getByTestId('friends-error')).toHaveText('No player with that code or name.');
  await other.close();
});
