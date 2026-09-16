import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { isPhoneLayout, signInAndWaitForPlan } from './helpers.mjs';

/**
 * The clock is frozen before the page loads, so every one of these is a fixed
 * moment in a fixed day rather than a race against real time.
 */
const DATE = '2026-11-21';
const at = (hours, minutes = 0, day = 21) =>
  new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
const strip = page => page.locator('.live-strip');

const day = (extra = {}) => seedPlan({
  date: DATE,
  dayStart: '11:30',
  activities: [
    activity('ready', 45, { title: 'Getting Ready', location: 'Home' }),
    activity('portraits', 30, { title: 'Portraits' }),
    activity('ceremony', 60, { title: 'Ceremony', lockedStart: '14:45' }),
    activity('party', 120, { title: 'Dancing & Party' })
  ],
  ...extra
});

async function openAt(page, server, when, plan = day()) {
  await server.seed({ plan });
  await page.clock.install({ time: when });
  await signInAndWaitForPlan(page);
}

test('D1: it turns itself on on the day, and off on any other date', async ({ page, server }) => {
  await openAt(page, server, at(13, 0, 20));
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator('.mode-pill')).toHaveCount(0);

  await page.clock.setFixedTime(at(13));
  await page.reload();
  await expect(strip(page)).toBeVisible();
  await expect(page.locator('.mode-pill--view')).toContainText('View only');
});

test('D1: setting the status to Final turns it on whatever the date', async ({ page, server }) => {
  await openAt(page, server, at(13, 0, 15), day({ status: 'Final' }));
  await expect(strip(page)).toBeVisible();
});

test.describe('what the strip says', () => {
  const cases = [
    ['before the first activity', at(11, 0), 'Starts in 30 min', 'Getting Ready, 11:30 AM'],
    ['during an activity', at(11, 45), 'Getting Ready', 'Next'],
    ['during open time', at(13, 30), 'Open', '1 hr 15 min until Ceremony'],
    ['after the last activity', at(18, 0), 'Day complete', null]
  ];

  for (const [name, when, headline, detail] of cases) {
    test(name, async ({ page, server }) => {
      await openAt(page, server, when);
      await expect(strip(page)).toContainText(headline);
      if (detail) await expect(strip(page)).toContainText(detail);
    });
  }

  test('during a conflict, the fixed activity is the one happening', async ({ page, server }) => {
    await openAt(page, server, at(15, 0), day({
      activities: [
        activity('travel', 240, { title: 'Travel to Church' }),
        activity('ceremony', 60, { title: 'Ceremony', lockedStart: '14:45' })
      ]
    }));

    await expect(strip(page).locator('.live-activity')).toHaveText('Ceremony');
    await expect(strip(page)).toContainText('Travel to Church runs over');
  });

  test('past midnight, the day is still the same day', async ({ page, server }) => {
    await openAt(page, server, at(1, 15, 22), day({
      dayStart: '22:00',
      activities: [activity('party', 240, { title: 'Dancing & Party', lockedStart: '22:00' })]
    }));

    await expect(strip(page)).toBeVisible();
    await expect(strip(page).locator('.live-activity')).toHaveText('Dancing & Party');
    await expect(strip(page)).toContainText('45 min left');
  });
});

test('the timeline shows where the day has got to', async ({ page, server }) => {
  await openAt(page, server, at(11, 45));

  await expect(page.locator('.now-line')).toHaveCount(1);
  await expect(page.locator('.now-pill')).toContainText('11:45');

  await expect(card(page, 'ready')).toHaveClass(/is-live/);
  await expect(card(page, 'ready').locator('.now-tag')).toContainText('Now');
  await expect(card(page, 'portraits')).not.toHaveClass(/is-live/);

  // And after it has happened, it fades but stays readable.
  await page.clock.setFixedTime(at(14, 0));
  await page.reload();
  await expect(card(page, 'ready')).toHaveClass(/is-past/);
  await expect(card(page, 'ready')).toContainText('Getting Ready');
});

test('the time line is where the time is', async ({ page, server }) => {
  await openAt(page, server, at(12, 30));

  const measurement = await page.evaluate(() => {
    const ruler = document.querySelector('.timeline-ruler').getBoundingClientRect();
    const line = document.querySelector('.now-line').getBoundingClientRect();
    const card = document.querySelector('.card[data-activity-id="portraits"]');
    return {
      lineTop: line.top - ruler.top,
      cardTop: card.getBoundingClientRect().top - ruler.top,
      cardStart: Number(card.dataset.start)
    };
  });

  // 12:30 against a card starting at 12:15, at four pixels a minute.
  expect(Math.abs(measurement.lineTop - measurement.cardTop - (12 * 60 + 30 - measurement.cardStart) * 4))
    .toBeLessThanOrEqual(2);
});

test('the view opens near the current time rather than at the top', async ({ page, server }) => {
  await openAt(page, server, at(16, 0), day({
    dayStart: '08:00',
    activities: [
      ...Array.from({ length: 8 }, (_, i) => activity(`filler${i}`, 60, { title: `Filler ${i + 1}` })),
      activity('late', 60, { title: 'Reception' })
    ]
  }));

  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled, 'the day does not open at eight in the morning').toBeGreaterThan(100);

  const nowVisible = await page.locator('.now-line').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.top > 0 && rect.top < window.innerHeight;
  });
  expect(nowVisible).toBe(true);
});

