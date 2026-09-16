import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_LIMIT,
  PER_IP_LIMIT,
  WINDOW_SECONDS,
  clearLoginAttempts,
  clientAddress,
  loginStatus,
  recordLoginFailure,
  resetMemoryLimiter
} from '../../lib/server/ratelimit.js';

const requestFrom = ip => ({ headers: { 'x-forwarded-for': ip }, socket: {} });
const local = { client: null };

test.beforeEach(() => resetMemoryLimiter());

/** One sign-in attempt: check the gate, then record the outcome. */
async function attempt(req, { correct = false, now = Date.now() } = {}) {
  const gate = await loginStatus(req, { ...local, now });
  if (gate.blocked) return gate;
  if (correct) await clearLoginAttempts(req, local);
  else await recordLoginFailure(req, { ...local, now });
  return gate;
}

test('F9: the eleventh wrong password from one address is refused', async () => {
  const req = requestFrom('203.0.113.9');
  for (let i = 1; i <= PER_IP_LIMIT; i += 1) {
    assert.equal((await attempt(req)).blocked, false, `attempt ${i} should be allowed`);
  }
  const blocked = await attempt(req);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.scope, 'ip');
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= WINDOW_SECONDS);
});

test('once blocked, even the right password is refused', async () => {
  const req = requestFrom('203.0.113.13');
  for (let i = 0; i <= PER_IP_LIMIT; i += 1) await attempt(req);
  assert.equal((await loginStatus(req, local)).blocked, true);
});

test('one address being blocked does not block another', async () => {
  for (let i = 0; i <= PER_IP_LIMIT; i += 1) await attempt(requestFrom('198.51.100.1'));
  assert.equal((await attempt(requestFrom('198.51.100.2'))).blocked, false);
});

test('the window reopens once it has passed', async () => {
  const req = requestFrom('203.0.113.10');
  const start = 1_000_000;
  for (let i = 0; i <= PER_IP_LIMIT; i += 1) await attempt(req, { now: start });
  assert.equal((await loginStatus(req, { ...local, now: start })).blocked, true);

  const later = start + WINDOW_SECONDS * 1000 + 1;
  assert.equal((await loginStatus(req, { ...local, now: later })).blocked, false);
});

test('a global ceiling limits failures spread across many addresses', async () => {
  let blocked = null;
  for (let i = 0; i < GLOBAL_LIMIT + 5 && !blocked; i += 1) {
    const result = await attempt(requestFrom(`198.51.100.${i % 200}`));
    if (result.blocked) blocked = result;
  }
  assert.ok(blocked, 'expected the global ceiling to trip');
  assert.equal(blocked.scope, 'global');
});

test('the budget is spent by failures, not by signing in', async () => {
  // Ordinary repeated sign-ins from one address must never be refused, and
  // must not fill the global ceiling for everyone else either.
  const req = requestFrom('203.0.113.41');
  for (let i = 0; i < GLOBAL_LIMIT + 20; i += 1) {
    assert.equal((await attempt(req, { correct: true })).blocked, false, `sign-in ${i}`);
  }
  assert.equal((await loginStatus(requestFrom('203.0.113.99'), local)).blocked, false, 'another address is unaffected');
});

test('a correct password clears that address, leaving a full budget', async () => {
  const req = requestFrom('203.0.113.40');
  for (let i = 0; i < PER_IP_LIMIT - 1; i += 1) await attempt(req);
  await attempt(req, { correct: true });

  for (let i = 0; i < PER_IP_LIMIT; i += 1) {
    assert.equal((await attempt(req)).blocked, false, `attempt ${i} after a success`);
  }
  assert.equal((await loginStatus(req, local)).blocked, true);
});

test('only the first x-forwarded-for entry is trusted', () => {
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' } }), '203.0.113.5');
  assert.equal(clientAddress({ headers: { 'x-real-ip': '203.0.113.6' } }), '203.0.113.6');
  assert.equal(clientAddress({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientAddress({ headers: {} }), 'unknown');
});

test('the gate reads counters without changing them', async () => {
  const sent = [];
  const client = {
    read: async command => { sent.push(command); return command[0] === 'TTL' ? WINDOW_SECONDS : '0'; },
    write: async command => { sent.push(command); return 1; }
  };
  const result = await loginStatus(requestFrom('203.0.113.11'), { client });

  assert.equal(result.blocked, false);
  assert.equal(sent.some(command => command[0] === 'INCR'), false, 'checking is not counting');
  assert.ok(sent.some(command => command[0] === 'GET' && command[1].endsWith('ip:203.0.113.11')));
  assert.ok(sent.some(command => command[0] === 'GET' && command[1].endsWith('global')));
});

test('a failure increments both counters through Upstash and sets the window once', async () => {
  const sent = [];
  let counter = 0;
  const client = {
    read: async () => WINDOW_SECONDS,
    write: async command => { sent.push(command); return command[0] === 'INCR' ? ++counter : 'OK'; }
  };
  await recordLoginFailure(requestFrom('203.0.113.12'), { client });

  assert.deepEqual(sent[0], ['INCR', 'wedding-planner:rl:ip:203.0.113.12']);
  assert.deepEqual(sent[1], ['EXPIRE', 'wedding-planner:rl:ip:203.0.113.12', String(WINDOW_SECONDS)]);
  assert.deepEqual(sent[2], ['INCR', 'wedding-planner:rl:global']);
  assert.equal(sent.filter(command => command[0] === 'EXPIRE').length, 1, 'the second counter was already open');
});

test('clearing goes through Upstash when it is configured', async () => {
  const sent = [];
  await clearLoginAttempts(requestFrom('203.0.113.42'), {
    client: { write: async command => { sent.push(command); return 1; }, read: async () => 0 }
  });
  assert.deepEqual(sent, [['DEL', 'wedding-planner:rl:ip:203.0.113.42']]);
});
