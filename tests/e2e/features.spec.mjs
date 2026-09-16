import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { isPhoneLayout, signInAndWaitForPlan } from './helpers.mjs';

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
const menu = async page => {
  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await expect(page.locator('.menu-popover')).toBeVisible();
};

const crew = () => seedPlan({
  activities: [
    activity('ready', 45, { title: 'Getting Ready', stage: 'preparation', location: 'Home', people: ['Bride', 'Mothers'] }),
    activity('portraits', 30, { title: 'Portraits', stage: 'photography', people: ['Bride', 'Photographer'] }),
    activity('travel', 35, { title: 'Travel', stage: 'transition', location: 'Church', people: ['Bride', 'Wedding Party'] }),
    activity('ceremony', 60, { title: 'Ceremony', stage: 'ceremony', lockedStart: '14:45', people: ['Bride', 'Groom', 'All Guests'] })
  ]
});

test.describe('the person filter', () => {
  test('D12: chips list everyone in the plan, in the order they first appear', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);

    const labels = await page.locator('.filter-chip').allTextContents();
    expect(labels).toEqual(['Everyone', 'Bride', 'Mothers', 'Photographer', 'Wedding Party', 'Groom', 'All Guests']);
  });

  test('D12: filtering fades the rest rather than hiding it', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);

    await page.locator('.filter-chip', { hasText: 'Photographer' }).click();

    // The day keeps its shape: a photographer needs to see the two hours
    // between their activities, not a list of three.
    await expect(page.locator('.card')).toHaveCount(4);
    await expect(card(page, 'portraits')).not.toHaveClass(/is-faded/);
    await expect(card(page, 'ready')).toHaveClass(/is-faded/);
    await expect(card(page, 'ceremony')).toHaveClass(/is-faded/);
  });

  test('D12: matching is exact, so a group is not a person', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);

    await page.locator('.filter-chip', { hasText: 'All Guests' }).click();
    await expect(card(page, 'ceremony')).not.toHaveClass(/is-faded/);
    await expect(card(page, 'ready'), '"Bride" is not "All Guests"').toHaveClass(/is-faded/);
  });

  test('D12: a pinned row says the filter is on, and clears it', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);

    await page.locator('.filter-chip', { hasText: 'Photographer' }).click();
    await expect(page.locator('.pinned-bar--filter')).toContainText('Showing Photographer · 1 of 4');

    await page.locator('.filter-clear').click();
    await expect(page.locator('.pinned-bar--filter')).toHaveCount(0);
    await expect(page.locator('.card.is-faded')).toHaveCount(0);
  });

  test('the filter is not part of the plan and does not survive a reload', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);

    await page.locator('.filter-chip', { hasText: 'Photographer' }).click();
    await expect(page.locator('.pinned-bar--filter')).toBeVisible();

    await page.reload();
    await expect(page.locator('.pinned-bar--filter')).toHaveCount(0);
    expect((await server.read()).revision, 'and nothing was saved').toBe(1);
  });
});

test('the top bar takes over the title once it has scrolled away', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: Array.from({ length: 10 }, (_, i) => activity(`a${i}`, 60, { title: `Activity ${i + 1}` }))
    })
  });
  await signInAndWaitForPlan(page);

  await expect(page.locator('.topbar')).not.toHaveClass(/is-collapsed/);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.locator('.topbar')).toHaveClass(/is-collapsed/);
  await expect(page.locator('.collapsed-title')).toContainText('Wedding Day');
});

