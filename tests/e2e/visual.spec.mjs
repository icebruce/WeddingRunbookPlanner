/*
 * Visual baselines for the mockup scenarios.
 *
 * One picture per figure in docs/mockups, phone and desktop, light and dark.
 * These are not run by default and are not run in CI: a screenshot is only
 * comparable against another screenshot taken by the same browser build on the
 * same operating system with the same fonts, and this project's CI installs
 * browsers onto whatever image GitHub is shipping that week. Recording the
 * baselines somewhere else than they are compared produces a red pipeline that
 * says nothing about the app.
 *
 *   VISUAL=1 npx playwright test visual --update-snapshots   # record
 *   VISUAL=1 npx playwright test visual                      # compare
 *
 * Re-record whenever the browser, the image or the fonts change.
 *
 * Each shot is the screen, not the whole scroll. That is what the mockups draw,
 * and a full-page capture of a page with a sticky bar on it is not repeatable:
 * the bar swaps the brand for the collapsed title from an IntersectionObserver,
 * and whether it has reported by the time the shutter falls is a race.
 */
import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { isPhoneLayout, signInAndWaitForPlan } from './helpers.mjs';

/*
 * The mockups draw a phone and a desktop, so those are the two that have
 * baselines. pixel-7 and ipad are covered by the rest of the suite; another
 * three hundred images of the same screens would be three hundred more to
 * re-record every time a font moves.
 */
const PHOTOGRAPHED = new Set(['desktop-chrome', 'iphone-13']);

test.beforeEach(({}, testInfo) => {
  testInfo.skip(!process.env.VISUAL, 'visual baselines are recorded and compared by hand (VISUAL=1)');
  testInfo.skip(!PHOTOGRAPHED.has(testInfo.project.name), 'the mockups are phone and desktop');
});

test.describe.configure({ mode: 'parallel' });

const DATE = '2026-11-21';
const at = (hours, minutes = 0, day = 21) =>
  new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);

const T = (h, m = 0) => h * 60 + m;

/** The day the mockups draw. */
const plan = (extra = {}) => seedPlan({
  date: DATE,
  sunset: '16:19',
  activities: [
    activity('ready', T(11, 30), 45, { title: 'Getting Ready', stage: 'preparation', location: 'Home', people: ['Bride', 'Mothers'] }),
    activity('bouquet', T(12, 15), 5, { title: 'Bouquet handoff', stage: 'preparation', people: ['Bride', 'Florist'] }),
    activity('portraits', T(12, 20), 30, { title: 'Getting-ready Portraits', stage: 'photography', people: ['Bride', 'Photographer'] }),
    activity('travel', T(13, 25), 35, { title: 'Travel to Church', stage: 'transition', location: 'St. Peter and Paul Sobor' }),
    activity('ceremony', T(14, 45), 60, { title: 'Ceremony', stage: 'ceremony', locked: true, people: ['Bride', 'Groom', 'All Guests'] }),
    activity('party', T(15, 45), 120, { title: 'Dancing & Party', stage: 'party', people: ['All Guests'] })
  ],
  ...extra
});

/** Travel runs long enough to reach the fixed ceremony. */
const clash = () => {
  const day = plan();
  day.activities = day.activities.map(item => item.id === 'travel' ? { ...item, duration: 200 } : item);
  return day;
};

async function open(page, server, { plan: seed = plan(), theme, clock } = {}) {
  await server.seed({ plan: seed });
  // The theme is read from this device before the first paint, so it has to be
  // there before the page loads rather than set once it is on screen.
  await page.addInitScript(value => {
    try { localStorage.setItem('wrp:theme', value); } catch { /* not required */ }
  }, theme);
  if (clock) await page.clock.install({ time: clock });
  await signInAndWaitForPlan(page);
}

/*
 * A screenshot taken while a save is in flight catches "Saving…" in the top
 * bar, and whether it is still there when the shutter falls is a race. Every
 * scene waits for the save state to settle first.
 */
async function settle(page) {
  const indicator = page.locator('.save-indicator');
  if (await indicator.count()) await expect(indicator).toHaveText(/Saved|Offline|Not saved/);

  // The top bar swaps the brand for the collapsed title from an
  // IntersectionObserver, which reports after the scroll rather than with it.
  // Shooting before it has reported catches whichever of the two got there
  // first, which is not a property of the app.
  await expect.poll(() => page.evaluate(() => {
    const heading = document.querySelector('.planner-heading h1');
    const topbar = document.querySelector('.topbar');
    if (!heading || !topbar) return true;
    const bar = topbar.getBoundingClientRect().height;
    const rect = heading.getBoundingClientRect();
    const underTheBar = rect.bottom <= bar || rect.top >= window.innerHeight;
    return topbar.classList.contains('is-collapsed') === underTheBar;
  })).toBe(true);
}

