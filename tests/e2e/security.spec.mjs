import { readFile } from 'node:fs/promises';

import { test, expect, TEST_PASSWORD } from './fixtures.mjs';

// These are HTTP-level checks (auth, rate limiting, CSRF/origin, body size,
// response shape) with no viewport-dependent assertion anywhere in the file,
// so running them under every device project would only multiply CI time
// without adding coverage.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent');
});

/**
 * These go through the HTTP layer rather than the UI. Each uses its own
 * x-forwarded-for value so that exhausting one address's login budget does not
 * affect the other tests sharing this worker's server.
 */
function headers(baseURL, address) {
  return { origin: baseURL, 'x-forwarded-for': address };
}

test('F9: the eleventh wrong password from one address is refused', async ({ request, baseURL }) => {
  const address = '203.0.113.21';
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await request.post('/api/login', {
      headers: headers(baseURL, address),
      data: { password: `wrong-${attempt}` }
    });
    expect(response.status(), `attempt ${attempt}`).toBe(401);
  }

  const blocked = await request.post('/api/login', {
    headers: headers(baseURL, address),
    data: { password: `wrong-11` }
  });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error.message).toBe('Too many attempts. Try again in 15 minutes.');
  expect(blocked.headers()['retry-after']).toBeTruthy();

  // Even the right password is refused once the budget is spent.
  const correct = await request.post('/api/login', {
    headers: headers(baseURL, address),
    data: { password: TEST_PASSWORD }
  });
  expect(correct.status()).toBe(429);
});

test('the budget is spent by failures, not by signing in', async ({ request, baseURL }) => {
  // Ten ordinary sign-ins from one address — a household, or a couple on the
  // same Wi-Fi — must not lock anyone out.
  const address = '203.0.113.32';
  for (let signIn = 1; signIn <= 12; signIn += 1) {
    const response = await request.post('/api/login', {
      headers: headers(baseURL, address),
      data: { password: TEST_PASSWORD }
    });
    expect(response.status(), `sign-in ${signIn}`).toBe(200);
  }
});

test('a correct password resets the count after some wrong guesses', async ({ request, baseURL }) => {
  const address = '203.0.113.33';
  for (let attempt = 0; attempt < 9; attempt += 1) {
    await request.post('/api/login', { headers: headers(baseURL, address), data: { password: 'wrong' } });
  }
  expect((await request.post('/api/login', { headers: headers(baseURL, address), data: { password: TEST_PASSWORD } })).status()).toBe(200);

  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await request.post('/api/login', { headers: headers(baseURL, address), data: { password: 'wrong' } });
    expect(response.status(), `attempt ${attempt} in the fresh window`).toBe(401);
  }
});

test('rate limiting is per address', async ({ request, baseURL }) => {
  for (let attempt = 0; attempt < 11; attempt += 1) {
    await request.post('/api/login', { headers: headers(baseURL, '203.0.113.22'), data: { password: 'wrong' } });
  }
  const other = await request.post('/api/login', {
    headers: headers(baseURL, '203.0.113.23'),
    data: { password: TEST_PASSWORD }
  });
  expect(other.status()).toBe(200);
});

test('a wrong password says what to do, and never reveals the right one', async ({ request, baseURL }) => {
  const response = await request.post('/api/login', {
    headers: headers(baseURL, '203.0.113.24'),
    data: { password: 'nope' }
  });
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.error.code).toBe('bad_password');
  expect(body.error.message).toBe("That password didn't work. Try again.");
  expect(JSON.stringify(body)).not.toContain(TEST_PASSWORD);
});

test('F16: a write with no Origin header is refused', async ({ request, baseURL }) => {
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.25'), data: { password: TEST_PASSWORD } });

  const response = await request.put('/api/plan', { data: { plan: {}, revision: 1 } });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('bad_origin');
});

test('a write from another origin is refused', async ({ request, baseURL }) => {
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.26'), data: { password: TEST_PASSWORD } });

  const response = await request.put('/api/plan', {
    headers: { origin: 'https://evil.example' },
    data: { plan: {}, revision: 1 }
  });
  expect(response.status()).toBe(403);
});

test('an oversized body is refused rather than parsed', async ({ request, baseURL }) => {
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.27'), data: { password: TEST_PASSWORD } });

  const response = await request.put('/api/plan', {
    headers: { origin: baseURL },
    data: { plan: { notes: 'x'.repeat(400_000) }, revision: 1 }
  });
  expect(response.status()).toBe(413);
});

/*
 * F8 — the site serves public/ and nothing else.
 *
 * The old build served the repository root, so lib/server/default-data.js
 * returned its own source on production. Two things keep that from coming
 * back: vercel.json names public/ as the output directory, and the dev server
 * resolves every path inside public/ or answers 404. Both are checked, because
 * a green development run against a misconfigured deploy would prove nothing.
 */
