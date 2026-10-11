import { test, expect, move } from './helpers.js';
import { readFileSync } from 'node:fs';
import { parseRow, toLesson } from '../../public/js/core/puzzle-library.js';

const LIBRARY = JSON.parse(readFileSync(new URL('../../public/data/puzzles.json', import.meta.url))).puzzles.map(parseRow);

const MATE_IN_ONE = encodeURIComponent('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');

test('a new player sees the dashboard with rank, daily puzzle and where to continue', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('rank-name')).toHaveText('Pawn');
  await expect(page.getByTestId('dash-daily')).toContainText('Daily puzzle');
  await expect(page.getByTestId('dash-streak')).toContainText('Start a streak');
  await expect(page.getByTestId('dash-continue')).toHaveAttribute('href', '#/learn/novice-board');
});

test('a win from a set-up position is practice: a little XP, no record or achievements', async ({ page }) => {
  await page.goto(`/#/play/bot?persona=beyond&color=w&engine=fast&fen=${MATE_IN_ONE}`);
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await expect(page.getByTestId('status-banner')).not.toContainText('waking up', { timeout: 15_000 });
  await move(page, 'a1', 'a8');
  await expect(page.getByTestId('game-over-modal')).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: '+5 XP' })).toBeVisible();
  expect(await page.evaluate(() => globalThis.__oc.confetti), 'no confetti for practice').toBe(0);
  await page.goto('/#/profile');
  await expect(page.getByTestId('record-beyond')).toContainText('—');
  await expect(page.getByTestId('ach-beat-beyond')).toHaveAttribute('data-unlocked', 'false');
});

test('a real win against the computer is recorded with achievements on the profile', async ({ page }) => {
  // A stored profile as the app writes it after beating Pip from the start position.
  await page.goto('/#/');
  await page.evaluate(() => localStorage.setItem('oc.v1.profile', JSON.stringify({
    xp: 20, games: { played: 1, won: 1, drawn: 0, lost: 0, mates: 1 },
    bots: { novice: { w: 1, d: 0, l: 0, streak: 1, best: 1 } },
    achievements: { 'first-win': '2026-10-11T00:00:00Z', checkmate: '2026-10-11T00:00:00Z', 'beat-novice': '2026-10-11T00:00:00Z' },
  })));
  await page.goto('/#/profile');
  await expect(page.getByTestId('record-novice')).toContainText('1W 0D 0L');
  await expect(page.getByTestId('ach-first-win')).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('ach-beat-beyond')).toHaveAttribute('data-unlocked', 'false');
  await expect(page.getByTestId('xp')).toContainText('20 XP');
});

test('the daily puzzle: solving it starts a streak, shown on the dashboard', async ({ page }) => {
  await page.goto('/#/daily');
  await expect(page.getByTestId('daily')).toBeVisible();
  await expect(page.locator('.board rect[data-square="e4"]')).toBeVisible();
  await expect(page.getByTestId('daily')).toHaveAttribute('data-source', 'library');
  const id = await page.getByTestId('daily').getAttribute('data-lesson');
  const lesson = toLesson(LIBRARY.find((p) => p.id === id));
  for (let i = 0; i < lesson.solution.length; i += 2) {
    const uci = lesson.solution[i];
    await move(page, uci.slice(0, 2), uci.slice(2, 4));
    if (uci.length === 5) await page.getByTestId(`promo-${uci[4]}`).click();
    await page.waitForTimeout(600); // the scripted reply
  }
  await expect(page.getByTestId('lesson-feedback')).toContainText('Solved');
  await expect(page.getByTestId('daily-streak')).toContainText('1-day streak');
  await page.goto('/#/');
  await expect(page.getByTestId('dash-daily')).toContainText('Solved today');
  await expect(page.getByTestId('dash-streak')).toContainText('1-day streak');
});

test('completing a lesson gives XP once; the profile can be reset', async ({ page }) => {
  await page.goto('/#/learn/novice-board');
  for (let i = 0; i < 2; i++) await page.getByTestId('btn-next').click();
  await expect(page.getByTestId('toast').filter({ hasText: '+25 XP' })).toBeVisible();
  await page.goto('/#/profile');
  await expect(page.getByTestId('xp')).toContainText('25 XP');
  await page.getByTestId('btn-reset-profile').click();
  await page.getByTestId('btn-confirm').click();
  await expect(page.getByTestId('xp')).toContainText('0 XP');
});

test('the profile is reachable from the top bar and lists every achievement', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile')).toBeVisible();
  await expect(page.locator('[data-testid^="ach-"]')).toHaveCount(22);
  await expect(page.getByTestId('bot-records').locator('tbody tr')).toHaveCount(5);
});

test('no horizontal scrolling on a small phone (360px) on the home and profile pages', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const route of ['/#/', '/#/profile', '/#/daily', '/#/openings']) {
    await page.goto(route);
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});
