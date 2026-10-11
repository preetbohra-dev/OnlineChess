import { test, expect, move, fenOf } from './helpers.js';

// Host creates a room as White; a second browser context joins through the invite link.
async function openRoom(browser, page, { tc = 'tc-none' } = {}) {
  await page.goto('/#/play/online/new');
  await page.getByTestId('online-name').fill('Ann');
  await page.getByTestId('color-w').check({ force: true });
  await page.getByTestId(tc).check({ force: true });
  await page.getByTestId('btn-create-room').click();
  const link = await page.getByTestId('room-link').inputValue();
  expect(link).toMatch(/#\/room\/[A-HJ-NP-Z2-9]{6}$/);

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const errors = [];
  guest.on('pageerror', (e) => errors.push(e.message));
  guest.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await guest.goto(link);
  await guest.getByTestId('online-name').fill('Bob');
  await guest.getByTestId('btn-join').click();
  await expect(guest.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('status-banner')).not.toContainText('waiting for your opponent');
  return { guest, guestContext, link, errors };
}

test('Normal Mode → Online opens the room setup', async ({ page }) => {
  await page.goto('/#/play');
  await page.getByTestId('opt-online').click();
  await expect(page.getByTestId('btn-create-room')).toBeVisible();
});

test('two browsers play through a share link and moves sync both ways', async ({ browser, page }) => {
  const { guest, guestContext, errors } = await openRoom(browser, page);
  await expect(guest.getByTestId('game')).toHaveAttribute('data-orientation', 'b');
  await move(page, 'e2', 'e4');
  await expect(guest.getByTestId('move-item')).toHaveText(['e4']);
  await move(guest, 'e7', 'e5');
  await expect(page.getByTestId('move-item')).toHaveText(['e4', 'e5']);
  expect(await fenOf(guest)).toBe(await fenOf(page));
  expect(errors).toEqual([]);
  await guestContext.close();
});

test('you cannot move out of turn or move the opponent\'s pieces', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  await move(guest, 'e7', 'e5');
  await expect(guest.getByTestId('move-item')).toHaveCount(0);
  await move(page, 'e7', 'e5');
  await expect(page.getByTestId('move-item')).toHaveCount(0);
  await guestContext.close();
});

test('resign ends the game for both, and a rematch swaps colours', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  await page.getByTestId('btn-resign').click();
  await page.getByTestId('btn-confirm').click();
  await expect(guest.getByTestId('game-reason')).toHaveText('Black wins — White resigned');
  await expect(guest.locator('.modal-title')).toHaveText('You win!');
  await guest.getByTestId('btn-close-result').click();
  await page.getByTestId('btn-close-result').click();
  await page.getByTestId('btn-rematch').click();
  await guest.getByTestId('btn-rematch').click();
  await expect(page.getByTestId('game')).toHaveAttribute('data-status', 'playing');
  await expect(page.getByTestId('game')).toHaveAttribute('data-orientation', 'w');
  await expect.poll(async () => (await page.getByTestId('status-banner').textContent())).toContain('White to move');
  await move(guest, 'e2', 'e4');
  await expect(page.getByTestId('move-item')).toHaveText(['e4'], { timeout: 5_000 });
  await guestContext.close();
});

test('draw offer accepted by the opponent', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  await page.getByTestId('btn-offer-draw').click();
  await guest.getByTestId('btn-accept-draw').click();
  await expect(page.getByTestId('game-reason')).toHaveText('Draw by agreement');
  await guestContext.close();
});

test('reloading resumes the same seat and position', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  await move(page, 'd2', 'd4');
  await expect(guest.getByTestId('move-item')).toHaveText(['d4']);
  await guest.reload();
  await expect(guest.getByTestId('game')).toHaveAttribute('data-orientation', 'b');
  await expect(guest.getByTestId('move-item')).toHaveText(['d4']);
  await move(guest, 'd7', 'd5');
  await expect(page.getByTestId('move-item')).toHaveText(['d4', 'd5']);
  await guestContext.close();
});

test('emotes appear for the opponent', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  await page.getByTestId('emote-gl').click();
  await expect(guest.locator('[data-kind="emote"]')).toContainText('Good luck!');
  await guestContext.close();
});

test('a raw illegal move sent over the socket is refused by the server', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  const before = await fenOf(page);
  // Bypass the UI entirely: open a second socket in the guest page and try to cheat.
  const reply = await guest.evaluate(() => new Promise((resolve) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'move', from: 'e2', to: 'e5', ply: 0 }));
    ws.onmessage = (e) => { resolve(JSON.parse(e.data)); ws.close(); };
    ws.onclose = () => resolve({ type: 'closed' });
    setTimeout(() => resolve({ type: 'timeout' }), 5000);
  }));
  expect(reply).toEqual({ type: 'error', code: 'not_in_room' });
  expect(await fenOf(page)).toBe(before);
  await guestContext.close();
});

test('names are shown as text, never as HTML', async ({ browser, page }) => {
  await page.goto('/#/play/online/new');
  await page.getByTestId('online-name').fill('<img src=x onerror=alert(1)>');
  await page.getByTestId('btn-create-room').click();
  await expect(page.getByTestId('btn-create-room')).toBeVisible(); // rejected by validation, still on the form
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test('timed online game shows server clocks', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page, { tc: 'tc-3+2' });
  await expect(page.getByTestId('clock-w')).toHaveText('3:00');
  await move(page, 'e2', 'e4');
  await expect(guest.getByTestId('clock-b')).toHaveText(/^2:5\d|3:00$/);
  await guestContext.close();
});

test('a room that does not exist is reported before asking for a name', async ({ page }) => {
  await page.goto('/#/room/ZZZZZZ');
  await expect(page.getByTestId('room-status')).toContainText('does not exist');
  await expect(page.getByTestId('btn-join')).toHaveCount(0);
});

test('#/play/online opens the room setup', async ({ page }) => {
  await page.goto('/#/play/online');
  await expect(page.getByTestId('btn-create-room')).toBeVisible();
});

test('the offerer hears when a draw is declined', async ({ browser, page }) => {
  const { guest, guestContext } = await openRoom(browser, page);
  await page.getByTestId('btn-offer-draw').click();
  await guest.getByTestId('btn-decline-draw').click();
  await expect(page.locator('[data-kind="system"]').last()).toContainText('Your draw offer was declined.');
  await guestContext.close();
});

test('opening the same seat in a second tab tells the first tab', async ({ browser, page }) => {
  const { guest, guestContext, link } = await openRoom(browser, page);
  // A duplicated tab inherits sessionStorage (and so the seat token); copy it like the browser does.
  const room = link.split('/room/')[1];
  const token = await guest.evaluate((r) => sessionStorage.getItem(`oc.room.${r}`), room);
  const secondTab = await guestContext.newPage();
  await secondTab.goto('/');
  await secondTab.evaluate(([r, t]) => sessionStorage.setItem(`oc.room.${r}`, t), [room, token]);
  await secondTab.goto(link);
  await expect(secondTab.getByTestId('game')).toBeVisible();
  await expect(guest.getByTestId('room-status')).toContainText('open in another tab');
  await guestContext.close();
});
