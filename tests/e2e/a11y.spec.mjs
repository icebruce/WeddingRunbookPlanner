import { test, expect, activity, seedPlan, TEST_PASSWORD } from './fixtures.mjs';
import { SCAN } from './a11y-scan.mjs';
import { isPhoneLayout, signIn, signInAndWaitForPlan } from './helpers.mjs';

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);

const plan = () => seedPlan({
  activities: [
    activity('ready', 45, { title: 'Getting Ready', location: 'Getting-ready location', people: ['Bride', 'Mothers'] }),
    activity('short', 5, { title: 'Bouquet handoff', people: ['Bride', 'Florist'] }),
    activity('travel', 200, { title: 'Travel to Church', location: 'St. Peter and Paul Orthodox Sobor' }),
    activity('ceremony', 60, { title: 'Ceremony', stage: 'ceremony', lockedStart: '14:45', notes: 'Rings', people: ['Bride', 'Groom'] }),
    activity('party', 180, { title: 'Dancing & Party', stage: 'party', people: ['All Guests'] })
  ]
});

/** Tabs forwards until the locator has focus, or gives up and says so. */
async function tabTo(page, locator, limit = 20) {
  for (let press = 0; press < limit; press += 1) {
    if (await locator.evaluate(node => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  expect(await locator.evaluate(node => node === document.activeElement), 'reachable by tabbing').toBe(true);
}

async function scan(page) {
  return page.evaluate(SCAN);
}

function report(problems) {
  return problems.map(problem => JSON.stringify(problem)).join('\n');
}

/** Each screen, in each theme. */
const THEMES = ['light', 'dark'];

async function setTheme(page, theme) {
  await page.evaluate(value => {
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem('wrp:theme', value); } catch { /* not required */ }
  }, theme);
}

for (const theme of THEMES) {
  test.describe(`${theme} appearance`, () => {
    test('the sign-in screen names its controls and meets contrast', async ({ page }) => {
      await page.goto('/');
      await setTheme(page, theme);
      await expect(page.locator('#login-form')).toBeVisible();

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('the planner names its controls and meets contrast', async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('a selected card, with its toolbar or controls, is readable', async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);
      await card(page, 'ready').click({ position: { x: 40, y: 10 } });
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('the editor is readable', async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);

      await card(page, 'ready').locator('.card-menu-toggle').click();
      await page.locator('.card-menu [data-action="edit"]').click();
      await expect(page.locator('#activity-dialog')).toBeVisible();
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('plan settings are readable', async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);

      await page.locator('[data-action="menu"][data-menu="app"]').click();
      await page.locator('[data-menu-action="settings"]').click();
      await expect(page.locator('#settings-dialog')).toBeVisible();
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('the menu is readable', async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);

      await page.locator('[data-action="menu"][data-menu="app"]').click();
      await expect(page.locator('.menu-popover')).toBeVisible();
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('the day-of view is readable', async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await page.clock.install({ time: new Date('2026-11-21T14:00:00') });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);
      await expect(page.locator('.live-strip')).toBeVisible();
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });

    test('the empty plan is readable', async ({ page, server }) => {
      await server.seed({ plan: seedPlan({ activities: [] }) });
      await signInAndWaitForPlan(page);
      await setTheme(page, theme);
      await page.waitForTimeout(250);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });
  });
}

test('a card tells a screen reader what it is without reading the layout', async ({ page, server }) => {
  await server.seed({ plan: plan() });
  await signInAndWaitForPlan(page);

  const label = await card(page, 'ceremony').getAttribute('aria-label');
  expect(label).toContain('Ceremony');
  expect(label).toContain('2:45 PM to 3:45 PM');
  expect(label).toContain('1 hr');
  expect(label).toContain('Ceremony');
  expect(label, 'colour is never the only signal').toContain('fixed');
});

test('a short card is still fully described, even though it shows one line', async ({ page, server }) => {
  await server.seed({ plan: plan() });
  await signInAndWaitForPlan(page);

  const label = await card(page, 'short').getAttribute('aria-label');
  expect(label).toContain('Bouquet handoff');
  expect(label).toContain('5 min');
  expect(label, 'the people the card had no room for').toContain('Florist');
});

test('every gesture has a way in from the keyboard alone', async ({ page, server, isMobile }) => {
  test.skip(Boolean(isMobile), 'this is the keyboard pass');
  await server.seed({ plan: plan() });
  await signInAndWaitForPlan(page);

  // Reach a card, select it, open it, and leave — without a pointer.
  await card(page, 'ready').focus();
  await page.keyboard.press('Enter');
  await expect(card(page, 'ready')).toHaveClass(/is-selected/);

  await page.keyboard.press('Enter');
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#activity-dialog')).toHaveCount(0);

  // And focus comes back where it started, not at the top of the page.
  await expect(card(page, 'ready')).toBeFocused();
});

/**
 * The whole job, without a pointer.
 *
 * The test above proves each gesture has a keyboard route. This one walks the
 * routes end to end, because a route that cannot be reached from the one
 * before it is not a route: signing in, finding a card, changing its length,
 * moving it, taking that back, renaming it, and getting into and out of the
 * menu — all with the keyboard.
 */
test('a whole plan can be changed with the keyboard alone', async ({ page, server, isMobile }) => {
  test.skip(Boolean(isMobile), 'this is the keyboard pass');
  await server.seed({ plan: plan() });

  // Sign in. Tab to the password field rather than clicking it.
  await page.goto('/');
  const password = page.locator('#login-form input[name="password"]');
  await expect(password).toBeVisible();
  await tabTo(page, password);
  await page.keyboard.type(TEST_PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-plan')).toBeVisible();

  // Tab forwards until a card has focus. The count is a ceiling, not an
  // expectation: what matters is that the timeline is reachable at all.
  let reached = null;
  for (let press = 0; press < 40 && !reached; press += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.closest?.('.card')?.dataset.activityId ?? null);
  }
  expect(reached, 'a card is reachable by tabbing').toBe('ready');

  // Select it, then reach its bottom handle and make it five minutes longer.
  await page.keyboard.press('Enter');
  await expect(card(page, 'ready')).toHaveClass(/is-selected/);
  await tabTo(page, card(page, 'ready').locator('.handle--bottom'));
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.activities[0].duration).toBe(50);

  // Move it down the day, and take that back.
  await card(page, 'ready').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.activities.map(item => item.id).slice(0, 2)).toEqual(['short', 'ready']);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.activities.map(item => item.id).slice(0, 2)).toEqual(['ready', 'short']);

  // Open it, rename it, and commit with Enter. Escape first, so that the two
  // presses below are select-then-open whatever was selected before.
  await page.keyboard.press('Escape');
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
  await card(page, 'ready').focus();
  await page.keyboard.press('Enter');
  await expect(card(page, 'ready')).toHaveClass(/is-selected/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#activity-dialog')).toBeVisible();

  const name = page.locator('#activity-dialog input[name="title"]');
  await name.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Hair and makeup');
  await page.keyboard.press('Enter');
  await expect(page.locator('#activity-dialog')).toHaveCount(0);
  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.activities[0].title).toBe('Hair and makeup');

  // Focus comes back to the card it came from, not to the top of the page.
  await expect(card(page, 'ready')).toBeFocused();

  // And the menu opens and closes without a pointer, handing focus back.
  await page.locator('[data-action="menu"][data-menu="app"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-popover')).toHaveCount(0);
  await expect(page.locator('[data-action="menu"][data-menu="app"]')).toBeFocused();
});

