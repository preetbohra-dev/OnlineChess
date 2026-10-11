import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../server/db.js';
import { createAccounts, validateCredentials, hashPassword, verifyPassword, MAX_SESSIONS_PER_USER } from '../../server/auth.js';

const setup = () => {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const db = openDatabase(':memory:');
  return { db, clock, accounts: createAccounts(db, { now: clock.now }) };
};
const PW = 'correct horse battery';

test('credential rules', () => {
  assert.equal(validateCredentials('ab', PW), 'Usernames are 3–20 letters, digits, - or _.');
  assert.match(validateCredentials('alice', 'short'), /at least 10/);
  assert.match(validateCredentials('alice', '1234567890'), /too easy/);
  assert.match(validateCredentials('alice', 'alice-is-great'), /too easy/);
  assert.match(validateCredentials('alice', 'x'.repeat(201)), /at most/);
  assert.equal(validateCredentials('alice_99', PW), null);
  assert.ok(validateCredentials('<script>', PW));
});

test('passwords are salted scrypt hashes', async () => {
  const a = await hashPassword(PW);
  const b = await hashPassword(PW);
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword(PW, a), true);
  assert.equal(await verifyPassword('wrong password!', a), false);
  assert.equal(await verifyPassword(PW, 'garbage'), false);
});

test('register, log in, sessions, log out', async () => {
  const { accounts } = setup();
  const r = await accounts.register('Alice', PW);
  assert.equal(r.ok, true);
  assert.equal(accounts.userForToken(r.token).username, 'Alice');
  const dup = await accounts.register('alice', PW);
  assert.equal(dup.status, 409, 'usernames are unique ignoring case');
  const l = await accounts.login('ALICE', PW);
  assert.equal(l.ok, true);
  assert.notEqual(l.token, r.token);
  accounts.logout(l.token);
  assert.equal(accounts.userForToken(l.token), null);
  assert.ok(accounts.userForToken(r.token), 'other sessions stay');
});

test('wrong passwords, unknown users and locked-out addresses all get the same answer', async () => {
  const { accounts, clock } = setup();
  await accounts.register('bob', PW);
  const unknown = await accounts.login('nobody', PW, '1.2.3.4');
  const wrong = await accounts.login('bob', 'not the password', '1.2.3.4');
  assert.deepEqual(unknown, wrong);
  for (let i = 0; i < 4; i++) await accounts.login('bob', 'not the password', '1.2.3.4');
  const locked = await accounts.login('bob', PW, '1.2.3.4');
  assert.deepEqual(locked, wrong, 'locked out even with the right password, with the same answer');
  assert.equal((await accounts.login('bob', PW, '5.6.7.8')).ok, true, 'another address is not locked out');
  clock.advance(16 * 60_000);
  assert.equal((await accounts.login('bob', PW, '1.2.3.4')).ok, true, 'unlocked after the wait');
});

test('parallel guesses are counted before the slow check', async () => {
  const { accounts } = setup();
  await accounts.register('ivan', PW);
  const results = await Promise.all(Array.from({ length: 8 }, () => accounts.login('ivan', 'guess guess guess', '9.9.9.9')));
  assert.ok(results.every((r) => !r.ok));
  assert.equal((await accounts.login('ivan', PW, '9.9.9.9')).ok, false, 'the address is locked out after the burst');
});

test('sessions expire, are pruned, and are capped per user', async () => {
  const { accounts, clock } = setup();
  const r = await accounts.register('carol', PW);
  clock.advance(31 * 86_400_000);
  assert.equal(accounts.userForToken(r.token), null);
  const tokens = [];
  for (let i = 0; i < MAX_SESSIONS_PER_USER + 3; i++) tokens.push((await accounts.login('carol', PW)).token);
  assert.equal(accounts.userForToken(tokens[0]), null, 'the oldest session was dropped');
  assert.ok(accounts.userForToken(tokens.at(-1)));
  assert.equal(accounts.userForToken('short'), null);
  assert.equal(accounts.userForToken(undefined), null);
});

test('admin: reset a password (signing out everywhere) and delete an account', async () => {
  const { accounts } = setup();
  const r = await accounts.register('dave', PW);
  assert.equal(await accounts.resetPassword('dave', 'a brand new secret'), true);
  assert.equal(accounts.userForToken(r.token), null);
  assert.equal((await accounts.login('dave', 'a brand new secret')).ok, true);
  assert.equal(accounts.deleteUser('dave'), true);
  assert.equal((await accounts.login('dave', 'a brand new secret')).ok, false);
});
