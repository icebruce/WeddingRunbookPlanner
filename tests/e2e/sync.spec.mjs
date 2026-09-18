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

test('two devices editing different activities merge without asking', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'ready', 'Their activity');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  // A different card, so nothing either of them did is in dispute. The old
  // behaviour asked which of two whole days to keep and threw one away.
  await rename(page, 'travel', 'My activity');

  await expect(page.locator('#conflict-dialog')).toHaveCount(0);
  await saved(page);

  await expect(card(page, 'ready')).toContainText('Their activity');
  await expect(card(page, 'travel')).toContainText('My activity');

  const stored = (await server.read()).plan.activities;
  expect(stored[0].title).toBe('Their activity');
  expect(stored[2].title).toBe('My activity');
});

test('different fields of the same activity merge without asking', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'ready', 'Renamed by them');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  await openActivityEditor(page, card(page, 'ready'));
  await page.locator('#activity-dialog input[name="location"]').fill('The church');
  await page.locator('#activity-dialog button[type="submit"]').click();
  await expect(page.locator('#activity-dialog')).toHaveCount(0);

  await expect(page.locator('#conflict-dialog')).toHaveCount(0);
  await saved(page);

  const merged = (await server.read()).plan.activities[0];
  expect(merged.title).toBe('Renamed by them');
  expect(merged.location).toBe('The church');
});

test('a real conflict names the activity rather than offering two whole days', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'ready', 'Theirs');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  await rename(page, 'ready', 'Mine');

  await expect(page.locator('#conflict-dialog')).toBeVisible();
  await expect(page.locator('#conflict-dialog h2')).toContainText('You both changed');
});

test('an edit made offline survives the tab closing while still offline', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await context.setOffline(true);
  await rename(page, 'portraits', 'Typed with no signal');
  await expect(page.locator('.save-indicator')).toHaveText('Offline');

  // The tab goes away while there is still no connection, so the keepalive
  // send on the way out cannot land either. The device copy is the only place
  // this edit exists. Reopening with a signal used to drop it without a word.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await context.setOffline(false);
  await page.reload();

  await expect(card(page, 'portraits')).toContainText('Typed with no signal');
  await saved(page);
  expect((await server.read()).plan.activities[1].title).toBe('Typed with no signal');
});

test('an offline edit still merges when the other device moved on meanwhile', async ({ page, context, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await context.setOffline(true);
  await rename(page, 'portraits', 'Typed with no signal');
  await expect(page.locator('.save-indicator')).toHaveText('Offline');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

  // While this device was away, the other one saved a different activity.
  await context.setOffline(false);
  const other = await context.newPage();
  await openPlanner(other);
  await rename(other, 'ready', 'Moved on without me');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  await page.reload();

  await expect(card(page, 'portraits')).toContainText('Typed with no signal');
  await expect(card(page, 'ready')).toContainText('Moved on without me');
  await saved(page);

  const stored = (await server.read()).plan.activities;
  expect(stored[0].title).toBe('Moved on without me');
  expect(stored[1].title).toBe('Typed with no signal');
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
  await page.locator('[data-choice="mine"]').click();

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
  await page.locator('[data-choice="theirs"]').click();

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
    // Named rather than "the only one": the first save of a plan also keeps an
    // automatic backup of what it replaced, so there are two rows by now.
    await page.locator('.version-item', { hasText: 'The good version' }).locator('.restore-version').click();

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

test('editing a plan leaves an automatic backup of what it replaced', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await rename(page, 'ready', 'Changed my mind later');
  await saved(page);

  const versions = await page.evaluate(async () => (await (await fetch('/api/versions')).json()).versions);
  const backup = versions.find(version => version.name === 'Automatic backup');
  expect(backup, 'a backup was kept without anyone asking').toBeTruthy();
  expect(backup.auto).toBe(true);

  // It holds the plan as it was before the edit, which is the point of it.
  const restored = await page.evaluate(async id =>
    (await (await fetch(`/api/versions?id=${id}`)).json()).version.plan, backup.id);
  expect(restored.activities[0].title).toBe('Getting Ready');
});

test('a run of edits does not fill version history', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  for (const title of ['One', 'Two', 'Three', 'Four']) {
    await rename(page, 'ready', title);
    await saved(page);
  }

  const versions = await page.evaluate(async () => (await (await fetch('/api/versions')).json()).versions);
  const backups = versions.filter(version => version.name === 'Automatic backup');
  expect(backups.length, 'four saves inside one window is one backup, not four').toBe(1);
});
