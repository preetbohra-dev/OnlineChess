import { test, expect, move } from './helpers.js';
import { weeklySet, challengeWeek, loadPuzzleLibrary } from '../../server/challenge.js';

const LIB = loadPuzzleLibrary(new URL('../fixtures/weekly-puzzles.json', import.meta.url).pathname);
const PW = 'correct horse battery';

async function signUp(page) {
  const name = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.slice(0, 20);
  await page.goto('/#/profile');
  await page.getByTestId('btn-account-mode').click();
  await page.getByTestId('account-username').fill(name);
  await page.getByTestId('account-password').fill(PW);
  await page.getByTestId('btn-account-submit').click();
  await expect(page.getByTestId('account-user')).toContainText(name);
  return name;
}

test('guests see the leaderboard and an invitation to sign in', async ({ page }) => {
  await page.goto('/#/train');
  await page.getByTestId('opt-weekly').click();
  await expect(page.getByTestId('weekly-signin')).toBeVisible();
  await expect(page.getByTestId('leaderboard')).toBeVisible();
});

test('a puzzle: one attempt, checked by the server, scored on the leaderboard', async ({ page }) => {
  await signUp(page);
  await page.goto('/#/weekly');
  await expect(page.getByTestId('weekly-summary')).toContainText('0/10 puzzles solved');
  const set = weeklySet(challengeWeek(), LIB);
  await page.getByTestId('wpuzzle-0').click();
  await expect(page.getByTestId('wpuzzle-feedback')).toContainText('you get one try');
  const uci = set.puzzles[0].answer;
  await move(page, uci.slice(0, 2), uci.slice(2, 4));
  if (uci.length === 5) await page.getByTestId(`promo-${uci[4]}`).click();
  await expect(page.getByTestId('wpuzzle-feedback')).toContainText('+10 points');
  await page.goto('/#/');
  await page.goto('/#/weekly');
  // Your own rank is live; the public table is cached for a few seconds.
  await expect(page.getByTestId('my-rank')).toHaveText(/You are #\d+ with 10 points\./);
  await expect(page.getByTestId('weekly-summary')).toContainText('1/10 puzzles solved');
  await page.getByTestId('wpuzzle-0').click();
  await expect(page.getByTestId('wpuzzle-feedback')).toContainText('Right');
});

test('a challenge game opens against the right opponent; a resignation does not score', async ({ page }) => {
  await signUp(page);
  await page.goto('/#/weekly');
  await page.getByTestId('wplay-0').click();
  await expect(page).toHaveURL(/weekly=0&week=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('status-banner')).not.toContainText('waking up', { timeout: 15_000 });
  await page.getByTestId('btn-resign').click();
  await page.getByTestId('btn-confirm').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'only games that end on the board' })).toBeVisible();
});

test('without a connection the page says so instead of hanging', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/#/weekly');
  await expect(page.getByTestId('weekly-unavailable')).toContainText('offline');
});
