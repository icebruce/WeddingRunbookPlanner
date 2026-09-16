import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionToken, sessionCookie } from '../../lib/server/auth.js';
import { createSeedEnvelope } from '../../lib/server/seed-template.js';
import { DATA_KEY, VERSIONS_KEY, setDriver } from '../../lib/server/storage.js';

import loginHandler from '../../api/login.js';
import logoutHandler from '../../api/logout.js';
import sessionHandler from '../../api/session.js';
import planHandler from '../../api/plan.js';
import versionsHandler from '../../api/versions.js';
import exportHandler from '../../api/export.js';
import templateHandler from '../../api/template.js';

process.env.APP_PASSWORD = 'test-password';
process.env.SESSION_SECRET = '12345678901234567890123456789012';
delete process.env.VERCEL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * The same shape as storage.test.mjs's fake driver: an in-memory stand-in for
 * Redis with a single indivisible compareAndSet, so handler tests don't touch
 * disk or a real store and each test starts from a known revision.
 */
function fakeDriver(envelope = createSeedEnvelope()) {
  const { versions, ...rest } = envelope;
  const keys = new Map();
  keys.set(DATA_KEY, structuredClone(rest));
  keys.set(VERSIONS_KEY, { versions: structuredClone(versions || []), revision: 0 });
  return {
    keys,
    async read(key = DATA_KEY) {
      const value = keys.get(key);
      return value ? structuredClone(value) : null;
    },
    async put(key, value) {
      keys.set(key, structuredClone(value));
    },
    async seed(next, key = DATA_KEY) {
      if (keys.has(key)) return false;
      keys.set(key, structuredClone(next));
      return true;
    },
    async compareAndSet(key, expectedRevision, next) {
      const current = keys.get(key);
      if (!current) return { ok: false, missing: true };
      if (Number(current.revision) !== Number(expectedRevision)) return { ok: false, current: structuredClone(current) };
      keys.set(key, structuredClone(next));
      return { ok: true };
    }
  };
}

test.afterEach(() => setDriver(null));

/** A response object that records what a handler wrote, nothing more. */
function fakeRes() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload; },
    json() { return JSON.parse(this.body); }
  };
}

const ORIGIN_HEADERS = { origin: 'https://example.com', host: 'example.com', 'x-forwarded-proto': 'https' };

function req({ method = 'GET', body, headers = {} } = {}) {
  return { method, headers, body };
}

function authHeaders(extra = {}) {
  return { cookie: `wedding_session=${createSessionToken()}`, ...extra };
}

// ---------------------------------------------------------------- login.js

