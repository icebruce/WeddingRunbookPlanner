import { test, expect } from './fixtures.mjs';
import { failRequests, openActivityEditor, signInAndWaitForPlan } from './helpers.mjs';

const firstCard = page => page.locator('.activity-row').first();

test('F14: toggling a lock keeps focus on the button that was pressed', async ({ page }) => {
  await signInAndWaitForPlan(page);

  const lock = firstCard(page).locator('.lock-button');
  await lock.focus();
  await page.keyboard.press('Enter');

  await expect(firstCard(page).locator('.lock-button')).toBeFocused();
  await expect(page.locator('body')).not.toBeFocused();
  // The plan really did change, so this is not a repaint that never happened.
  await expect(firstCard(page).locator('.lock-button')).toHaveAttribute('aria-pressed', 'true');
});

test('F14: a repaint does not move focus out of the field being typed in', async ({ page }) => {
  await signInAndWaitForPlan(page);

  const status = page.locator('[data-action="status"]');
  await status.focus();
  await status.selectOption('Confirming');

  await expect(page.locator('[data-action="status"]')).toBeFocused();
  await expect(page.locator('[data-action="status"]')).toHaveValue('Confirming');
});

test('F14: a save landing in the background does not rebuild an open sheet', async ({ page }) => {
  await signInAndWaitForPlan(page);

  // Slow the save down so it is still in flight while the sheet is open.
  await failRequests(page, { url: '**/api/plan', method: 'PUT', status: 200, times: 1, delayMs: 1500, body: { revision: 2, updatedAt: null } });
  await firstCard(page).locator('.lock-button').click();

  await openActivityEditor(page, page.locator('.activity-row').nth(2));
  const dialog = page.locator('#activity-dialog');

  await dialog.locator('input[name="location"]').fill('Half-typed while saving');
  await page.waitForTimeout(2500);

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="location"]')).toHaveValue('Half-typed while saving');
});

test('the stage menu closes once a stage is picked', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await firstCard(page).locator('.stage-pill--button').click();
  await expect(firstCard(page).locator('.stage-menu')).toBeVisible();

  await firstCard(page).locator('[data-action="set-stage"][data-stage="ceremony"]').click();
  await expect(page.locator('.stage-menu')).toHaveCount(0);
  await expect(firstCard(page).locator('.stage-pill--button')).toContainText('Ceremony');
});

test('F26: Escape closes every menu and returns focus to what opened it', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await expect(page.locator('.menu-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-popover')).toHaveCount(0);
  await expect(page.locator('[data-action="menu"][data-menu="app"]')).toBeFocused();

  await firstCard(page).locator('.stage-pill--button').click();
  await expect(page.locator('.stage-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.stage-menu')).toHaveCount(0);

  await firstCard(page).locator('.card-menu-toggle').click();
  await expect(page.locator('.card-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card-menu')).toHaveCount(0);
});

test('F26: a click elsewhere closes an open menu', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await expect(page.locator('.menu-popover')).toBeVisible();

  await page.locator('.planner-heading h1').click();
  await expect(page.locator('.menu-popover')).toHaveCount(0);
});

test('F20: a person typed but not added is kept on Done', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  await openActivityEditor(page, firstCard(page));
  const dialog = page.locator('#activity-dialog');
  await dialog.locator('.people-add-trigger').click();
  await dialog.locator('.people-add-input').fill('Hair stylist');
  // Deliberately no Enter: this is the case that used to lose the name.
  await dialog.locator('button[type="submit"]').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.activities[0].people).toContain('Hair stylist');
});

test('a person added with Enter is kept too, and duplicates are ignored', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  await openActivityEditor(page, firstCard(page));
  const dialog = page.locator('#activity-dialog');
  await dialog.locator('.people-add-trigger').click();
  await dialog.locator('.people-add-input').fill('Florist');
  await dialog.locator('.people-add-input').press('Enter');
  await dialog.locator('.people-add-input').fill('florist');
  await dialog.locator('button[type="submit"]').click();

  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  const people = (await server.read()).plan.activities[0].people;
  expect(people.filter(person => person.toLowerCase() === 'florist')).toHaveLength(1);
});

