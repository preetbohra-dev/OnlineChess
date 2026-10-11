import { test, expect, move, openLocal } from './helpers.js';
import { makeCard } from '../../public/js/core/weakspots.js';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2'; // before 2.g4??

async function seedDeck(page, cards) {
  await page.goto('/#/');
  await page.evaluate((c) => localStorage.setItem('oc.v1.weakspots', JSON.stringify(c)), cards);
}

test('with no cards, the page explains where they come from', async ({ page }) => {
  await page.goto('/#/weak-spots');
  await expect(page.getByTestId('weakspots-empty')).toContainText('No weak spots yet');
});

test('a due card: the right move is praised and rescheduled, XP is paid', async ({ page }) => {
  await seedDeck(page, [makeCard({ fen: FEN, played: 'g4', answers: ['e2e4', 'd2d4'], grade: 'blunder', source: 'test', day: '2026-01-01' })]);
  await page.reload();
  await expect(page.getByTestId('dash-weakspots')).toContainText('1 to practise today');
  await page.goto('/#/weak-spots');
  await expect(page.getByTestId('weakspot-feedback')).toContainText('You played g4 here');
  await move(page, 'd2', 'd4');
  await expect(page.getByTestId('weakspot-feedback')).toContainText('right!');
  await expect(page.getByTestId('toast').filter({ hasText: '+3 XP' })).toBeVisible();
  await page.getByTestId('btn-weakspots-done').click();
  await expect(page.getByTestId('dash-weakspots')).toContainText('Nothing due today');
});

test('a wrong move shows the better one and brings the card back tomorrow', async ({ page }) => {
  await seedDeck(page, [makeCard({ fen: FEN, played: 'g4', answers: ['e2e4'], grade: 'blunder', source: 'test', day: '2026-01-01' })]);
  await page.goto('/#/weak-spots');
  await move(page, 'g2', 'g4');
  await expect(page.getByTestId('weakspot-feedback')).toContainText('The better move was e4');
  await expect(page.getByTestId('weakspot-panel')).toHaveAttribute('data-state', 'wrong');
});

test('reviewing a game turns its mistakes into cards', async ({ page }) => {
  await openLocal(page);
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) await move(page, from, to);
  await page.getByTestId('btn-review').click();
  const id = page.url().split('/review/')[1];
  await page.goto(`/#/review/${id}?engine=fast`);
  await expect(page.getByTestId('review-summary')).toBeVisible({ timeout: 30_000 });
  const deck = await page.evaluate(() => JSON.parse(localStorage.getItem('oc.v1.weakspots') ?? '[]'));
  expect(deck.some((c) => c.played === 'g4')).toBe(true);
});