const appMenu = async page => {
  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await expect(page.locator('.menu-popover')).toBeVisible();
};


/*
 * Each scene is one figure. `phone` and `desktop` say where the mockups show
 * it, because several of them — the toolbar, the action sheet — only exist in
 * one of the two layouts.
 */
const SCENES = [
  {
    name: 'planning-at-rest',
    async run() { /* the plan as it loads */ }
  },
  {
    name: 'planning-selected',
    async run(page) {
      await card(page, 'portraits').click({ position: { x: 40, y: 10 } });
      await expect(card(page, 'portraits')).toHaveClass(/is-selected/);
    }
  },
  {
    name: 'planning-scrolled',
    async run(page) {
      await page.evaluate(() => window.scrollTo(0, 420));
      await expect(page.locator('.topbar.is-collapsed')).toBeVisible();
    }
  },
  {
    name: 'planning-filtered',
    async run(page) {
      await page.locator('.filter-chip', { hasText: 'Photographer' }).click();
      await expect(page.locator('.pinned-bar--filter')).toBeVisible();
    }
  },
  {
    name: 'editing-sheet',
    async run(page) {
      await card(page, 'portraits').locator('.card-edit').click();
      await expect(page.locator('#activity-dialog')).toBeVisible();
    }
  },
  {
    name: 'editing-stage-menu',
    async run(page) {
      await card(page, 'portraits').click({ position: { x: 40, y: 10 } });
      await page.locator('.stage-tag--button').first().click();
      await expect(page.locator('.stage-menu')).toBeVisible();
    }
  },
  {
    name: 'editing-open-time',
    async run(page) {
      await page.locator('.open-time-add').first().click();
      await expect(page.locator('#open-time-dialog')).toBeVisible();
    }
  },
  {
    name: 'editing-conflict',
    plan: clash,
    async run(page) {
      await expect(page.locator('.card.is-overlap').first()).toBeVisible();
    }
  },
  {
    name: 'menu',
    async run(page) { await appMenu(page); }
  },
  {
    name: 'day-of-view-only',
    clock: at(13, 20),
    async run(page) {
      await expect(page.locator('.live-strip')).toBeVisible();
    }
  },
  {
    name: 'day-of-editing',
    clock: at(13, 20),
    async run(page) {
      await page.locator('[data-action="day-of-edit"]').click();
      await expect(page.locator('.mode-pill--editing')).toBeVisible();
    }
  },
  {
    name: 'empty-plan',
    plan: () => seedPlan({ date: DATE, activities: [] }),
    async run(page) {
      await expect(page.locator('.empty-plan')).toBeVisible();
    }
  },
  {
    name: 'plan-settings',
    async run(page) {
      await appMenu(page);
      await page.locator('[data-menu-action="settings"]').click();
      await expect(page.locator('#settings-dialog')).toBeVisible();
    }
  },
  {
    name: 'version-history',
    async run(page) {
      await appMenu(page);
      await page.locator('[data-menu-action="versions"]').click();
      await expect(page.locator('#versions-dialog')).toBeVisible();
    }
  },
  {
    name: 'offline',
    async run(page) {
      await page.context().setOffline(true);
      await card(page, 'portraits').click({ position: { x: 40, y: 10 } });
      await page.locator('[data-action="lock"]').first().click();
      await expect(page.locator('.pinned-bar--offline')).toBeVisible();
      await page.context().setOffline(false);
    }
  }
];

/* The sign-in screen has no plan behind it, so it stands on its own. */
for (const theme of ['light', 'dark']) {
  test(`sign-in (${theme})`, async ({ page }) => {
    await page.addInitScript(value => {
      try { localStorage.setItem('wrp:theme', value); } catch { /* not required */ }
    }, theme);
    await page.goto('/');
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page).toHaveScreenshot(`sign-in-${theme}.png`);
  });
}

for (const theme of ['light', 'dark']) {
  for (const scene of SCENES) {
    test(`${scene.name} (${theme})`, async ({ page, server }) => {
      await open(page, server, { plan: scene.plan?.(), theme, clock: scene.clock });
      await scene.run(page, { isPhone: isPhoneLayout(page) });
      await settle(page);
      await expect(page).toHaveScreenshot(`${scene.name}-${theme}.png`);
    });
  }
}