test('nothing is announced twice: only the toast and strip are live', async ({ page, server }) => {
  await server.seed({ plan: plan() });
  await signInAndWaitForPlan(page);

  const live = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')]
      .map(node => node.id || node.className || node.tagName));

  expect(live.some(name => String(name).includes('toast'))).toBe(true);
  expect(live.some(name => String(name) === 'app'), '#app is not a live region').toBe(false);
});

test.describe('widths', () => {
  const widths = [320, 390, 430, 740, 1024, 1440];

  for (const width of widths) {
    test(`${width} px lays out without spilling sideways`, async ({ page, server }) => {
      await server.seed({ plan: plan() });
      await page.setViewportSize({ width, height: 800 });
      await signInAndWaitForPlan(page);
      await page.waitForTimeout(250);

      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth
      }));
      expect(overflow.scroll, `content is wider than ${width} px`).toBeLessThanOrEqual(overflow.client + 1);

      // And exactly one add control, whichever layout this is.
      const header = await page.locator('.planner-add').isVisible();
      const floating = await page.locator('.mobile-add').isVisible();
      expect(header, `no add control at ${width} px`).not.toBe(floating);

      const problems = await scan(page);
      expect(problems, report(problems)).toEqual([]);
    });
  }

  test('a phone in landscape still works', async ({ page, server }) => {
    await server.seed({ plan: plan() });
    await page.setViewportSize({ width: 844, height: 390 });
    await signInAndWaitForPlan(page);

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  });
});