test.describe('view only', () => {
  test('every way of changing the plan is refused', async ({ page, server }) => {
    await openAt(page, server, at(11, 45));
    const before = await server.read();

    // No controls, no handles, no grips.
    await expect(page.locator('.card-controls')).toHaveCount(0);
    await expect(page.locator('.card-grip')).toHaveCount(0);
    await expect(page.locator('.handle')).toHaveCount(0);

    // Selecting still works — reading a card is not changing it — but the
    // keyboard routes into the plan do nothing.
    await card(page, 'portraits').click({ position: { x: 40, y: 10 } });
    await expect(page.locator('.handle')).toHaveCount(0);

    await card(page, 'portraits').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(900);

    expect(await server.read()).toEqual(before);
  });

  test('open time cannot be turned into anything', async ({ page, server }) => {
    await openAt(page, server, at(13, 30));
    await expect(page.locator('.open-time')).toHaveCount(1);

    await page.locator('.open-time').click();
    await expect(page.locator('#open-time-dialog')).toHaveCount(0);
  });

  test('Edit switches it on, and says so', async ({ page, server }) => {
    await openAt(page, server, at(11, 45));

    await page.locator('[data-action="day-of-edit"]').click();
    await expect(page.locator('.mode-pill--editing')).toContainText('Editing');
    await expect(strip(page), 'the strip stays: the day is still running').toBeVisible();

    // And now the plan can be changed.
    await card(page, 'portraits').click({ position: { x: 40, y: 10 } });
    await expect(card(page, 'portraits').locator('.handle--bottom')).toHaveCount(1);

    await page.locator('[data-action="day-of-done"]').click();
    await expect(page.locator('.mode-pill--view')).toContainText('View only');
    await expect(page.locator('.handle')).toHaveCount(0);
  });

  test('there is no way to add an activity until Edit has been pressed', async ({ page, server }) => {
    await openAt(page, server, at(11, 45));

    // Neither the phone's floating + nor the desktop's Add activity.
    await expect(page.locator('.mobile-add')).toHaveCount(0);
    await expect(page.locator('.planner-add')).toHaveCount(0);

    await page.locator('[data-action="day-of-edit"]').click();
    const add = isPhoneLayout(page) ? page.locator('.mobile-add') : page.locator('.planner-add');
    await expect(add, 'and it comes back once editing is on').toBeVisible();
  });

  test('selecting a card in view only offers the way in, and nothing else', async ({ page, server }) => {
    test.skip(!isPhoneLayout(page), 'the toolbar is the narrow layout');
    await openAt(page, server, at(11, 45));

    await card(page, 'ready').click({ position: { x: 40, y: 10 } });
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.toolbar-context')).toContainText('Getting Ready');

    const buttons = await page.locator('.toolbar-buttons button').allTextContents();
    expect(buttons.map(text => text.trim())).toEqual(['Edit']);

    await page.locator('.toolbar-buttons button').click();
    await expect(page.locator('.mode-pill--editing')).toBeVisible();
    await expect(page.locator('.toolbar-buttons button')).toHaveCount(5);
  });

  test('the live strip stays under the top bar when the day is scrolled', async ({ page, server }) => {
    await openAt(page, server, at(13, 20));
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(400);

    const gap = await page.evaluate(() => {
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      const live = document.querySelector('.live-strip').getBoundingClientRect();
      return Math.round(live.top - bar.bottom);
    });
    // Directly under it, give or take the bar's own hairline.
    expect(Math.abs(gap)).toBeLessThanOrEqual(2);
  });

  test('five minutes away and editing lapses', async ({ page, server }) => {
    await openAt(page, server, at(11, 45));
    await page.locator('[data-action="day-of-edit"]').click();
    await expect(page.locator('.mode-pill--editing')).toBeVisible();

    // Away, and back a long time later.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.setFixedTime(at(12, 0));
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(page.locator('.mode-pill--view')).toContainText('View only');
  });
});

test('the menu switch turns it on out of season, and is remembered for that date', async ({ page, server }) => {
  await openAt(page, server, at(13, 0, 15));
  await expect(strip(page)).toHaveCount(0);

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="day-of"]').click();
  await expect(strip(page)).toBeVisible();

  await page.reload();
  await expect(strip(page), 'the choice outlives a reload').toBeVisible();
});

test('it can be switched off on the day, and stays off', async ({ page, server }) => {
  await openAt(page, server, at(13, 0));
  await expect(strip(page)).toBeVisible();

  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="day-of"]').click();
  await expect(strip(page)).toHaveCount(0);

  await page.reload();
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator('.save-indicator'), 'and the planning controls are back').toBeVisible();
});

test('reduced motion stops the pulse', async ({ page, server }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAt(page, server, at(11, 45));

  const animation = await strip(page).locator('.live-dot').evaluate(node => getComputedStyle(node).animationName);
  expect(animation).toBe('none');
});