test('login: rejects a method other than POST with 405 and an Allow header', async () => {
  const res = fakeRes();
  await loginHandler(req({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('login: refuses a request with no Origin header before touching the password', async () => {
  const res = fakeRes();
  await loginHandler(req({ method: 'POST', headers: { host: 'example.com' }, body: { password: 'test-password' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'bad_origin');
});

test('login: a wrong password is 401 and sets no cookie', async () => {
  const res = fakeRes();
  await loginHandler(req({ method: 'POST', headers: ORIGIN_HEADERS, body: { password: 'nope' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'bad_password');
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('login: a correct password is 200 and sets a session cookie', async () => {
  const res = fakeRes();
  await loginHandler(req({ method: 'POST', headers: ORIGIN_HEADERS, body: { password: 'test-password' } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /^wedding_session=/);
});

// --------------------------------------------------------------- logout.js

test('logout: rejects a method other than POST', async () => {
  const res = fakeRes();
  await logoutHandler(req({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 405);
});

test('logout: clears the session cookie regardless of whether one was sent', async () => {
  const res = fakeRes();
  await logoutHandler(req({ method: 'POST', headers: ORIGIN_HEADERS }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /wedding_session=;.*Max-Age=0/);
});

test('logout: still refuses a request with no Origin header', async () => {
  const res = fakeRes();
  await logoutHandler(req({ method: 'POST', headers: { host: 'example.com' } }), res);
  assert.equal(res.statusCode, 403);
});

// -------------------------------------------------------------- session.js

test('session: rejects a method other than GET', async () => {
  const res = fakeRes();
  await sessionHandler(req({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('session: reports authenticated true for a valid cookie, false for none', async () => {
  const ok = fakeRes();
  await sessionHandler(req({ headers: authHeaders() }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().authenticated, true);

  const none = fakeRes();
  await sessionHandler(req({ headers: {} }), none);
  assert.equal(none.json().authenticated, false);
});

test('session: a tampered cookie reports false, not an error', async () => {
  const res = fakeRes();
  await sessionHandler(req({ headers: { cookie: `wedding_session=${createSessionToken()}x` } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().authenticated, false);
});

// ----------------------------------------------------------------- plan.js

test('plan: an unauthenticated request is 401 even with a bad method', async () => {
  const res = fakeRes();
  await planHandler(req({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'unauthenticated');
});

test('plan: an authenticated bad method is 405, not 401', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await planHandler(req({ method: 'DELETE', headers: authHeaders() }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, PUT');
});

test('plan: GET returns the plan, revision and updatedBy', async () => {
  const seeded = createSeedEnvelope();
  setDriver(fakeDriver(seeded));
  const res = fakeRes();
  await planHandler(req({ headers: authHeaders() }), res);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.plan.date, '2026-11-21');
  assert.equal(body.revision, seeded.revision);
  assert.equal(body.updatedBy, null);
});

test('plan: GET with a matching ?since short-circuits to unchanged', async () => {
  const seeded = createSeedEnvelope();
  setDriver(fakeDriver(seeded));
  const withUrl = req({ headers: authHeaders() });
  withUrl.url = `/api/plan?since=${seeded.revision}`;
  withUrl.headers.host = 'example.com';
  const res = fakeRes();
  await planHandler(withUrl, res);
  assert.deepEqual(res.json(), { unchanged: true, revision: seeded.revision });
});

test('plan: PUT without an Origin header is refused before the body is read', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await planHandler(req({ method: 'PUT', headers: { host: 'example.com', cookie: authHeaders().cookie }, body: { plan: {}, revision: 0 } }), res);
  assert.equal(res.statusCode, 403);
});

test('plan: PUT with an invalid plan surfaces the validator\'s error, not a 500', async () => {
  setDriver(fakeDriver());
  const seeded = createSeedEnvelope();
  const res = fakeRes();
  await planHandler(req({
    method: 'PUT',
    headers: authHeaders(ORIGIN_HEADERS),
    body: { plan: { ...seeded.plan, title: '   ' }, revision: 0 }
  }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().error.field, 'a validation failure names the field');
});

test('plan: a valid PUT saves and bumps the revision', async () => {
  const seeded = createSeedEnvelope();
  setDriver(fakeDriver(seeded));
  const res = fakeRes();
  await planHandler(req({
    method: 'PUT',
    headers: authHeaders(ORIGIN_HEADERS),
    body: { plan: { ...seeded.plan, title: 'Changed' }, revision: seeded.revision, deviceId: 'device-1' }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().revision, seeded.revision + 1);
});

test('plan: a stale revision is 409 and hands back the current plan', async () => {
  setDriver(fakeDriver());
  const seeded = createSeedEnvelope();
  const res = fakeRes();
  await planHandler(req({
    method: 'PUT',
    headers: authHeaders(ORIGIN_HEADERS),
    body: { plan: seeded.plan, revision: 99 }
  }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'revision_conflict');
  assert.ok(res.json().latest.plan, 'the 409 body includes the current plan to reconcile against');
});

test('plan: a malformed JSON string body is a 400, not a crash', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await planHandler(req({ method: 'PUT', headers: authHeaders(ORIGIN_HEADERS), body: '{oops' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'invalid_json');
});

test('plan: an oversized pre-parsed body is refused with 413', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  const seeded = createSeedEnvelope();
  await planHandler(req({
    method: 'PUT',
    headers: authHeaders(ORIGIN_HEADERS),
    body: { plan: seeded.plan, revision: 0, notes: 'x'.repeat(300_000) }
  }), res);
  assert.equal(res.statusCode, 413);
});

// -------------------------------------------------------------- versions.js

test('versions: an unauthenticated request is 401', async () => {
  const res = fakeRes();
  await versionsHandler(req(), res);
  assert.equal(res.statusCode, 401);
});

test('versions: an authenticated bad method is 405', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await versionsHandler(req({ method: 'PATCH', headers: authHeaders() }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, POST, PUT, DELETE');
});

test('versions: the list never carries a full plan body', async () => {
  setDriver(fakeDriver());
  const post = fakeRes();
  await versionsHandler(req({ method: 'POST', headers: authHeaders(ORIGIN_HEADERS), body: { name: 'Snapshot' } }), post);
  assert.equal(post.statusCode, 201);

  const list = fakeRes();
  await versionsHandler(req({ headers: authHeaders() }), list);
  const versions = list.json().versions;
  assert.equal(versions.length, 1);
  assert.equal(versions[0].name, 'Snapshot');
  assert.equal('plan' in versions[0], false);
});

test('versions: an empty name is rejected', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await versionsHandler(req({ method: 'POST', headers: authHeaders(ORIGIN_HEADERS), body: { name: '   ' } }), res);
  assert.equal(res.statusCode, 400);
});

test('versions: create then restore round-trips the plan, including its body', async () => {
  const seeded = createSeedEnvelope();
  setDriver(fakeDriver(seeded));
  const created = fakeRes();
  await versionsHandler(req({ method: 'POST', headers: authHeaders(ORIGIN_HEADERS), body: { name: 'Before change' } }), created);
  const id = created.json().versions[0].id;

  const fetched = fakeRes();
  const withId = req({ headers: authHeaders() });
  withId.url = `/api/versions?id=${id}`;
  withId.headers.host = 'example.com';
  await versionsHandler(withId, fetched);
  assert.equal(fetched.statusCode, 200);
  assert.ok(fetched.json().version.plan, 'fetching a single version includes its plan');

  const restored = fakeRes();
  await versionsHandler(req({ method: 'PUT', headers: authHeaders(ORIGIN_HEADERS), body: { id, revision: seeded.revision } }), restored);
  assert.equal(restored.statusCode, 200);
});

test('versions: restoring an id that does not exist is a 404, not a 500', async () => {
  const seeded = createSeedEnvelope();
  setDriver(fakeDriver(seeded));
  const res = fakeRes();
  await versionsHandler(req({ method: 'PUT', headers: authHeaders(ORIGIN_HEADERS), body: { id: 'missing-id', revision: seeded.revision } }), res);
  assert.equal(res.statusCode, 404);
});

test('versions: fetching an id that does not exist is a 404', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  const withId = req({ headers: authHeaders() });
  withId.url = '/api/versions?id=missing-id';
  withId.headers.host = 'example.com';
  await versionsHandler(withId, res);
  assert.equal(res.statusCode, 404);
});

test('versions: delete removes it from the list', async () => {
  setDriver(fakeDriver());
  const created = fakeRes();
  await versionsHandler(req({ method: 'POST', headers: authHeaders(ORIGIN_HEADERS), body: { name: 'Doomed' } }), created);
  const id = created.json().versions[0].id;

  const res = fakeRes();
  const del = req({ method: 'DELETE', headers: authHeaders(ORIGIN_HEADERS) });
  del.url = `/api/versions?id=${id}`;
  del.headers.host = 'example.com';
  await versionsHandler(del, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().versions.length, 0);
});

// --------------------------------------------------------------- export.js

test('export: rejects a method other than GET', async () => {
  const res = fakeRes();
  await exportHandler(req({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('export: an unauthenticated request is 401', async () => {
  const res = fakeRes();
  await exportHandler(req(), res);
  assert.equal(res.statusCode, 401);
});

test('export: returns the plan as a downloadable file named for its date', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await exportHandler(req({ headers: authHeaders() }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="wedding-plan-2026-11-21.json"');
  assert.equal(res.json().date, '2026-11-21');
});

test('export: the exported file has no revision or store metadata, only the plan', async () => {
  setDriver(fakeDriver());
  const res = fakeRes();
  await exportHandler(req({ headers: authHeaders() }), res);
  const body = res.json();
  assert.equal('revision' in body, false);
  assert.equal('updatedAt' in body, false);
});

// -------------------------------------------------------------- template.js

test('template: rejects a method other than GET', async () => {
  const res = fakeRes();
  await templateHandler(req({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('template: an unauthenticated request is 401', async () => {
  const res = fakeRes();
  await templateHandler(req(), res);
  assert.equal(res.statusCode, 401);
});

test('template: activities come back without ids, ready to become somebody else\'s', async () => {
  const res = fakeRes();
  await templateHandler(req({ headers: authHeaders() }), res);
  assert.equal(res.statusCode, 200);
  const { activities } = res.json();
  assert.ok(activities.length > 0);
  for (const activity of activities) assert.equal('id' in activity, false);
});
