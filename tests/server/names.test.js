import test from 'node:test';
import assert from 'node:assert/strict';
import { nameProblem } from '../../server/names.js';

test('offensive usernames are refused, including look-alike spellings', () => {
  for (const name of ['fuck_you', 'ShitHead', 'n1gg3r', 'f4ggot', 'xx-Hitler-xx', 'b1tch99', 'ass', 'big_dick']) {
    assert.ok(nameProblem(name), name);
  }
});

test('names that only look like an official account are refused', () => {
  for (const name of ['admin', 'Moderator', 'OnlineChess', 'support_team', 'official', 'admin2', '4dmin', 'adm1n', 'the_m0d']) assert.ok(nameProblem(name), name);
});

test('ordinary names pass, even when they contain a short rude word inside another word', () => {
  for (const name of ['classic', 'Cassandra', 'peacock', 'Dickens', 'grass_snake', 'erin', 'knight_rider', 'title_holder', 'Mikike', 'peniston', 'Kazinazi', 'modern_chess']) {
    assert.equal(nameProblem(name), null, name);
  }
});
