import { test, expect } from './helpers.js';

// Reminders need the service worker; the browser's push service is replaced by a stand-in,
// so nothing leaves the machine (the test server also runs push in dry-run mode).
test.use({ serviceWorkers: 'allow' });

const PW = 'correct horse battery';

test('a signed-in player turns daily reminders on and off', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    let current = null;
    const fake = (opts) => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-test',
      options: opts,
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-test', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { current = null; return true; },
    });
    PushManager.prototype.subscribe = async function subscribe(opts) { current = fake(opts); return current; };
    PushManager.prototype.getSubscription = async function getSubscription() { return current; };
    Notification.requestPermission = async () => 'granted';
  });
  await page.goto('/#/profile');
  await expect(page.getByTestId('reminders')).toHaveCount(0); // guests: no reminders
  await page.getByTestId('btn-account-mode').click();
  await page.getByTestId('account-username').fill(`r${Date.now().toString(36)}`.slice(0, 20));
  await page.getByTestId('account-password').fill(PW);
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('reminders')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByTestId('reminder-hour').selectOption('21');
  await page.getByTestId('btn-reminders').click();
  await expect(page.getByTestId('reminders-status')).toHaveText('Reminders are on for this browser.');
  await expect(page.getByTestId('btn-reminders')).toHaveText('Turn off');
  await page.getByTestId('btn-reminders').click();
  await expect(page.getByTestId('reminders-status')).toHaveText('Reminders are off.');
});
