import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_LIMIT,
  PER_IP_LIMIT,
  WINDOW_SECONDS,
  clientAddress,
  recordLoginAttempt,
  resetMemoryLimiter
} from '../../lib/server/ratelimit.js';

const requestFrom = ip => ({ headers: { 'x-forwarded-for': ip }, socket: {} });

test.beforeEach(() => resetMemoryLimiter());

test('F9: the eleventh attempt from one address is refused', async () => {
  const req = requestFrom('203.0.113.9');
  for (let attempt = 1; attempt <= PER_IP_LIMIT; attempt += 1) {
    const result = await recordLoginAttempt(req, { client: null });
    assert.equal(result.allowed, true, `attempt ${attempt} should be allowed`);
  }
  const blocked = await recordLoginAttempt(req, { client: null });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, 'ip');
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= WINDOW_SECONDS);
});

test('one address being blocked does not block another', async () => {
  for (let attempt = 0; attempt <= PER_IP_LIMIT; attempt += 1) {
    await recordLoginAttempt(requestFrom('198.51.100.1'), { client: null });
  }
  const other = await recordLoginAttempt(requestFrom('198.51.100.2'), { client: null });
  assert.equal(other.allowed, true);
});

test('the window reopens once it has passed', async () => {
  const req = requestFrom('203.0.113.10');
  const start = 1_000_000;
  for (let attempt = 0; attempt <= PER_IP_LIMIT; attempt += 1) {
    await recordLoginAttempt(req, { client: null, now: start });
  }
  assert.equal((await recordLoginAttempt(req, { client: null, now: start })).allowed, false);

  const later = start + WINDOW_SECONDS * 1000 + 1;
  assert.equal((await recordLoginAttempt(req, { client: null, now: later })).allowed, true);
});

test('a global ceiling limits attempts spread across many addresses', async () => {
  let blocked = null;
  for (let attempt = 0; attempt < GLOBAL_LIMIT + 5 && !blocked; attempt += 1) {
    const result = await recordLoginAttempt(requestFrom(`198.51.100.${attempt % 200}`), { client: null });
    if (!result.allowed) blocked = result;
  }
  assert.ok(blocked, 'expected the global ceiling to trip');
  assert.equal(blocked.scope, 'global');
});

test('only the first x-forwarded-for entry is trusted', () => {
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' } }), '203.0.113.5');
  assert.equal(clientAddress({ headers: { 'x-real-ip': '203.0.113.6' } }), '203.0.113.6');
  assert.equal(clientAddress({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientAddress({ headers: {} }), 'unknown');
});

test('counters go through Upstash when it is configured', async () => {
  const sent = [];
  const client = {
    write: async command => { sent.push(command); return command[0] === 'INCR' ? 1 : 'OK'; },
    read: async command => { sent.push(command); return WINDOW_SECONDS; }
  };
  const result = await recordLoginAttempt(requestFrom('203.0.113.11'), { client });
  assert.equal(result.allowed, true);
  assert.deepEqual(sent[0], ['INCR', 'wedding-planner:rl:ip:203.0.113.11']);
  assert.deepEqual(sent[1], ['EXPIRE', 'wedding-planner:rl:ip:203.0.113.11', String(WINDOW_SECONDS)]);
  assert.ok(sent.some(command => command[0] === 'INCR' && command[1].endsWith('global')));
});

test('an expiry is only set when the counter starts a new window', async () => {
  const sent = [];
  const client = {
    write: async command => { sent.push(command); return command[0] === 'INCR' ? 4 : 'OK'; },
    read: async () => 300
  };
  await recordLoginAttempt(requestFrom('203.0.113.12'), { client });
  assert.equal(sent.filter(command => command[0] === 'EXPIRE').length, 0);
});
