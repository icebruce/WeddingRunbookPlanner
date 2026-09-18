import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { signInAndWaitForPlan } from './helpers.mjs';

const menu = async page => {
  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await expect(page.locator('.menu-popover')).toBeVisible();
};

const T = (h, m = 0) => h * 60 + m;
const DATE = '2026-11-21';

// A wall-clock time at the venue. November is EST; see dayof.spec.mjs.
const at = (hours, minutes = 0, day = 21) =>
  new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`);

const plan = () => seedPlan({
  date: DATE,
  activities: [
    activity('ready', T(11, 30), 45, { title: 'Getting Ready', people: ['Bride'] }),
    activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true, people: ['Bride', 'Groom'] }),
    activity('party', T(19, 30), 120, { title: 'Dancing', people: ['All Guests'] })
  ]
});

/** The couple's own copy of the link, taken the way they would take it. */
async function linkFrom(page, server) {
  await server.seed({ plan: plan() });
  await signInAndWaitForPlan(page);
  await menu(page);
  await page.locator('[data-menu-action="share"]').click();
  await expect(page.locator('#share-dialog')).toBeVisible();
  return page.locator('#share-link-field').inputValue();
}

test.describe('the read-only link', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent');
  });

  test('opens the plan for someone who has never signed in', async ({ page, context, server }) => {
    const link = await linkFrom(page, server);
    expect(link).toMatch(/\/share#[\w-]{20,}$/);

    // A genuinely separate visitor: no cookie, no device copy, nothing.
    const visitor = await (await context.browser().newContext({ baseURL: server.baseURL })).newPage();
    await visitor.goto(link);

    await expect(visitor.locator('.card')).toHaveCount(3);
    await expect(visitor.locator('.card[data-activity-id="ceremony"]')).toContainText('Ceremony');
    await expect(visitor.locator('#login-form')).toHaveCount(0);
  });

  test('offers nothing that could change the plan', async ({ page, context, server }) => {
    const link = await linkFrom(page, server);
    const visitor = await (await context.browser().newContext({ baseURL: server.baseURL })).newPage();
    await visitor.goto(link);
    await expect(visitor.locator('.card')).toHaveCount(3);

    await expect(visitor.locator('.mode-pill--view')).toContainText('View only');
    for (const absent of [
      '[data-action="menu"]', '.handle', '.card-controls', '[data-action="add"]',
      '.save-indicator', '.open-time-add', '.stage-tag--button', '[data-action="select-open-time"]'
    ]) {
      await expect(visitor.locator(absent), absent).toHaveCount(0);
    }

    // Double-clicking a card is how the editor is opened in the app.
    await visitor.locator('.card[data-activity-id="ceremony"]').dblclick();
    await expect(visitor.locator('#activity-dialog')).toHaveCount(0);
  });

  test('the token cannot be used to write, only to read', async ({ page, request, server, baseURL }) => {
    const link = await linkFrom(page, server);
    const token = link.split('#')[1];

    const read = await request.get('/api/shared', { headers: { 'x-share-token': token } });
    expect(read.status()).toBe(200);
    // Reading through the link must not hand back a session on the way.
    expect(read.headers()['set-cookie']).toBeUndefined();

    const stored = await server.read();
    // A fresh client carrying only the share token, against every write there is.
    const writes = [
      ['put', '/api/plan', { plan: stored.plan, revision: stored.revision }],
      ['post', '/api/versions', { name: 'Sneaked in' }],
      ['post', '/api/share', {}]
    ];
    for (const [method, path, data] of writes) {
      const response = await request[method](path, {
        headers: { origin: baseURL, 'x-share-token': token },
        data
      });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
  });

  test('replacing the link stops the old one working', async ({ page, context, server }) => {
    const first = await linkFrom(page, server);

    await page.locator('[data-action="share-rotate"]').click();
    await expect.poll(async () => page.locator('#share-link-field').inputValue()).not.toBe(first);
    const second = await page.locator('#share-link-field').inputValue();

    const visitor = await (await context.browser().newContext({ baseURL: server.baseURL })).newPage();
    await visitor.goto(first);
    await expect(visitor.locator('.fatal-view')).toContainText('no longer available');

    await visitor.goto(second);
    await expect(visitor.locator('.card')).toHaveCount(3);
  });

  test('an invented token is refused', async ({ page, context, server }) => {
    await linkFrom(page, server);
    const visitor = await (await context.browser().newContext({ baseURL: server.baseURL })).newPage();
    await visitor.goto('/share#not-a-real-token');
    await expect(visitor.locator('.fatal-view')).toContainText('no longer available');
    await expect(visitor.locator('.card')).toHaveCount(0);
  });

  test('the link keeps the token out of the request the browser makes for the page', async ({ page, context, server }) => {
    const link = await linkFrom(page, server);
    const token = link.split('#')[1];

    const visitorContext = await context.browser().newContext({ baseURL: server.baseURL });
    const visitor = await visitorContext.newPage();
    const urls = [];
    visitor.on('request', request => urls.push(request.url()));
    await visitor.goto(link);
    await expect(visitor.locator('.card')).toHaveCount(3);

    // The fragment never leaves the browser, and nothing puts it back into a
    // URL — so the one credential a vendor holds stays out of every log.
    expect(urls.filter(url => url.includes(token))).toEqual([]);
  });
});

test.describe('the live strip on a shared link', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent');
  });

  test('is absent when the link is opened before the day', async ({ page, context, server }) => {
    const link = await linkFrom(page, server);
    const visitor = await (await context.browser().newContext({ baseURL: server.baseURL })).newPage();
    await visitor.clock.install({ time: at(13, 0, 15) });
    await visitor.goto(link);

    await expect(visitor.locator('.card')).toHaveCount(3);
    await expect(visitor.locator('.live-strip')).toHaveCount(0);
  });

  test('appears on the day itself', async ({ page, context, server }) => {
    const link = await linkFrom(page, server);
    const visitor = await (await context.browser().newContext({ baseURL: server.baseURL })).newPage();
    await visitor.clock.install({ time: at(11, 45) });
    await visitor.goto(link);

    await expect(visitor.locator('.live-strip')).toBeVisible();
    await expect(visitor.locator('.live-strip')).toContainText('Getting Ready');
  });

  test('follows the venue clock for a reader in another zone', async ({ page, context, server }) => {
    const link = await linkFrom(page, server);
    // 10:30 PM in Montreal is 3:30 AM the next day in London: still the
    // wedding day where the wedding is, and that is the only clock that counts.
    const visitorContext = await context.browser().newContext({ baseURL: server.baseURL, timezoneId: 'Europe/London' });
    const visitor = await visitorContext.newPage();
    await visitor.clock.install({ time: at(22, 30) });
    await visitor.goto(link);

    await expect(visitor.locator('.live-strip')).toBeVisible();
  });
});
