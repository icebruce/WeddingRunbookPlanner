import { test, expect, TEST_PASSWORD, activity, seedPlan } from './fixtures.mjs';
import { openActivityEditor, openPlanner, signInAndWaitForPlan } from './helpers.mjs';

// Save/sync/version-history logic (offline queueing, conflicts, multi-tab
// sync) has no viewport-dependent assertion in this file.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent');
});

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
const saved = page => expect(page.locator('.save-indicator')).toHaveText('Saved');

async function rename(page, id, title) {
  await openActivityEditor(page, card(page, id));
  await page.locator('#activity-dialog input[name="title"]').fill(title);
  await page.locator('#activity-dialog button[type="submit"]').click();
  await expect(page.locator('#activity-dialog')).toHaveCount(0);
}

const T = (h, m = 0) => h * 60 + m;

const base = () => seedPlan({
  activities: [
    activity('ready', T(11, 30), 45, { title: 'Getting Ready' }),
    activity('portraits', T(12, 15), 30, { title: 'Portraits' }),
    activity('travel', T(12, 45), 35, { title: 'Travel' })
  ]
});

test('D20: the plan is kept on the device and read back when the server cannot be reached', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await expect(card(page, 'ready')).toBeVisible();

  // The page itself still loads — from the browser's cache, or because it was
  // never closed — but nothing can be fetched. There is no service worker, so
  // a genuinely cold start with no network cannot reach the app at all; this
  // is the case the device copy is for.
  await page.route('**/api/plan**', route => route.abort('failed'));
  await page.reload();

  await expect(page.locator('.card')).toHaveCount(3);
  await expect(page.locator('.pinned-bar--offline')).toContainText('last plan saved on this device');
  await expect(page.locator('.fatal-view')).toHaveCount(0);
});

test('an edit made offline survives a reload and saves on reconnect', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await context.setOffline(true);
  await rename(page, 'portraits', 'Edited with no signal');
  await expect(page.locator('.save-indicator')).toHaveText('Offline');
  await expect(page.locator('.pinned-bar--offline')).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(card(page, 'portraits')).toContainText('Edited with no signal');
  await saved(page);
  expect((await server.read()).plan.activities[1].title).toBe('Edited with no signal');
});

test('a change made just before the tab closes is still sent', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await rename(page, 'travel', 'Typed then closed');
  // Inside the 650 ms debounce: the page goes away before the save would fire.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  await expect.poll(async () => (await server.read()).plan.activities[2].title, { timeout: 10_000 })
    .toBe('Typed then closed');
});

test('hiding the tab mid-edit is not a conflict with yourself', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  // Type, then hide the tab inside the debounce: the change goes out with the
  // page and the answer is never read, so the server moves ahead of this tab
  // carrying this tab's own writing.
  await rename(page, 'ready', 'Typed then hidden');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await server.read()).plan.activities[0].title, { timeout: 10_000 })
    .toBe('Typed then hidden');

  // Come back and carry on working.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await rename(page, 'portraits', 'A second ordinary edit');

  // No dialog asking which copy to keep: there is one device here, and one of
  // the answers would have thrown the work away.
  await expect(page.locator('#conflict-dialog')).toHaveCount(0);
  await saved(page);

  const stored = await server.read();
  expect(stored.plan.activities[0].title).toBe('Typed then hidden');
  expect(stored.plan.activities[1].title).toBe('A second ordinary edit');
});

test('D19: the copy not chosen in a conflict is kept in version history', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'ready', 'From the other device');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  await rename(page, 'ready', 'From this device');
  await expect(page.locator('#conflict-dialog')).toBeVisible();
  await page.locator('[data-choice="local"]').click();

  await saved(page);
  expect((await server.read()).plan.activities[0].title).toBe('From this device');

  // The other device's copy is not gone; it is a version.
  const versions = await page.evaluate(async () => (await (await fetch('/api/versions')).json()).versions);
  expect(versions.some(version => version.auto && /Other device/.test(version.name))).toBe(true);
});

test('choosing the other version keeps mine as a version', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'ready', 'Theirs');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  await rename(page, 'ready', 'Mine');
  await expect(page.locator('#conflict-dialog')).toBeVisible();
  await page.locator('[data-choice="remote"]').click();

  await expect(card(page, 'ready')).toContainText('Theirs');
  const versions = await page.evaluate(async () => (await (await fetch('/api/versions')).json()).versions);
  expect(versions.some(version => version.auto && /My unsaved changes/.test(version.name))).toBe(true);
});

test('a tab coming back to the front picks up another device\'s change', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'travel', 'Changed elsewhere');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  // Nothing of ours is waiting, so taking theirs overwrites nothing.
  await page.bringToFront();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(card(page, 'travel')).toContainText('Changed elsewhere', { timeout: 10_000 });
});

test('a refresh never runs over unsaved local work', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await context.setOffline(true);
  await rename(page, 'portraits', 'Mine, not yet sent');
  await expect(page.locator('.save-indicator')).toHaveText('Offline');

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  await expect(card(page, 'portraits')).toContainText('Mine, not yet sent');
});

