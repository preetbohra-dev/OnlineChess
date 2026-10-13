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

test('live: a friend request pops up at once, and friends see each other online and in a game', async ({ page, browser }) => {
  const ana = await signUp(page);
  await page.goto('/#/friends');
  const anaCode = await page.getByTestId('friend-code').textContent();

  const other = await browser.newContext();
  const page2 = await other.newPage();
  const ben = await signUp(page2);
  await page2.goto('/#/friends');
  await page2.getByTestId('friend-input').fill(anaCode);
  await page2.getByTestId('btn-add-friend').click();

  // Ana did not reload: the request arrives over the live channel.
  await expect(page.getByTestId('toast').filter({ hasText: `${ben.name} wants to be your friend` })).toBeVisible();
  await page.getByTestId(`accept-${ben.name}`).click();
  await expect(page.getByTestId(`presence-${ben.name}`)).toHaveText('Online');
  await expect(page2.getByTestId(`presence-${ana.name}`)).toHaveText('Online');

  // Ben opens a game: Ana sees it; Ben leaves: Ana sees that too.
  await page2.goto('/#/play/local');
  await expect(page.getByTestId(`presence-${ben.name}`)).toHaveText('In a game');
  await other.close();
  await expect(page.getByTestId(`presence-${ben.name}`)).toHaveText('Offline');

  // Hiding: Ana turns her status off.
  await page.getByTestId('show-presence').uncheck();
  await expect(page.getByTestId('toast').filter({ hasText: 'look offline' })).toBeVisible();
});

test('challenge a friend: they accept, and both land on the same board', async ({ page, browser }) => {
  const ana = await signUp(page);
  await page.goto('/#/friends');
  const anaCode = await page.getByTestId('friend-code').textContent();
  const other = await browser.newContext();
  const page2 = await other.newPage();
  const ben = await signUp(page2);
  await page2.goto('/#/friends');
  await page2.getByTestId('friend-input').fill(anaCode);
  await page2.getByTestId('btn-add-friend').click();
  await page.getByTestId(`accept-${ben.name}`).click();
  await expect(page.getByTestId(`presence-${ben.name}`)).toHaveText('Online');

  // Ana challenges Ben: 5 minutes, Ana plays White.
  await page.getByTestId(`challenge-${ben.name}`).click();
  await page.getByTestId('challenge-tc').selectOption('5+0');
  await page.getByTestId('challenge-color').selectOption('w');
  await page.getByTestId('btn-send-challenge').click();
  await expect(page.getByTestId('open-challenges')).toContainText('waiting for them');

  // Ben, on another page, is asked at once.
  await page2.goto('/#/train'); // moving around does not lose the challenge
  await expect(page2.getByTestId('incoming-challenge')).toContainText(`${ana.name} challenges you`);
  await expect(page2.getByTestId('incoming-challenge')).toContainText('5 min · you play Black');
  await page2.getByTestId('btn-accept-challenge').click();

  // Both are taken to the same game.
  await expect(page2).toHaveURL(/#\/room\/[A-Z2-9]{6}$/);
  await expect(page).toHaveURL(/#\/room\/[A-Z2-9]{6}$/);
  expect(new URL(page.url()).hash).toBe(new URL(page2.url()).hash);
  await expect(page.getByTestId('game')).toHaveAttribute('data-orientation', 'w');
  await expect(page2.getByTestId('game')).toHaveAttribute('data-orientation', 'b');
  await other.close();
});
