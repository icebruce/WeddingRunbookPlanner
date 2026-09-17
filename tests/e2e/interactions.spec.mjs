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

test('the page does not chain its overscroll to the browser', async ({ page }) => {
  await signInAndWaitForPlan(page);
  const value = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY);
  expect(value).toBe('contain');
});

test('the sticky inset counts every bar that is actually showing', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits', people: ['Bride', 'Photographer'] }),
    activity('b', T(12), 60, { title: 'Ceremony', people: ['Bride'] })
  ] }) });
  await signInAndWaitForPlan(page);

  const read = () => page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-inset')));
  const bare = await read();
  const topbar = await page.locator('.topbar').evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(bare - topbar)).toBeLessThanOrEqual(1);

  // Turning a filter on pins a second bar under the first one.
  await page.locator('.filter-chip', { hasText: 'Photographer' }).click();
  await expect(page.locator('.pinned-bar--filter')).toBeVisible();
  const withFilter = await read();
  const bar = await page.locator('.pinned-bar--filter').evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(withFilter - (topbar + bar))).toBeLessThanOrEqual(1);
});

test('a card tabbed onto lands clear of the sticky bars', async ({ page, server }) => {
  const many = Array.from({ length: 14 }, (_, i) => activity(`a${i}`, T(8) + i * 60, 45, { title: `Activity ${i}` }));
  await server.seed({ plan: seedPlan({ activities: many }) });
  await signInAndWaitForPlan(page);

  // Scroll deep into the day, then move focus to a card above the fold.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  await page.locator('.card[data-activity-id="a3"]').evaluate(node => node.focus());
  await page.waitForTimeout(200);

  const { cardTop, barBottom } = await page.evaluate(() => ({
    cardTop: document.querySelector('.card[data-activity-id="a3"]').getBoundingClientRect().top,
    barBottom: document.querySelector('.topbar').getBoundingClientRect().bottom
  }));
  expect(cardTop).toBeGreaterThanOrEqual(barBottom);
});

test('the chip row fades only the side that has more', async ({ page, server }) => {
  const people = ['Bride', 'Groom', 'Photographer', 'Videographer', 'Planner', 'Celebrant', 'Florist', 'Caterer'];
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits', people })] }) });
  await signInAndWaitForPlan(page);

  // The contract is the invariant, not a fixed answer: eight chips overflow a
  // phone and fit a desktop, and the fade has to be right either way.
  const row = page.locator('.filter-chips');
  const read = () => row.evaluate(node => ({
    overflows: node.scrollWidth > node.clientWidth + 1,
    before: node.classList.contains('has-more-before'),
    after: node.classList.contains('has-more-after')
  }));

  const atStart = await read();
  expect(atStart.before).toBe(false);
  expect(atStart.after).toBe(atStart.overflows);

  await row.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await page.waitForTimeout(150);
  const atEnd = await read();
  expect(atEnd.before).toBe(atEnd.overflows);
  expect(atEnd.after).toBe(false);
});

test('a chip row that fits gets no false edge', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits', people: ['Bride'] })] }) });
  await signInAndWaitForPlan(page);
  const row = page.locator('.filter-chips');
  await expect(row).not.toHaveClass(/has-more-after/);
  await expect(row).not.toHaveClass(/has-more-before/);
});

test('the sheet lifts above the on-screen keyboard', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();

  const restingBottom = await page.locator('.sheet').evaluate(n => n.getBoundingClientRect().bottom);

  // Playwright cannot raise a real keyboard, so the visual viewport is shrunk
  // the way one does and the resize event is fired by hand.
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 300 });
    vv.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(150);

  const inset = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')));
  expect(inset).toBe(300);
  const liftedBottom = await page.locator('.sheet').evaluate(n => n.getBoundingClientRect().bottom);
  expect(restingBottom - liftedBottom).toBeGreaterThanOrEqual(295);
});

test('a fast load shows nothing at all, and a slow one shows a skeleton', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });

  // Hold the plan back so the skeleton has a reason to appear.
  await page.route('**/api/plan*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await signInAndWaitForPlan(page).catch(() => {});
  await page.goto('/');

  // Nothing for the first 400 ms — a load that quick should look instant.
  await page.waitForTimeout(150);
  expect(await page.locator('.skeleton-card').count()).toBe(0);

  await expect(page.locator('.skeleton-card').first()).toBeVisible({ timeout: 2000 });
  expect(await page.locator('.skeleton-card').count()).toBe(3);
  // It is three cards at their real rest heights, not three identical bars.
  const heights = await page.locator('.skeleton-card').evaluateAll(
    nodes => nodes.map(n => Math.round(n.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBeGreaterThan(1);

  await page.unroute('**/api/plan*');
});

test('the saving dot does not pulse', async ({ page }) => {
  await signInAndWaitForPlan(page);
  const name = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'save-indicator save-indicator--saving';
    const dot = document.createElement('span');
    dot.className = 'save-dot';
    probe.append(dot);
    document.body.append(probe);
    const value = getComputedStyle(dot).animationName;
    probe.remove();
    return value;
  });
  expect(name).toBe('none');
});

test('a failure during the saving hold is not masked by a stale Saved', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);

  await page.route('**/api/plan', route =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' })
      : route.continue());

  await page.locator('.card').first().click();
  await page.locator(isPhoneLayout(page) ? '.toolbar [data-action="lock"]' : '.card .lock-button').first().click();

  // Whatever the indicator does in between, it must land on the truth.
  await expect(page.locator('.save-indicator--not-saved')).toBeVisible({ timeout: 10_000 });
  await page.unroute('**/api/plan');
});
