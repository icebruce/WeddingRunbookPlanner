import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, passwordMatches, verifySessionToken } from '../lib/server/auth.js';

process.env.APP_PASSWORD = 'test-password';
process.env.SESSION_SECRET = '12345678901234567890123456789012';

test('password comparison uses configured password', () => {
  assert.equal(passwordMatches('test-password'), true);
  assert.equal(passwordMatches('wrong'), false);
});

test('session tokens verify and reject tampering or expiry', () => {
  const now = Date.now();
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now + 1000), true);
  assert.equal(verifySessionToken(`${token}x`, now + 1000), false);
  assert.equal(verifySessionToken(token, now + 31 * 24 * 60 * 60 * 1000), false);
});