test.describe('plan settings', () => {
  test('the sunset marker can be moved and removed', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);
    await expect(page.locator('.sunset-pill')).toContainText('4:19');

    await menu(page);
    await page.locator('[data-menu-action="settings"]').click();
    await page.locator('input[name="sunset"]').fill('17:05');
    await page.locator('#settings-form button[type="submit"]').click();

    await expect(page.locator('.sunset-pill')).toContainText('5:05');
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.sunset).toBe('17:05');
  });

  test('D16: the view range widens the timeline and may end after midnight', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);

    const before = await page.locator('.timeline-grid').evaluate(node => node.getBoundingClientRect().height);

    await menu(page);
    await page.locator('[data-menu-action="settings"]').click();
    await page.locator('input[name="timelineStart"]').fill('09:00');
    await page.locator('input[name="timelineEnd"]').fill('01:00');
    await page.locator('#settings-form button[type="submit"]').click();
    await expect(page.locator('#settings-dialog')).toHaveCount(0);

    const after = await page.locator('.timeline-grid').evaluate(node => node.getBoundingClientRect().height);
    expect(after, 'an end before the start means the next day').toBeGreaterThan(before);

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    const stored = (await server.read()).plan;
    expect(stored.timelineStart).toBe('09:00');
    expect(stored.timelineEnd).toBe('01:00');
  });

  test('D16: changing the view never moves an activity', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);
    const before = (await server.read()).plan.activities;

    await menu(page);
    await page.locator('[data-menu-action="settings"]').click();
    await page.locator('input[name="timelineStart"]').fill('09:00');
    await page.locator('#settings-form button[type="submit"]').click();
    await expect(page.locator('.save-indicator')).toHaveText('Saved');

    expect((await server.read()).plan.activities).toEqual(before);
  });

  test('an invalid setting is refused inline, with the sheet still open', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);

    await menu(page);
    await page.locator('[data-menu-action="settings"]').click();
    await page.locator('input[name="title"]').fill('   ');
    await page.locator('#settings-form button[type="submit"]').click();

    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#settings-dialog .field-error')).toContainText("can't be empty");
  });
});

test.describe('the menu', () => {
  test('D24: it lists what the spec says, in that order', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);
    await menu(page);

    const actions = await page.locator('.menu-popover button:visible')
      .evaluateAll(nodes => nodes.map(node => node.dataset.menuAction));

    // The status row is part of the phone menu only; everything else is the
    // same list either way.
    const expected = ['day-of', 'theme', 'print', 'export', 'versions', 'settings', 'logout'];
    if (isPhoneLayout(page)) expected.splice(2, 0, 'status');

    expect(actions).toEqual(expected);

    if (isPhoneLayout(page)) {
      await expect(page.locator('[data-menu-action="status"]')).toContainText('Working');
    }
  });

  test('D24: the status is in the phone menu and in the wide top bar, never both', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);

    const inTopBar = await page.locator('.status-control').isVisible();
    await menu(page);
    const inMenu = await page.locator('[data-menu-action="status"]').isVisible();
    expect(inTopBar).not.toBe(inMenu);
  });
});

test.describe('print', () => {
  test('D18: printing is a list, not a drawing of the timeline', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('.print-sheet')).toBeVisible();
    await expect(page.locator('.timeline')).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();

    await expect(page.locator('.print-row')).toHaveCount(4);
    await expect(page.locator('.print-sheet h1')).toHaveText('Wedding Day');
    await expect(page.locator('.print-sheet')).toContainText('Saturday, November 21, 2026');
    await expect(page.locator('.print-row', { hasText: 'Ceremony' })).toContainText('Fixed');
  });

  test('D18: it prints what the filter is showing', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);

    await page.locator('.filter-chip', { hasText: 'Photographer' }).click();
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('.print-row')).toHaveCount(1);
    await expect(page.locator('.print-row')).toContainText('Portraits');
    await expect(page.locator('.print-facts')).toContainText('Photographer');
  });

  test('activities are grouped by phase, in the order the day runs', async ({ page, server }) => {
    await server.seed({ plan: crew() });
    await signInAndWaitForPlan(page);
    await page.emulateMedia({ media: 'print' });

    const groups = await page.locator('.print-group h2').allTextContents();
    expect(groups).toEqual(['Getting ready', 'Photos', 'Travel and buffer', 'Ceremony']);
  });
});

