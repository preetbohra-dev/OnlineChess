import test from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, createBucketMap } from '../../server/rate-limit.js';

test('IPv6 addresses are limited per /64; IPv4 as they are', () => {
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(addressKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(addressKey('2001:0db8:0001:0002::5'), '2001:db8:1:2::/64');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('::ffff:10.0.0.1'), '10.0.0.1');
  assert.equal(addressKey('192.168.1.9'), '192.168.1.9');
});

test('bucket maps evict the least recently used key, never everyone at once', () => {
  const m = createBucketMap({ rate: 0.0001, burst: 1, max: 3, now: () => 0 });
  assert.equal(m.take('attacker'), true);
  assert.equal(m.take('attacker'), false);
  m.take('a'); m.take('b');
  assert.equal(m.take('attacker'), false, 'still limited: it was used recently');
  m.take('c'); m.take('d'); m.take('e');
  assert.equal(m.size, 3);
});