test.describe('version history', () => {
  test('shows the current plan first, with a summary on every row', async ({ page, server }) => {
    await server.seed({ plan: base() });
    await signInAndWaitForPlan(page);

    await page.locator('[data-action="menu"][data-menu="app"]').click();
    await page.locator('[data-menu-action="versions"]').click();
    await expect(page.locator('#versions-dialog')).toBeVisible();

    await expect(page.locator('.version-item--current')).toContainText('Current plan');
    await expect(page.locator('.version-item--current .version-summary')).toContainText('3 activities');

    await page.locator('#version-form input[name="name"]').fill('Before the venue call');
    await page.locator('#version-form button[type="submit"]').click();

    await expect(page.locator('.version-item[data-version-id]')).toHaveCount(1);
    await expect(page.locator('.version-item[data-version-id] .version-summary')).toContainText('3 activities');
  });

  test('restoring keeps a copy of what it replaced', async ({ page, server }) => {
    await server.seed({ plan: base() });
    await signInAndWaitForPlan(page);

    await page.locator('[data-action="menu"][data-menu="app"]').click();
    await page.locator('[data-menu-action="versions"]').click();
    await page.locator('#version-form input[name="name"]').fill('The good version');
    await page.locator('#version-form button[type="submit"]').click();
    await expect(page.locator('.version-item[data-version-id]')).toHaveCount(1);
    await page.locator('#versions-dialog .sheet-close').click();

    await rename(page, 'ready', 'A change I will regret');
    await saved(page);

    await page.locator('[data-action="menu"][data-menu="app"]').click();
    await page.locator('[data-menu-action="versions"]').click();
    await page.locator('.restore-version').click();

    await expect(card(page, 'ready')).toContainText('Getting Ready');
    const versions = await page.evaluate(async () => (await (await fetch('/api/versions')).json()).versions);
    expect(versions.some(version => /^Before restore/.test(version.name))).toBe(true);
  });

  test('deleting a version can be undone', async ({ page, server }) => {
    await server.seed({ plan: base() });
    await signInAndWaitForPlan(page);

    await page.locator('[data-action="menu"][data-menu="app"]').click();
    await page.locator('[data-menu-action="versions"]').click();
    await page.locator('#version-form input[name="name"]').fill('Delete me');
    await page.locator('#version-form button[type="submit"]').click();
    await expect(page.locator('.version-item[data-version-id]')).toHaveCount(1);

    await page.locator('.delete-version').click();
    await expect(page.locator('.version-item[data-version-id]')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Deleted Delete me');

    await page.locator('.toast-action').click();
    await expect(page.locator('.version-item[data-version-id]')).toHaveCount(1);
    await expect(page.locator('.version-item[data-version-id]')).toContainText('Delete me');
  });
});

test('the export endpoint hands back the plan as a file', async ({ page, request, baseURL, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const response = await page.request.get('/api/export');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('wedding-plan-2026-11-21.json');

  const body = await response.json();
  expect(body.activities).toHaveLength(3);
  expect(body.revision, 'a backup is the day, not the database').toBeUndefined();
});

test('signing out clears the copy on this device', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('wrp:v1:')))).toBe(true);

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="logout"]').click();
  await expect(page.locator('#login-form')).toBeVisible();

  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('wrp:v1:')))).toBe(false);
});

test('signing out also forgets the day-of switch this device was left on', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  // Turn the day-of view on by hand — a decision about one date on one device.
  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="day-of"]').click();
  await expect(page.locator('.live-strip')).toBeVisible();

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="logout"]').click();
  await expect(page.locator('#login-form')).toBeVisible();

  // The next person to sign in on this device gets the plan's own answer.
  await page.locator('#login-form input[name="password"]').fill(TEST_PASSWORD);
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#main-plan')).toBeVisible();
  await expect(page.locator('.live-strip')).toHaveCount(0);
});

test('F18: a plan stored in the old shape keeps its versions and its revision', async ({ page, server }) => {
  // The pre-split envelope: versions living inside the plan document.
  await server.seed({
    plan: base(),
    revision: 4,
    legacyEnvelope: true,
    versions: [
      { id: 'old-1', name: 'Before the venue call', createdAt: '2026-09-01T10:00:00.000Z', plan: base() }
    ]
  });

  await signInAndWaitForPlan(page);
  await expect(page.locator('.card')).toHaveCount(3);

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="versions"]').click();
  await expect(page.locator('.version-item[data-version-id]')).toContainText('Before the venue call');

  const stored = await server.read();
  expect('versions' in stored, 'the envelope no longer carries plan copies').toBe(false);
  expect(stored.revision, 'and nobody is handed a conflict by the move').toBe(4);
  expect(await server.readVersions()).toHaveLength(1);

  // And the plan still saves against the revision it had.
  await page.locator('#versions-dialog .sheet-close').click();
  await expect(page.locator('#versions-dialog')).toHaveCount(0);
  await rename(page, 'ready', 'Still works');
  await saved(page);
  expect((await server.read()).plan.activities[0].title).toBe('Still works');
});