test('F8: nothing outside public/ can be downloaded', async ({ request, baseURL }) => {
  const offLimits = [
    '/lib/server/seed-template.js',
    '/lib/server/storage.js',
    '/lib/server/auth.js',
    '/api/plan.js',
    '/scripts/dev-server.mjs',
    '/package.json',
    '/vercel.json',
    '/.env',
    '/.env.example',
    '/docs/FUNCTIONAL_SPEC.md',
    // And the same again, reached by climbing out of public/.
    '/../lib/server/seed-template.js',
    '/%2e%2e/package.json'
  ];

  for (const route of offLimits) {
    const response = await request.get(`${baseURL}${route}`, { failOnStatusCode: false });
    expect(response.status(), route).toBe(404);
  }

  // And the things that are meant to be there still are.
  for (const route of ['/', '/src/app.js', '/styles/tokens.css']) {
    const response = await request.get(`${baseURL}${route}`);
    expect(response.status(), route).toBe(200);
  }
});

test('F8: the deploy is configured to serve only public/', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  expect(config.outputDirectory).toBe('public');
});

test('a malformed session cookie answers 401, not 500', async ({ request, baseURL }) => {
  // Something other than this app can put a broken percent-escape in a cookie
  // — a proxy, an extension, a truncated jar. decodeURIComponent throws on it,
  // and the throw used to escape as an opaque 500 on every single request,
  // which the app could not clear because the app could no longer load.
  for (const value of ['%', 'abc%zz', '%E0%A4%A']) {
    for (const route of ['/api/plan', '/api/versions', '/api/export', '/api/template']) {
      const response = await request.get(`${baseURL}${route}`, {
        headers: { cookie: `wedding_session=${value}` },
        failOnStatusCode: false
      });
      expect(response.status(), `${route} with cookie ${value}`).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('unauthenticated');
    }
  }
});

test('every unauthenticated route answers 401 in the documented shape', async ({ request }) => {
  for (const path of ['/api/plan', '/api/versions']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('unauthenticated');
    expect(typeof body.error.message).toBe('string');
  }
});

test('an unsupported method answers 405 and says what is allowed', async ({ request, baseURL }) => {
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.28'), data: { password: TEST_PASSWORD } });

  const response = await request.delete('/api/plan', { headers: { origin: baseURL } });
  expect(response.status()).toBe(405);
  expect(response.headers().allow).toContain('PUT');
});

test('F15: the server rejects invalid plans with the field that failed', async ({ request, baseURL }) => {
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.29'), data: { password: TEST_PASSWORD } });
  const current = await (await request.get('/api/plan')).json();

  const cases = [
    [{ ...current.plan, title: '   ' }, 'title'],
    [{ ...current.plan, timezone: 'Mars/Olympus' }, 'timezone'],
    [{ ...current.plan, activities: [{ ...current.plan.activities[0], start: -5 }] }, 'activities[0].start'],
    [{ ...current.plan, coupleLabel: '' }, 'coupleLabel'],
    [{ ...current.plan, activities: [{ ...current.plan.activities[0], stage: 'after-party' }] }, 'activities[0].stage'],
    [{ ...current.plan, activities: [{ ...current.plan.activities[0], duration: 7000 }] }, 'activities[0].duration']
  ];

  for (const [plan, field] of cases) {
    const response = await request.put('/api/plan', {
      headers: { origin: baseURL },
      data: { plan, revision: current.revision }
    });
    expect(response.status(), field).toBe(400);
    const body = await response.json();
    expect(body.error.field, field).toBe(field);
    expect(body.error.code).toBeTruthy();
  }

  // Nothing was written by any of them.
  expect((await (await request.get('/api/plan')).json()).revision).toBe(current.revision);
});

test('unknown fields are dropped instead of stored', async ({ request, baseURL, server }) => {
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.30'), data: { password: TEST_PASSWORD } });
  const current = await (await request.get('/api/plan')).json();

  const response = await request.put('/api/plan', {
    headers: { origin: baseURL },
    data: { plan: { ...current.plan, injected: 'nope' }, revision: current.revision }
  });
  expect(response.status()).toBe(200);
  expect('injected' in (await server.read()).plan).toBe(false);
});

test('D22, F28: changing the password invalidates existing sessions', async ({ request, baseURL }) => {
  // The token carries a fingerprint of the password it was issued under; a
  // token signed for a different password cannot pass the check.
  await request.post('/api/login', { headers: headers(baseURL, '203.0.113.31'), data: { password: TEST_PASSWORD } });
  expect((await request.get('/api/session')).status()).toBe(200);
  expect((await (await request.get('/api/session')).json()).authenticated).toBe(true);

  const { createSessionToken } = await import('../../lib/server/auth.js');
  const previousPassword = process.env.APP_PASSWORD;
  const previousSecret = process.env.SESSION_SECRET;
  process.env.APP_PASSWORD = 'a-completely-different-password';
  process.env.SESSION_SECRET = 'e2e-session-secret-0123456789abcdef';
  const foreignToken = createSessionToken();
  process.env.APP_PASSWORD = previousPassword;
  process.env.SESSION_SECRET = previousSecret;

  const response = await request.get('/api/plan', {
    headers: { cookie: `wedding_session=${foreignToken}` }
  });
  expect(response.status()).toBe(401);
});
