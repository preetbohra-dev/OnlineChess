import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignView, starsForWin, awardStars, totalStars, starCount, emptyStars } from '../../public/js/core/campaign.js';
import { BOARD_THEMES, PIECE_SETS } from '../../public/js/data/cosmetics.js';
import { RANKS } from '../../public/js/core/progression.js';

test('only Pip is open at first; beating an opponent opens the next', () => {
  const fresh = campaignView({});
  assert.deepEqual(fresh.map((s) => s.unlocked), [true, false, false, false, false]);
  const after = campaignView({ novice: { win: true, fast: false, clean: false } });
  assert.deepEqual(after.map((s) => s.unlocked), [true, true, false, false, false]);
  const magnus = campaignView({ novice: { win: true }, amateur: { win: true }, pro: { win: true }, grandmaster: { win: true } });
  assert.equal(magnus.at(-1).persona.id, 'beyond');
  assert.equal(magnus.at(-1).unlocked, true);
});

test('a quick win earns the speed star; the 40-move limit counts the player\'s moves', () => {
  assert.deepEqual(starsForWin({ plies: 79, playerColor: 'w' }), { win: true, fast: true });
  assert.deepEqual(starsForWin({ plies: 81, playerColor: 'w' }), { win: true, fast: false });
  assert.deepEqual(starsForWin({ plies: 81, playerColor: 'b' }), { win: true, fast: true });
});

test('stars accumulate and are never lost', () => {
  let { campaign, earned } = awardStars({}, 'novice', { win: true, fast: false });
  assert.deepEqual(earned, ['win']);
  ({ campaign, earned } = awardStars(campaign, 'novice', { win: true, fast: true }));
  assert.deepEqual(earned, ['fast']);
  ({ campaign, earned } = awardStars(campaign, 'novice', { clean: true }));
  assert.deepEqual(earned, ['clean']);
  assert.equal(starCount(campaign.novice), 3);
  assert.equal(totalStars(campaign), 3);
  assert.equal(starCount(emptyStars()), 0);
});

test('cosmetics name real ranks, start with a free default and unlock in rank order', () => {
  const order = RANKS.map((r) => r.id);
  for (const list of [BOARD_THEMES, PIECE_SETS]) {
    assert.equal(list[0].rank, 'pawn');
    const idx = list.map((x) => order.indexOf(x.rank));
    assert.ok(idx.every((i) => i >= 0));
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  }
});
