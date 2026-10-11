import { readFileSync } from 'node:fs';
import { test, expect, move } from './helpers.js';
import { questsFor, weekKey } from '../../public/js/core/quests.js';
import { dayKey, previousDay } from '../../public/js/core/progression.js';
import { parseRow, toLesson } from '../../public/js/core/puzzle-library.js';

const LIBRARY = JSON.parse(readFileSync(new URL('../../public/data/puzzles.json', import.meta.url))).puzzles.map(parseRow);

test('the dashboard shows this week\'s three quests and the freezes held', async ({ page }) => {
  await page.goto('/#/');
  const quests = questsFor(weekKey(new Date()));
  await expect(page.locator('[data-testid^="quest-"]')).toHaveCount(3);
  for (const q of quests) await expect(page.getByTestId(`quest-${q.id}`)).toContainText(`0/${q.target}`);
  await expect(page.getByTestId('dash-quests')).toContainText('0 streak freezes');
});

test('quest progress for this week shows as done, on the dashboard and the profile', async ({ page }) => {
  const [first] = questsFor(weekKey(new Date()));
  await page.goto('/#/');
  await page.evaluate(({ week, id, target }) => localStorage.setItem('oc.v1.profile', JSON.stringify({ quests: { week, progress: { [id]: target }, rewarded: false }, freezes: 1 })), { week: weekKey(new Date()), id: first.id, target: first.target });
  await page.reload();
  await expect(page.getByTestId(`quest-${first.id}`)).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('dash-quests')).toContainText('1 streak freeze');
  await page.goto('/#/profile');
  await expect(page.getByTestId(`quest-${first.id}`)).toHaveAttribute('data-done', 'true');
});

test('a streak freeze covers a missed day of the daily puzzle', async ({ page }) => {
  const twoDaysAgo = previousDay(previousDay(dayKey()));
  await page.goto('/#/');
  await page.evaluate((last) => localStorage.setItem('oc.v1.profile', JSON.stringify({ freezes: 1, daily: { last, streak: 4, best: 4, solved: 4 } })), twoDaysAgo);
  await page.reload();
  await expect(page.getByTestId('dash-streak')).toContainText('4-day streak');
  await page.goto('/#/daily');
  await expect(page.getByTestId('daily-streak')).toContainText('streak freeze will cover');
  const id = await page.getByTestId('daily').getAttribute('data-lesson');
  const daily = toLesson(LIBRARY.find((p) => p.id === id));
  for (let i = 0; i < daily.solution.length; i += 2) {
    const uci = daily.solution[i];
    await move(page, uci.slice(0, 2), uci.slice(2, 4));
    if (uci.length === 5) await page.getByTestId(`promo-${uci[4]}`).click();
    await page.waitForTimeout(600);
  }
  await expect(page.getByTestId('toast').filter({ hasText: 'streak freeze saved' })).toBeVisible();
  await expect(page.getByTestId('daily-streak')).toContainText('5-day streak');
});
