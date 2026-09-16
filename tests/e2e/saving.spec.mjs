import { test, expect } from './fixtures.mjs';
import { countRequests, failRequests, openActivityEditor, openPlanner, signInAndWaitForPlan, trackToasts } from './helpers.mjs';

/** Rename the first activity — a small, always-valid change that triggers a save. */
async function renameFirstActivity(page, title) {
  await openActivityEditor(page, page.locator('.card').first());
  const dialog = page.locator('#activity-dialog');
  await dialog.locator('input[name="title"]').fill(title);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
}

const saveState = page => page.locator('.save-indicator');

test('a change is saved and the header says so', async ({ page, server }) => {
  await signInAndWaitForPlan(page);
  await renameFirstActivity(page, 'Hair and makeup');

  await expect(saveState(page)).toHaveText('Saved');
  const stored = await server.read();
  expect(stored.plan.activities[0].title).toBe('Hair and makeup');
  expect(stored.revision).toBe(2);
});

test('F1: editing offline makes a bounded number of requests and one message', async ({ page, context }) => {
  await signInAndWaitForPlan(page);

  const seen = await countRequests(page, { url: '**/api/plan', method: 'PUT' });
  const toasts = await trackToasts(page);
  await context.setOffline(true);
  await renameFirstActivity(page, 'Edited while offline');

  await expect(saveState(page)).toHaveText('Offline');
  await page.waitForTimeout(10_000);

  expect(seen.count, `saw ${seen.count} save requests in 10 s`).toBeLessThanOrEqual(3);
  expect(await toasts.errorCount(), 'one message per failure episode, not one per attempt').toBe(1);
  // The edit is still on screen; nothing was rolled back.
  await expect(page.locator('.card').first()).toContainText('Edited while offline');
});

test('offline edits save when the connection comes back', async ({ page, context, server }) => {
  await signInAndWaitForPlan(page);
  await context.setOffline(true);
  await renameFirstActivity(page, 'Saved after reconnecting');
  await expect(saveState(page)).toHaveText('Offline');

  await context.setOffline(false);
  await expect(saveState(page)).toHaveText('Saved', { timeout: 15_000 });

  const stored = await server.read();
  expect(stored.plan.activities[0].title).toBe('Saved after reconnecting');
});

test('F1: a server error shows Not saved and backs off instead of flooding', async ({ page }) => {
  await signInAndWaitForPlan(page);
  const toasts = await trackToasts(page);
  const seen = await failRequests(page, { url: '**/api/plan', method: 'PUT', status: 500 });

  await renameFirstActivity(page, 'Server is unhappy');
  await expect(saveState(page)).toHaveText('Not saved');

  await page.waitForTimeout(8_000);
  expect(seen.count, `saw ${seen.count} save attempts in 8 s`).toBeLessThanOrEqual(3);
  expect(await toasts.errorCount()).toBe(1);
});

test('Not saved is tappable and retries', async ({ page, server }) => {
  await signInAndWaitForPlan(page);
  await failRequests(page, { url: '**/api/plan', method: 'PUT', status: 500, times: 1 });

  await renameFirstActivity(page, 'Retried by hand');
  await expect(saveState(page)).toHaveText('Not saved');

  await saveState(page).click();
  await expect(saveState(page)).toHaveText('Saved');
  expect((await server.read()).plan.activities[0].title).toBe('Retried by hand');
});

test('F2: an invalid change is blocked in the sheet and never reaches the server', async ({ page, server }) => {
  await signInAndWaitForPlan(page);
  const seen = await countRequests(page, { url: '**/api/plan', method: 'PUT' });

  await openActivityEditor(page, page.locator('.card').first());
  const dialog = page.locator('#activity-dialog');
  await dialog.locator('input[name="title"]').fill('   ');
  await dialog.locator('button[type="submit"]').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.field-error')).toHaveText("Name can't be empty.");
  await expect(dialog.locator('input[name="title"]')).toHaveAttribute('aria-invalid', 'true');
  expect(seen.count).toBe(0);
  expect((await server.read()).revision).toBe(1);
});

test('F2: a rejected save does not block later valid edits', async ({ page, server }) => {
  await signInAndWaitForPlan(page);
  // The server rejects the first save; the client must not retry it forever.
  const seen = await failRequests(page, {
    url: '**/api/plan',
    method: 'PUT',
    status: 400,
    times: 1,
    body: { error: { code: 'required', message: "Name can't be empty.", field: 'title' } }
  });

  const toasts = await trackToasts(page);
  await renameFirstActivity(page, 'First attempt');
  await expect(saveState(page)).toHaveText('Not saved');
  expect((await toasts.errors()).join(' ')).toContain("Name can't be empty.");

  await page.waitForTimeout(6_000);
  expect(seen.count, 'invalid data is not retried on a timer').toBe(1);

  await renameFirstActivity(page, 'Second attempt');
  await expect(saveState(page)).toHaveText('Saved');
  expect((await server.read()).plan.activities[0].title).toBe('Second attempt');
});

test('F10: a session that expires mid-edit keeps the change and saves it after signing in', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  const expired = await failRequests(page, {
    url: '**/api/plan',
    method: 'PUT',
    status: 401,
    times: 1,
    body: { error: { code: 'unauthenticated', message: 'Sign in to open the plan.' } }
  });

  await renameFirstActivity(page, 'Typed before the session expired');
  await expect(page.locator('#login-form')).toBeVisible();
  expect(expired.count).toBe(1);

  await page.locator('#login-form input[name="password"]').fill('e2e-password-987');
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('.timeline-grid')).toBeVisible();
  await expect(saveState(page)).toHaveText('Saved', { timeout: 10_000 });
  expect((await server.read()).plan.activities[0].title).toBe('Typed before the session expired');
});