test.describe('the empty plan', () => {
  const empty = () => seedPlan({ activities: [] });

  test('offers a first step and a shortcut', async ({ page, server }) => {
    await server.seed({ plan: empty() });
    await signInAndWaitForPlan(page);

    await expect(page.locator('.empty-plan h2')).toHaveText('Nothing planned yet');
    await expect(page.locator('[data-action="use-template"]')).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(0);
  });

  test('the template fills the day, and can be taken back', async ({ page, server }) => {
    await server.seed({ plan: empty() });
    await signInAndWaitForPlan(page);

    await page.locator('[data-action="use-template"]').click();
    await expect(page.locator('.card')).toHaveCount(11);
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities).toHaveLength(11);

    await page.locator('.toast-action').click();
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    await expect(page.locator('.empty-plan')).toBeVisible();
    expect((await server.read()).plan.activities).toHaveLength(0);
  });
});

test('the app can be added to a home screen', async ({ page, request, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');

  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Our Wedding');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
});

test('the export menu item downloads the plan', async ({ page, server }) => {
  await server.seed({ plan: crew() });
  await signInAndWaitForPlan(page);

  await menu(page);
  const download = page.waitForEvent('download');
  await page.locator('[data-menu-action="export"]').click();

  const file = await download;
  expect(file.suggestedFilename()).toBe('wedding-plan-2026-11-21.json');
});

test('suggestions offer what the plan already uses', async ({ page, server }) => {
  await server.seed({ plan: crew() });
  await signInAndWaitForPlan(page);

  await card(page, 'ready').locator('.card-menu-toggle').click();
  await page.locator('.card-menu [data-action="edit"]').click();

  const places = await page.locator('#location-suggestions option').evaluateAll(nodes => nodes.map(node => node.value));
  const people = await page.locator('#people-suggestions option').evaluateAll(nodes => nodes.map(node => node.value));

  // Whatever the plan already uses, offered rather than retyped.
  expect(places).toContain('Church');
  expect(places).toContain('Home');
  expect(people).toContain('Photographer');
  expect(people).toContain('Wedding Party');
  expect(new Set(people).size, 'each name offered once').toBe(people.length);
});

test('an activity with notes says so on its card', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('with', 60, { title: 'With notes', notes: 'Bring the rings' }),
        activity('without', 60, { title: 'Without notes' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  await expect(card(page, 'with').locator('.glyph--note')).toHaveCount(1);
  await expect(card(page, 'without').locator('.glyph--note')).toHaveCount(0);
});

test.describe('D21: dark appearance', () => {
  const theme = page => page.evaluate(() => document.documentElement.dataset.theme || 'light');

  test('light is the default, whatever the system is set to', async ({ page, server }) => {
    await server.seed();
    await page.emulateMedia({ colorScheme: 'dark' });
    await signInAndWaitForPlan(page);

    // A plan read in a dark room at a venue and the same plan on a laptop
    // should look like the same plan, so the system setting is not followed.
    expect(await theme(page)).toBe('light');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(247, 247, 244)');
  });

  test('the switch is remembered on this device and never saved to the plan', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);
    const before = (await server.read()).revision;

    await menu(page);
    await page.locator('[data-menu-action="theme"]').click();
    await expect.poll(() => theme(page)).toBe('dark');

    // It survives a reload, which means it is on the device...
    await page.reload();
    await expect(page.locator('#main-plan')).toBeVisible();
    expect(await theme(page)).toBe('dark');

    // ...and the plan was never touched, which means it is not in the plan.
    await page.waitForTimeout(900);
    const after = await server.read();
    expect(after.revision, 'choosing a theme is not an edit').toBe(before);
    expect('theme' in after.plan, 'the plan has no theme').toBe(false);

    // A second device, which has not been told, is still light.
    const other = await page.context().browser().newContext();
    const fresh = await other.newPage();
    await fresh.goto(page.url());
    await fresh.locator('#login-form input[name="password"]').fill('e2e-password-987');
    await fresh.locator('#login-form button[type="submit"]').click();
    await expect(fresh.locator('#main-plan')).toBeVisible();
    expect(await fresh.evaluate(() => document.documentElement.dataset.theme || 'light')).toBe('light');
    await other.close();
  });

  test('the browser chrome is repainted with the app, not with the system', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);

    const chrome = () => page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(await chrome()).toBe('#F7F7F4');

    await menu(page);
    await page.locator('[data-menu-action="theme"]').click();
    await expect.poll(chrome).toBe('#111214');

    await page.reload();
    await expect(page.locator('#main-plan')).toBeVisible();
    expect(await chrome(), 'and again on the next visit').toBe('#111214');
  });

  test('settings offers the same switch, and the two agree', async ({ page, server }) => {
    await server.seed();
    await signInAndWaitForPlan(page);

    await menu(page);
    await page.locator('[data-menu-action="settings"]').click();
    // The radio itself is hidden behind its label, which is what a finger hits.
    await page.locator('#settings-dialog .segmented label', { hasText: 'Dark' }).click();
    await page.locator('#settings-dialog .button--done').click();
    await expect.poll(() => theme(page)).toBe('dark');

    await menu(page);
    await expect(page.locator('[data-menu-action="theme"] .menu-switch')).not.toHaveClass(/is-off/);
  });
});

