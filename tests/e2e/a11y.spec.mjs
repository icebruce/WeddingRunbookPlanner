import { test, expect, activity, seedPlan } from './fixtures.mjs';
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
