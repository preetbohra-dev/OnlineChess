import { readFileSync } from 'node:fs';
import { test, expect, move } from './helpers.js';
import { parseRow, toLesson } from '../../public/js/core/puzzle-library.js';
import { createGame } from '../../public/js/core/rules.js';

const LIBRARY = JSON.parse(readFileSync(new URL('../../public/data/puzzles.json', import.meta.url))).puzzles.map(parseRow);
const lessonFor = (id) => toLesson(LIBRARY.find((p) => p.id === id));

async function playMove(page, uci) {
  await move(page, uci.slice(0, 2), uci.slice(2, 4));
  if (uci.length === 5) await page.getByTestId(`promo-${uci[4]}`).click();
}

// Solve the puzzle shown in `panel` (data-puzzle holds its id).
async function solve(page, panel) {
  const lesson = lessonFor(await page.getByTestId(panel).getAttribute('data-puzzle'));
  await page.waitForTimeout(700); // the opponent's setup move
  for (let i = 0; i < lesson.solution.length; i += 2) {
    await playMove(page, lesson.solution[i]);
    await page.waitForTimeout(500); // the reply
  }
}

// A legal move that is not the solution (and not a mate, which any mate puzzle would accept).
function wrongMove(lesson) {
  const game = createGame({ fen: lesson.fen });
  return game.legalMoves().map((m) => m.uci).find((uci) => {
    if (uci === lesson.solution[0]) return false;
    const g = createGame({ fen: lesson.fen });
    g.move(uci);
    return g.status().reason !== 'checkmate';
  });
}

test('rated puzzles: solving raises the rating and the next puzzle follows', async ({ page }) => {
  await page.goto('/#/puzzles');
  await expect(page.getByTestId('puzzle-rating')).toHaveText('1000');
  await expect(page.getByTestId('puzzle-panel')).toHaveAttribute('data-puzzle', /.+/);
  await solve(page, 'puzzle-panel');
  await expect(page.getByTestId('lesson-feedback')).toContainText('Solved');
  await expect(page.getByTestId('rating-change')).toContainText('+');
  const first = await page.getByTestId('puzzle-panel').getAttribute('data-puzzle');
  await page.getByTestId('btn-next-puzzle').click();
  await expect(page.getByTestId('puzzle-panel')).not.toHaveAttribute('data-puzzle', first);
  await expect(page.getByTestId('toast').filter({ hasText: '+5 XP' }).first()).toBeAttached();
});

test('a wrong move costs rating; the solution can be shown', async ({ page }) => {
  await page.goto('/#/puzzles');
  await expect(page.getByTestId('puzzle-panel')).toHaveAttribute('data-puzzle', /.+/);
  const lesson = lessonFor(await page.getByTestId('puzzle-panel').getAttribute('data-puzzle'));
  await page.waitForTimeout(700);
  await playMove(page, wrongMove(lesson));
  await expect(page.getByTestId('rating-change')).toContainText('-');
  await expect(page.getByTestId('lesson-feedback')).toContainText('counts as missed');
  await page.getByTestId('btn-solution').click();
  await expect(page.getByTestId('btn-next-puzzle')).toBeVisible();
});

test('puzzles can be filtered by theme', async ({ page }) => {
  await page.goto('/#/puzzles?theme=fork');
  await expect(page.getByTestId('puzzle-panel')).toHaveAttribute('data-puzzle', /.+/);
  const lesson = lessonFor(await page.getByTestId('puzzle-panel').getAttribute('data-puzzle'));
  expect(lesson.themes).toContain('fork');
});

test('Puzzle Rush: solve, three strikes end the run, best score is kept', async ({ page }) => {
  await page.goto('/#/rush');
  await expect(page.getByTestId('rush-best')).toHaveText('0');
  await page.getByTestId('btn-rush-start').click();
  await expect(page.getByTestId('rush-panel')).toHaveAttribute('data-state', 'running');
  await solve(page, 'rush-panel');
  await expect(page.getByTestId('rush-score')).toHaveText('1');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(500);
    const lesson = lessonFor(await page.getByTestId('rush-panel').getAttribute('data-puzzle'));
    await page.waitForTimeout(400);
    await playMove(page, wrongMove(lesson));
  }
  await expect(page.getByTestId('rush-result')).toContainText('You scored 1');
  await expect(page.getByTestId('rush-result')).toContainText('personal best');
  await expect(page.getByTestId('btn-rush-share')).toBeVisible();
  await page.goto('/#/');
  await page.goto('/#/rush');
  await expect(page.getByTestId('rush-best')).toHaveText('1');
});

test('the Rush timer ends the run; a shortened run is practice and does not count', async ({ page }) => {
  await page.goto('/#/rush?seconds=5');
  await page.getByTestId('btn-rush-start').click();
  await expect(page.getByTestId('rush-result')).toContainText('Time is up', { timeout: 12_000 });
  await expect(page.getByTestId('rush-result')).toContainText('not counted');
});

test('a relaxed Rush has no clock', async ({ page }) => {
  await page.goto('/#/rush');
  await page.getByTestId('btn-rush-relaxed').click();
  await expect(page.getByTestId('rush-timer')).toHaveText('Relaxed');
  await expect(page.getByTestId('rush-panel')).toHaveAttribute('data-state', 'running');
});

test('an unknown theme falls back to all puzzles', async ({ page }) => {
  await page.goto('/#/puzzles?theme=constructor');
  await expect(page.getByTestId('puzzle-panel')).toHaveAttribute('data-puzzle', /.+/);
});
