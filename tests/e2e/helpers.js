import { test as base, expect } from '@playwright/test';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Every test fails on an uncaught page error or a console error.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // A rejected sign-in or a missing session is an expected API answer (401/409/429), which
      // Chrome still logs as a failed resource load.
      if (/Failed to load resource/.test(msg.text()) && /\/api\//.test(msg.location()?.url ?? '')) return;
      errors.push(`console: ${msg.text()}`);
    });
    await use(page);
    expect(errors, 'page/console errors').toEqual([]);
  },
});
export { expect };

export async function openLocal(page, fen) {
  await page.goto(fen ? `/#/play/local?fen=${encodeURIComponent(fen)}` : '/#/play/local');
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
}

export const fenOf = (page) => page.getByTestId('game').getAttribute('data-fen');

export async function expectFen(page, fen) {
  await expect(page.getByTestId('game')).toHaveAttribute('data-fen', fen);
}

// Clicks the centre of a board square (pieces and markers ignore pointer events).
export async function clickSquare(page, square) {
  const box = await page.locator(`.board rect[data-square="${square}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Opens the settings dialog and waits for its entry animation to finish.
export async function openSettings(page) {
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.waitForTimeout(250);
}

export async function move(page, from, to) {
  await clickSquare(page, from);
  await clickSquare(page, to);
  await page.waitForTimeout(250); // let the piece animation finish

}

// Accounts: test runs keep emails in memory (MAIL=dry) and expose them at /api/_test/outbox.
export const PW = 'correct horse battery';
export const uniqueName = (prefix = 'u') => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

// The newest 6-digit code emailed to an address (waiting for one different from `previous`).
export async function emailedCode(page, email, { previous = null } = {}) {
  for (let i = 0; i < 60; i++) {
    const r = await page.request.get(`/api/_test/outbox?to=${encodeURIComponent(email)}`);
    const { emails } = await r.json();
    const code = emails.length ? /\b(\d{6})\b/.exec(emails.at(-1).subject)?.[1] : null;
    if (code && code !== previous) return code;
    await page.waitForTimeout(100);
  }
  throw new Error(`no email with a code for ${email}`);
}

// Create an account with an email and a name, confirming the emailed code (and choosing a password).
export async function signUp(page, name = uniqueName(), { password = PW, path = '/#/profile' } = {}) {
  const email = `${name.toLowerCase()}@example.com`;
  await page.goto(path);
  await page.getByTestId('btn-create-account').click();
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-name').fill(name);
  await page.getByTestId('btn-signup-submit').click();
  await expect(page.getByTestId('account-info')).toContainText(email);
  await page.getByTestId('account-code').fill(await emailedCode(page, email));
  if (password) await page.getByTestId('account-new-password').fill(password); // chosen with the code
  await page.getByTestId('btn-code-submit').click();
  await expect(page.getByTestId('account-user')).toContainText(name);
  return { name, email };
}

// Sign in with an email (or username) and password.
export async function signInWithPassword(page, who, password = PW) {
  await page.getByTestId('btn-use-password').click();
  await page.getByTestId('account-username').fill(who);
  await page.getByTestId('account-password').fill(password);
  await page.getByTestId('btn-account-submit').click();
}