test('D4: eleven stages share six phase colours, and the icon says which stage', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('prep', 45, { title: 'Getting Ready', stage: 'preparation' }),
        activity('look', 30, { title: 'First Look', stage: 'first-look' }),
        activity('photos', 30, { title: 'Photos', stage: 'photography' }),
        activity('drive', 30, { title: 'Drive', stage: 'transition' }),
        activity('wait', 30, { title: 'Buffer', stage: 'buffer' }),
        activity('rings', 60, { title: 'Ceremony', stage: 'ceremony' }),
        activity('toast', 30, { title: 'Celebration', stage: 'celebration' }),
        activity('drinks', 30, { title: 'Cocktail', stage: 'cocktail' }),
        activity('sit', 30, { title: 'Reception', stage: 'reception' }),
        activity('eat', 60, { title: 'Dinner', stage: 'dinner' }),
        activity('dance', 60, { title: 'Party', stage: 'party' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  const bars = await page.locator('.card-rule').evaluateAll(nodes =>
    nodes.map(node => getComputedStyle(node).backgroundColor));
  expect(bars, 'one colour per stage bar').toHaveLength(11);
  expect(new Set(bars).size, 'eleven stages, six colours').toBe(6);

  // First look and photography are one phase; ceremony is its own.
  const colourOf = async id => page.locator(`.card[data-activity-id="${id}"] .card-rule`)
    .evaluate(node => getComputedStyle(node).backgroundColor);
  expect(await colourOf('look')).toBe(await colourOf('photos'));
  expect(await colourOf('drive')).toBe(await colourOf('wait'));
  expect(await colourOf('rings')).not.toBe(await colourOf('photos'));

  // The icon is what tells two stages of one phase apart.
  // The first icon in a tag is the stage's own; the second is the chevron.
  const icons = await page.locator('.stage-tag .icon:first-of-type').evaluateAll(nodes =>
    nodes.map(node => node.innerHTML.slice(0, 60)));
  expect(icons, 'one per card').toHaveLength(11);
  expect(new Set(icons).size, 'eleven stages, eleven icons').toBe(11);
});

test('moving the first start time says how much of the day moved with it', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      dayStart: '11:30',
      activities: [
        activity('a', 45, { title: 'Getting Ready' }),
        activity('b', 30, { title: 'Portraits' }),
        activity('c', 60, { title: 'Ceremony' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  await menu(page);
  await page.locator('[data-menu-action="settings"]').click();
  await page.locator('#settings-dialog input[name="dayStart"]').fill('12:00');
  await page.locator('#settings-dialog .button--done').click();

  // Changing the first start is not a cosmetic setting: it moves the whole day.
  await expect(page.locator('.toast')).toContainText('Changed plan settings');
  await expect(page.locator('.toast')).toContainText('3 activities');
  await expect(page.locator('.save-indicator')).toHaveText('Saved');
  expect((await server.read()).plan.dayStart).toBe('12:00');
});

test('settings that change nothing are not a change', async ({ page, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);
  const before = (await server.read()).revision;

  await menu(page);
  await page.locator('[data-menu-action="settings"]').click();
  await page.locator('#settings-dialog .button--done').click();

  await page.waitForTimeout(900);
  expect((await server.read()).revision, 'pressing Done without typing saves nothing').toBe(before);
  await expect(page.locator('.toast')).toHaveCount(0);
});