test('F19: a fixed time off the 5-minute grid rounds up, with no browser message', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  await openActivityEditor(page, firstCard(page));
  const dialog = page.locator('#activity-dialog');
  // The checkbox is visually replaced by the switch, so the switch is what a
  // person clicks.
  await dialog.locator('.switch').click();
  await expect(dialog.locator('#lock-toggle')).toBeChecked();
  await dialog.locator('input[name="lockedStart"]').fill('14:47');

  // The browser must not be the one objecting: no step attribute, no bubble.
  await expect(dialog.locator('input[name="lockedStart"]')).not.toHaveAttribute('step', /.*/);
  const valid = await dialog.locator('#activity-form').evaluate(form => form.checkValidity());
  expect(valid).toBe(true);

  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.save-indicator')).toHaveText('Saved');

  expect((await server.read()).plan.activities[0].lockedStart).toBe('14:50');
  await expect(firstCard(page)).toContainText('2:50 PM');
});

test('F19: a typed duration rounds up instead of being refused', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  await openActivityEditor(page, firstCard(page));
  const dialog = page.locator('#activity-dialog');
  await dialog.locator('input[name="duration"]').fill('42');
  await dialog.locator('button[type="submit"]').click();

  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.activities[0].duration).toBe(45);
});

test('F21: people are shown by name, never as initials', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await expect(firstCard(page).locator('.person-display-tag').first()).toHaveText('Bride');
  await expect(page.locator('.person-avatar')).toHaveCount(0);
  await expect(page.locator('.people-more')).toHaveCount(0);
});

test('the toast region is the only live region, and #app is not one', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await expect(page.locator('#app')).not.toHaveAttribute('aria-live', /.*/);
  await expect(page.locator('#toast-region')).toHaveAttribute('role', 'status');
});

test('an activity added from the card menu is placed after the selected card', async ({ page, server }) => {
  await signInAndWaitForPlan(page);

  await page.locator('.activity-row').nth(1).locator('.activity-card').click();
  // Two add controls exist in the markup; only one is shown at a given width.
  await page.locator('[data-action="add"]:visible').click();

  const dialog = page.locator('#activity-dialog');
  await dialog.locator('input[name="title"]').fill('Second look');
  await dialog.locator('button[type="submit"]').click();

  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  const ids = (await server.read()).plan.activities.map(activity => activity.title);
  expect(ids[2]).toBe('Second look');
});

test('closing a sheet returns focus to the control that opened it', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="settings"]').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toHaveCount(0);
  await expect(page.locator('[data-action="menu"][data-menu="app"]')).toBeFocused();
});

test('a card opens its editor and gets focus back when the sheet closes', async ({ page }) => {
  await signInAndWaitForPlan(page);

  const row = page.locator('.activity-row').nth(1);
  await openActivityEditor(page, row);

  await page.locator('#activity-dialog .sheet-close').click();
  await expect(page.locator('#activity-dialog')).toHaveCount(0);
  await expect(page.locator('.activity-row').nth(1).locator('.activity-card')).toBeFocused();
});

test('exactly one add control is offered, and the header one says where it lands', async ({ page }) => {
  await signInAndWaitForPlan(page);

  // The wide layout puts the button in the header with a note about where the
  // new activity goes; the narrow one uses the floating +. Never both.
  const header = page.locator('.planner-add');
  const floating = page.locator('.mobile-add');
  const headerVisible = await header.isVisible();

  expect(headerVisible).not.toBe(await floating.isVisible());
  if (headerVisible) {
    await expect(page.locator('.add-hint')).toBeVisible();
    await expect(page.locator('.add-hint')).toHaveText('Adds after the selected activity');
  } else {
    await expect(page.locator('.add-hint')).toBeHidden();
  }
});

test('F26: Escape on a card menu returns focus to the button that opened it', async ({ page }) => {
  await signInAndWaitForPlan(page);

  const toggle = page.locator('.activity-row').first().locator('.card-menu-toggle');
  await toggle.click();
  await expect(page.locator('.card-menu')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.card-menu')).toHaveCount(0);
  await expect(page.locator('.activity-row').first().locator('.card-menu-toggle')).toBeFocused();
});

test('F26: Escape on the stage menu returns focus to the stage tag', async ({ page }) => {
  await signInAndWaitForPlan(page);

  const tag = page.locator('.activity-row').first().locator('.stage-pill--button');
  await tag.click();
  await expect(page.locator('.stage-menu')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.stage-menu')).toHaveCount(0);
  await expect(page.locator('.activity-row').first().locator('.stage-pill--button')).toBeFocused();
});

test('double-click opens the editor where there is a mouse', async ({ page, isMobile }) => {
  // On a touch device this gesture does not exist; the phone opens the editor
  // with a long press, which arrives with the direct manipulation stage.
  test.skip(Boolean(isMobile), 'double-click is a pointer gesture');
  await signInAndWaitForPlan(page);

  await firstCard(page).locator('.activity-card').dblclick();
  await expect(page.locator('#activity-dialog')).toBeVisible();
});
