import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../../server/index.js';
import { openDatabase } from '../../server/db.js';
import { FRIEND_CODE, newFriendCode, MAX_REQUESTS_PER_DAY, MAX_ASKS_PER_PERSON } from '../../server/friends.js';

const PW = 'correct horse battery';
let app, base, db;
test.before(async () => {
  db = openDatabase(':memory:');
  app = createAppServer({ usernameSignup: true, db, authRate: { rate: 1000, burst: 1000 }, syncRate: { rate: 1000, burst: 1000 } });
  await new Promise((r) => app.http.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.http.address().port}`;
});
test.after(async () => { await app.close(); db.close(); });

async function call(method, path, { body, cookie } = {}) {
  const headers = { Origin: base, 'X-OC-Request': '1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const players = {};
async function player(name) {
  if (!players[name]) {
    const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { Origin: base, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: PW }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    players[name] = { cookie, code: (await call('GET', '/api/friends', { cookie })).json.code };
  }
  return players[name];
}

test('friend codes: OC- and six easy-to-read characters, one per player, permanent', async () => {
  for (let i = 0; i < 50; i++) assert.match(newFriendCode(), FRIEND_CODE);
  for (let i = 0; i < 50; i++) assert.doesNotMatch(newFriendCode().slice(3), /[01IOL]/);
  const ana = await player('ana');
  assert.match(ana.code, FRIEND_CODE);
  assert.equal((await call('GET', '/api/friends', { cookie: ana.cookie })).json.code, ana.code, 'the same code every time');
  assert.equal((await call('GET', '/api/friends')).status, 401, 'guests have no friends list');
});

test('a request by code, accepted by the other player: friends on both sides', async () => {
  const ana = await player('ana');
  const ben = await player('ben');
  const sent = await call('POST', '/api/friends/request', { cookie: ana.cookie, body: { code: ben.code.toLowerCase() } });
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.json, { status: 'sent', friend: { username: 'ben', code: ben.code } });
  assert.deepEqual((await call('GET', '/api/friends', { cookie: ana.cookie })).json.outgoing.map((f) => f.username), ['ben']);
  const benList = (await call('GET', '/api/friends', { cookie: ben.cookie })).json;
  assert.deepEqual(benList.incoming.map((f) => [f.username, f.code]), [['ana', ana.code]]);

  assert.equal((await call('POST', '/api/friends/accept', { cookie: ben.cookie, body: { code: ana.code } })).status, 200);
  for (const [me, them] of [[ana, 'ben'], [ben, 'ana']]) {
    const list = (await call('GET', '/api/friends', { cookie: me.cookie })).json;
    assert.deepEqual(list.friends.map((f) => f.username), [them]);
    assert.deepEqual([list.incoming, list.outgoing], [[], []]);
  }
  assert.deepEqual((await call('POST', '/api/friends/request', { cookie: ana.cookie, body: { code: ben.code } })).json.status, 'already');
});

test('a request by exact name; asking someone who already asked you makes you friends', async () => {
  const cal = await player('cal');
  const dee = await player('dee');
  assert.equal((await call('POST', '/api/friends/request', { cookie: cal.cookie, body: { name: 'DEE' } })).json.status, 'sent', 'names match regardless of case');
  const back = await call('POST', '/api/friends/request', { cookie: dee.cookie, body: { code: cal.code } });
  assert.equal(back.json.status, 'friends');
  assert.deepEqual((await call('GET', '/api/friends', { cookie: cal.cookie })).json.friends.map((f) => f.username), ['dee']);
});

test('decline, cancel and remove leave nothing behind; mistakes are explained', async () => {
  const eve = await player('eve');
  const fay = await player('fay');
  const ask = () => call('POST', '/api/friends/request', { cookie: eve.cookie, body: { code: fay.code } });
  await ask();
  assert.equal((await call('POST', '/api/friends/accept', { cookie: eve.cookie, body: { code: fay.code } })).status, 404, 'nobody accepts their own request');
  assert.equal((await call('POST', '/api/friends/decline', { cookie: fay.cookie, body: { code: eve.code } })).status, 200);
  assert.deepEqual((await call('GET', '/api/friends', { cookie: eve.cookie })).json.outgoing, [], 'a declined request just disappears');
  await ask();
  assert.equal((await call('POST', '/api/friends/remove', { cookie: eve.cookie, body: { code: fay.code } })).status, 200, 'the sender can take it back');
  assert.deepEqual((await call('GET', '/api/friends', { cookie: fay.cookie })).json.incoming, []);
  await ask();
  await call('POST', '/api/friends/accept', { cookie: fay.cookie, body: { code: eve.code } });
  await call('POST', '/api/friends/remove', { cookie: fay.cookie, body: { code: eve.code } });
  assert.deepEqual((await call('GET', '/api/friends', { cookie: eve.cookie })).json.friends, []);
  assert.equal((await ask()).status, 429, `asking the same player more than ${MAX_ASKS_PER_PERSON} times in a month is refused (cancelling does not reset it)`);

  assert.equal((await call('POST', '/api/friends/request', { cookie: eve.cookie, body: { code: eve.code } })).json.error, 'That is your own code.');
  assert.equal((await call('POST', '/api/friends/request', { cookie: eve.cookie, body: { code: 'OC-ZZZZZZ' } })).status, 404);
  assert.equal((await call('POST', '/api/friends/request', { cookie: eve.cookie, body: { name: 'nobody-here' } })).json.error, 'No player with that code or name.');
  assert.equal((await call('POST', '/api/friends/request', { cookie: eve.cookie, body: {} })).status, 400);
  assert.equal((await call('POST', '/api/friends/accept', { cookie: eve.cookie, body: { code: fay.code } })).status, 404, 'nothing to accept');
});

test('a day\'s friend requests are limited', async () => {
  const spam = await player('spammer');
  const statuses = [];
  for (let i = 0; i <= MAX_REQUESTS_PER_DAY; i++) {
    const target = await player(`target${i}`);
    statuses.push((await call('POST', '/api/friends/request', { cookie: spam.cookie, body: { code: target.code } })).status);
  }
  assert.deepEqual(statuses, [...Array(MAX_REQUESTS_PER_DAY).fill(200), 429]);
});

test('deleting an account removes its friendships', async () => {
  const gus = await player('gus');
  const hal = await player('hal');
  await call('POST', '/api/friends/request', { cookie: gus.cookie, body: { code: hal.code } });
  await call('POST', '/api/friends/accept', { cookie: hal.cookie, body: { code: gus.code } });
  db.q.deleteUser.run(db.q.userByName.get('gus').id);
  assert.deepEqual((await call('GET', '/api/friends', { cookie: hal.cookie })).json.friends, []);
});

test('cancelling and asking again still counts against the daily limit', async () => {
  const cyc = await player('cycler');
  let last;
  for (let i = 0; i < MAX_REQUESTS_PER_DAY + 1; i++) {
    const target = await player(`cycle${Math.floor(i / 3)}`);
    last = await call('POST', '/api/friends/request', { cookie: cyc.cookie, body: { code: target.code } });
    await call('POST', '/api/friends/remove', { cookie: cyc.cookie, body: { code: target.code } });
  }
  assert.equal(last.status, 429);
});

test('players hidden after reports cannot be found; asking by name never makes their code', async () => {
  const quiet = await fetch(`${base}/api/register`, { method: 'POST', headers: { Origin: base, 'X-OC-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nocodeyet', password: PW }) });
  assert.equal(quiet.status, 201);
  const asker = await player('asker');
  const r = await call('POST', '/api/friends/request', { cookie: asker.cookie, body: { name: 'nocodeyet' } });
  assert.deepEqual(r.json.friend, { username: 'nocodeyet', code: null }, 'no code made for someone else');
  assert.equal(db.q.friendCode.get(db.q.userByName.get('nocodeyet').id).friend_code, null);

  const shady = await player('shady');
  db.q.setHidden.run(1, db.q.userByName.get('shady').id);
  assert.equal((await call('POST', '/api/friends/request', { cookie: asker.cookie, body: { code: shady.code } })).status, 404);
  assert.equal((await call('POST', '/api/friends/request', { cookie: asker.cookie, body: { name: 'shady' } })).status, 404);
});

test('the routes need a session and the CSRF header', async () => {
  const ana = await player('ana');
  assert.equal((await call('POST', '/api/friends/request', { body: { code: ana.code } })).status, 401);
  const r = await fetch(`${base}/api/friends/request`, { method: 'POST', headers: { Origin: base, Cookie: ana.cookie, 'Content-Type': 'application/json' }, body: '{"name":"ben"}' });
  assert.equal(r.status, 403);
});
