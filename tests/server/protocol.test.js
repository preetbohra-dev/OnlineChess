import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage } from '../../server/protocol.js';

const ok = (obj) => parseClientMessage(JSON.stringify(obj));

test('valid messages pass through unchanged', () => {
  assert.deepEqual(ok({ type: 'create', name: 'Ann', tc: '5+0', color: 'random' }), { ok: true, msg: { type: 'create', name: 'Ann', tc: '5+0', color: 'random' } });
  assert.equal(ok({ type: 'join', room: 'K7QX2M', name: 'José María' }).ok, true);
  assert.equal(ok({ type: 'resume', room: 'K7QX2M', token: 'abcdefghijklmnopqrstuv' }).ok, true);
  assert.equal(ok({ type: 'move', from: 'e2', to: 'e4', ply: 0 }).ok, true);
  assert.equal(ok({ type: 'move', from: 'a7', to: 'a8', promotion: 'n', ply: 12 }).ok, true);
  assert.equal(ok({ type: 'resign' }).ok, true);
  assert.equal(ok({ type: 'answerDraw', accept: false }).ok, true);
  assert.equal(ok({ type: 'emote', id: 'gg' }).ok, true);
  assert.equal(Buffer.isBuffer(Buffer.from('{"type":"rematch"}')) && parseClientMessage(Buffer.from('{"type":"rematch"}')).ok, true);
});

test('garbage and oversized input are rejected', () => {
  assert.deepEqual(parseClientMessage('not json'), { ok: false, code: 'bad_json' });
  assert.deepEqual(parseClientMessage('[1,2]'), { ok: false, code: 'bad_message' });
  assert.deepEqual(parseClientMessage('null'), { ok: false, code: 'bad_message' });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'resign', pad: 'x'.repeat(5000) })), { ok: false, code: 'too_large' });
  assert.deepEqual(parseClientMessage(42), { ok: false, code: 'too_large' });
});

test('unknown types and fields are rejected', () => {
  assert.equal(ok({ type: 'hack' }).code, 'unknown_type');
  assert.equal(ok({ type: '__proto__' }).code, 'unknown_type');
  assert.equal(ok({ type: 'toString' }).code, 'unknown_type');
  assert.equal(ok({ type: 'resign', extra: 1 }).code, 'unknown_field');
  assert.equal(parseClientMessage('{"type":"resign","__proto__":{"polluted":1}}').code, 'unknown_field');
  assert.equal(({}).polluted, undefined);
});

test('fields are strictly typed', () => {
  assert.equal(ok({ type: 'move', from: 'e2', to: 'e9', ply: 0 }).code, 'invalid_field');
  assert.equal(ok({ type: 'move', from: 'E2', to: 'e4', ply: 0 }).code, 'invalid_field');
  assert.equal(ok({ type: 'move', from: 'e2', to: 'e4', ply: '0' }).code, 'invalid_field');
  assert.equal(ok({ type: 'move', from: 'e2', to: 'e4', ply: -1 }).code, 'invalid_field');
  assert.equal(ok({ type: 'move', from: 'e2', to: 'e4' }).code, 'missing_field');
  assert.equal(ok({ type: 'move', from: 'a7', to: 'a8', promotion: 'k', ply: 1 }).code, 'invalid_field');
  assert.equal(ok({ type: 'create', name: 'Ann', tc: '999+0', color: 'w' }).code, 'invalid_field', 'only the preset time controls');
  assert.equal(ok({ type: 'join', room: 'k7qx2m', name: 'Ann' }).code, 'invalid_field');
  assert.equal(ok({ type: 'join', room: 'K7QX2O', name: 'Ann' }).code, 'invalid_field', 'ambiguous letters are not used');
  assert.equal(ok({ type: 'answerDraw', accept: 'yes' }).code, 'invalid_field');
  assert.equal(ok({ type: 'emote', id: 'insult' }).code, 'invalid_field');
  assert.equal(ok({ type: 'emote', id: 'hasOwnProperty' }).code, 'invalid_field');
});

test('display names: letters, digits, spaces, _ - \' only, 1-20 chars, trimmed', () => {
  for (const bad of ['', ' Ann', 'Ann ', 'x'.repeat(21), '<img src=x onerror=alert(1)>', 'Ann\n', 'a"b', 'a/b']) {
    assert.equal(ok({ type: 'join', room: 'K7QX2M', name: bad }).code, 'invalid_field', JSON.stringify(bad));
  }
  for (const good of ['Ann', 'O\'Neil', 'chess_fan-99', '李明', 'Zoë B']) {
    assert.equal(ok({ type: 'join', room: 'K7QX2M', name: good }).ok, true, good);
  }
});