test('F3: two devices saving at once — one wins, the other is told', async ({ page, context, server }) => {
  await signInAndWaitForPlan(page);

  const second = await context.newPage();
  await openPlanner(second);

  // Both tabs hold revision 1. The first save takes it; the second must not
  // silently overwrite.
  await renameFirstActivity(page, 'Device A wins');
  await expect(saveState(page)).toHaveText('Saved');

  await renameFirstActivity(second, 'Device B loses');
  await expect(second.locator('#conflict-dialog')).toBeVisible();

  const stored = await server.read();
  expect(stored.plan.activities[0].title).toBe('Device A wins');
  expect(stored.revision).toBe(2);
});

test('F12: "Keep my changes" saves the plan as it is now, not a stale snapshot', async ({ page, context, server }) => {
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await renameFirstActivity(other, 'From the other device');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  // Hold the first save open until the second change has been typed. Those are
  // the changes "Keep my changes" has to mean: the ones made after the save
  // that is about to be refused was already on its way.
  //
  // Held until released rather than for a fixed time: how long a rename takes
  // is a property of the engine, and a sleep long enough for one is short
  // enough for another — the refusal used to arrive mid-rename on WebKit and
  // the dialog swallowed the click.
  let inFlight = false;
  let release;
  const heldUntil = new Promise(resolve => { release = resolve; });
  await page.route('**/api/plan', async (route, request) => {
    if (request.method() === 'PUT' && !inFlight) {
      inFlight = true;
      await heldUntil;
    }
    await route.fallback();
  });

  await renameFirstActivity(page, 'Mine, typed first');
  await expect.poll(() => inFlight, { timeout: 10_000 }).toBe(true);
  await renameFirstActivity(page, 'Mine, typed while saving');
  release();

  await expect(page.locator('#conflict-dialog')).toBeVisible();
  await page.locator('[data-action="conflict"][data-choice="local"]').click();

  await expect(saveState(page)).toHaveText('Saved', { timeout: 10_000 });
  expect((await server.read()).plan.activities[0].title).toBe('Mine, typed while saving');
});

test('a conflict with no other version offers a retry, not two dead buttons', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  // The store answers 409 with nothing to compare against — what happens when
  // the record is gone by the time the write lands. The dialog used to open
  // anyway, and both of its buttons returned without doing anything.
  let refuse = true;
  await page.route('**/api/plan', async (route, request) => {
    if (request.method() === 'PUT' && refuse) {
      refuse = false;
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'revision_conflict', message: 'The plan store was empty.' } })
      });
    }
    await route.fallback();
  });

  await renameFirstActivity(page, 'Typed into an empty store');

  await expect(page.locator('#conflict-dialog')).toHaveCount(0);
  await expect(saveState(page)).toHaveText('Not saved');

  // The work is still here, and the retry is a real one.
  await expect(page.locator('.card').first()).toContainText('Typed into an empty store');
  await page.locator('[data-action="save-retry"]').click();
  await expect(saveState(page)).toHaveText('Saved', { timeout: 10_000 });
  expect((await server.read()).plan.activities[0].title).toBe('Typed into an empty store');
});

test('the conflict dialog blocks editing until it is answered', async ({ page, context }) => {
  await signInAndWaitForPlan(page);

  const other = await context.newPage();
  await openPlanner(other);
  await renameFirstActivity(other, 'Theirs');
  await expect(other.locator('.save-indicator')).toHaveText('Saved');

  await renameFirstActivity(page, 'Mine');
  await expect(page.locator('#conflict-dialog')).toBeVisible();

  // Nothing behind the dialog can be reached: the plan is not edited further
  // until it is settled which copy the day carries on from. The control is
  // still drawn — it is the modal dialog above it that makes it unreachable,
  // so the test is whether it can be pressed, not whether it is painted.
  const reachable = await page.locator('.card').first().locator('.card-edit')
    .click({ timeout: 1500 }).then(() => true).catch(() => false);
  expect(reachable).toBe(false);
  await expect(page.locator('#activity-dialog')).toHaveCount(0);
});

test('F27: a session check that fails offers Retry, not the sign-in screen', async ({ page }) => {
  await page.route('**/api/session', route => route.abort('failed'));
  await page.goto('/');

  await expect(page.locator('.fatal-view h1')).toHaveText("Can't load the plan right now");
  await expect(page.locator('#login-form')).toHaveCount(0);

  await page.unroute('**/api/session');
  await page.locator('[data-action="retry-load"]').click();
  await expect(page.locator('#login-form')).toBeVisible();
});

test('a plan that cannot be loaded never shows as an empty timeline', async ({ page, context }) => {
  await signInAndWaitForPlan(page);
  // No copy on this device, and no plan from the server: the only honest
  // thing to show is that it could not be loaded.
  await context.clearCookies({ name: 'nothing' }).catch(() => {});
  await page.evaluate(() => localStorage.clear());
  await page.route('**/api/plan', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"server_error","message":"nope"}}' }));

  await page.reload();
  await expect(page.locator('.fatal-view')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
});
