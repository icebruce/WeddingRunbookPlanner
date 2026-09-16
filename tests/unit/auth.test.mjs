import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  clearSessionCookie,
  createSessionToken,
  getCookie,
  isAuthenticated,
  passwordFingerprint,
  passwordMatches,
  sessionCookie,
  verifySessionToken
} from '../../lib/server/auth.js';
import { MAX_BODY_BYTES, readJson, requireSameOrigin } from '../../lib/server/http.js';

process.env.APP_PASSWORD = 'test-password';
process.env.SESSION_SECRET = '12345678901234567890123456789012';

test('password comparison uses configured password', () => {
  assert.equal(passwordMatches('test-password'), true);
  assert.equal(passwordMatches('wrong'), false);
  assert.equal(passwordMatches(''), false);
  assert.equal(passwordMatches(undefined), false);
});

test('session tokens verify and reject tampering or expiry', () => {
  const now = Date.now();
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now + 1000), true);
  assert.equal(verifySessionToken(`${token}x`, now + 1000), false);
  assert.equal(verifySessionToken(token, now + 31 * 24 * 60 * 60 * 1000), false);
  assert.equal(verifySessionToken('', now), false);
  assert.equal(verifySessionToken('a.b.c', now), false);
});

const COOKIE_NAME = 'wedding_session';

test('a cookie with a broken escape is refused, not thrown out of', () => {
  // decodeURIComponent throws URIError on a lone percent sign. The check ran
  // outside the route's try, so one malformed cookie turned every request that
  // browser made into an opaque 500 — with no way to clear it from inside the
  // app, because the app could no longer load.
  for (const value of ['%', '%E0%A4%A', 'abc%zz', '%%%']) {
    const req = { headers: { cookie: `${COOKIE_NAME}=${value}` } };
    assert.doesNotThrow(() => getCookie(req));
    assert.equal(isAuthenticated(req), false, `${value} is not a token we signed`);
  }
});

test('a cookie that is properly escaped still decodes', () => {
  const req = { headers: { cookie: `${COOKIE_NAME}=one%20two` } };
  assert.equal(getCookie(req), 'one two');
});

test('F28: changing the password signs every device out', () => {
  const now = Date.now();
  const token = createSessionToken(now);
  assert.equal(verifySessionToken(token, now + 1000), true);

  process.env.APP_PASSWORD = 'a-new-password';
  try {
    assert.equal(verifySessionToken(token, now + 1000), false, 'the old token must stop working');
    const reissued = createSessionToken(now);
    assert.equal(verifySessionToken(reissued, now + 1000), true);
  } finally {
    process.env.APP_PASSWORD = 'test-password';
  }
  assert.equal(verifySessionToken(token, now + 1000), true, 'changing back restores the original tokens');
});

test('a token without a password fingerprint is refused', async () => {
  const now = Date.now();
  const token = createSessionToken(now);
  const [payload] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.ok(decoded.pv, 'the fingerprint is part of the signed payload');
  assert.notEqual(decoded.pv, process.env.APP_PASSWORD);
  assert.equal(decoded.pv.length, 16);

  // A legacy token: correctly signed, but carrying no fingerprint.
  const legacyPayload = Buffer.from(JSON.stringify({ exp: now + 1000 })).toString('base64url');
  const crypto = await import('node:crypto');
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(legacyPayload).digest('base64url');
  assert.equal(verifySessionToken(`${legacyPayload}.${signature}`, now), false);
});

test('the fingerprint is derived from the secret, not from the password alone', () => {
  const before = passwordFingerprint('shared-password');
  process.env.SESSION_SECRET = 'abcdefghijabcdefghijabcdefghijab';
  const after = passwordFingerprint('shared-password');
  process.env.SESSION_SECRET = '12345678901234567890123456789012';
  assert.notEqual(before, after);
});

test('the session cookie is HttpOnly, SameSite=Strict and scoped to the site', () => {
  const cookie = sessionCookie('token-value', false);
  assert.match(cookie, /^wedding_session=token-value;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/);
  assert.match(sessionCookie('token-value', true), /Secure/);
  assert.match(clearSessionCookie(false), /Max-Age=0/);
});

test('cookies are read by name, not by position', () => {
  const req = { headers: { cookie: 'other=1; wedding_session=abc%3D; last=2' } };
  assert.equal(getCookie(req), 'abc=');
  assert.equal(getCookie({ headers: {} }), null);
});

function bodyRequest(chunks, headers = {}) {
  const stream = Readable.from(chunks);
  stream.headers = headers;
  return stream;
}

test('F16: the size limit applies to a body the platform already parsed', async () => {
  const big = { notes: 'x'.repeat(MAX_BODY_BYTES + 100) };
  await assert.rejects(
    () => readJson({ body: big, headers: {} }),
    error => error.statusCode === 413
  );
  const small = { title: 'ok' };
  assert.deepEqual(await readJson({ body: small, headers: {} }), small);
});

test('F16: multi-byte characters split across chunks are not corrupted', async () => {
  const text = 'Saint-Étienne · Réception · 🎉';
  const encoded = Buffer.from(JSON.stringify({ location: text }), 'utf8');
  // Split in the middle of a multi-byte sequence.
  const chunks = [encoded.subarray(0, 18), encoded.subarray(18, 31), encoded.subarray(31)];
  const parsed = await readJson(bodyRequest(chunks));
  assert.equal(parsed.location, text);
});

test('an oversized streamed body is refused before it is buffered whole', async () => {
  const chunk = Buffer.alloc(64_000, 'a');
  await assert.rejects(
    () => readJson(bodyRequest([chunk, chunk, chunk, chunk, chunk])),
    error => error.statusCode === 413
  );
});

test('an empty body is an empty object, and malformed JSON is a 400', async () => {
  assert.deepEqual(await readJson(bodyRequest([])), {});
  await assert.rejects(() => readJson(bodyRequest([Buffer.from('{oops')])), error => error.statusCode === 400 && error.code === 'invalid_json');
});

test('F16: a mutating request with no Origin header is refused', () => {
  assert.throws(
    () => requireSameOrigin({ headers: { host: 'example.com' } }),
    error => error.statusCode === 403 && error.code === 'bad_origin'
  );
});

test('the origin must match the host the request arrived on', () => {
  assert.doesNotThrow(() => requireSameOrigin({
    headers: { origin: 'https://example.com', host: 'example.com', 'x-forwarded-proto': 'https' }
  }));
  assert.throws(() => requireSameOrigin({
    headers: { origin: 'https://evil.example', host: 'example.com', 'x-forwarded-proto': 'https' }
  }), error => error.statusCode === 403);
  assert.doesNotThrow(() => requireSameOrigin({
    headers: { origin: 'http://127.0.0.1:4173', host: '127.0.0.1:4173' },
    socket: {}
  }));
});
