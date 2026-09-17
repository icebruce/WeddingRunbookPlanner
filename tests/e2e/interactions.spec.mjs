/**
 * Interaction polish: the behaviour that happens around and after a gesture
 * rather than during it — the toast, the sheet's own dismissal, the settle
 * after a committed change, and the scroll and viewport rules that hold the
 * rest of it together.
 */
import { test, expect, seedPlan, activity } from './fixtures.mjs';
import { isPhoneLayout, signInAndWaitForPlan } from './helpers.mjs';

const T = (h, m = 0) => h * 60 + m;

test('toast clears the selection toolbar', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Getting-ready Portraits', location: 'Bridal suite, top floor', people: ['Bride', 'Photographer', 'Planner', 'Videographer'] }),
    activity('b', T(12), 45, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await expect(page.locator('.toolbar')).toBeVisible();
  await page.locator('.toolbar [data-action="lock"]').click();

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  const t = await toast.boundingBox();
  const bar = await page.locator('.toolbar').boundingBox();
  // The toolbar is ~122 px tall once it carries a hidden-details line. The
  // toast used to sit at a fixed 96 px, tuned for the 58 px floating +, which
  // put it 44 px inside the toolbar.
  await expect(page.locator('.toolbar-hidden')).toHaveCount(1);
  expect(t.y + t.height).toBeLessThanOrEqual(bar.y);
});

test('toast pauses while hovered and resumes after', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="lock"]').click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.waitForTimeout(7000);
  await expect(toast).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(toast).toBeHidden({ timeout: 8000 });
});

test('a toast can be swiped away', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="lock"]').click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect(toast).toBeHidden({ timeout: 2000 });
});

test('a tap on Undo still undoes', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="lock"]').click();
  await expect(page.locator('.card.is-locked')).toHaveCount(1);
  await page.locator('.toast-action').click();
  await expect(page.locator('.card.is-locked')).toHaveCount(0);
});
