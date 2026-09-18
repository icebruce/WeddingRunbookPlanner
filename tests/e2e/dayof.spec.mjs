import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { isPhoneLayout, signInAndWaitForPlan } from './helpers.mjs';

/**
 * The clock is frozen before the page loads, so every one of these is a fixed
 * moment in a fixed day rather than a race against real time.
 */
const DATE = '2026-11-21';
const T = (h, m = 0) => h * 60 + m;
// A wall-clock time at the venue. November is EST, so the offset is spelled
// out: the app never assumes a fixed one (it reads the zone name), but a test
// that left it off would assert whatever zone the runner happened to be in.
const at = (hours, minutes = 0, day = 21) =>
  new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`);

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
const strip = page => page.locator('.live-strip');

const day = (extra = {}) => seedPlan({
  date: DATE,
  activities: [
    activity('ready', T(11, 30), 45, { title: 'Getting Ready', location: 'Home' }),
    activity('portraits', T(12, 15), 30, { title: 'Portraits' }),
    activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true }),
    activity('party', T(15, 45), 120, { title: 'Dancing & Party' })
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

test.describe('D31: the date decides, read on the venue clock', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('a reader five hours ahead still sees the venue\'s day', async ({ page, server }) => {
    // 10:30 PM in Montreal on the wedding day is 3:30 AM on the 22nd in
    // London. Read on the device's own clock, the day would already be over.
    await openAt(page, server, at(22, 30));
    await expect(strip(page)).toBeVisible();

    // And the strip counts from midnight at the venue, not from the reader's.
    await expect(strip(page)).toContainText('Day complete');
  });

  test('and does not see it a day early', async ({ page, server }) => {
    // 8 PM in London on the 20th is 3 PM in Montreal on the 20th: still the
    // day before, in both places, for different reasons.
    await openAt(page, server, at(15, 0, 20));
    await expect(strip(page)).toHaveCount(0);
  });
});

test('view only means no control on a card does anything', async ({ page, server }) => {
  await openAt(page, server, at(13));
  await expect(page.locator('.mode-pill--view')).toContainText('View only');

  // Each of these used to be drawn on the day regardless: the stage pill was
  // built as a button whatever the mode, and an open-time block kept its "+".
  // Neither could change anything — commit refuses in view only — so they were
  // controls that looked live, took focus and announced themselves to a screen
  // reader, and did nothing at all.
  for (const absent of ['.handle', '.card-controls', '.open-time-add', '.stage-tag--button', '[data-action="add"]']) {
    await expect(page.locator(absent), absent).toHaveCount(0);
  }

  // The stage is still shown — it just reads as the label it is.
  await expect(page.locator('.card[data-activity-id="ready"] .stage-tag')).toBeVisible();
});

test.describe('D13: what the strip says', () => {
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

  test('when two things overlap, the locked activity is the one happening', async ({ page, server }) => {
    await openAt(page, server, at(15, 0), day({
      activities: [
        activity('travel', T(11, 30), 240, { title: 'Travel to Church' }),
        activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true })
      ]
    }));

    await expect(strip(page).locator('.live-activity')).toHaveText('Ceremony');
    await expect(strip(page)).toContainText('Also now: Travel to Church');
  });

  test('past midnight, the day is still the same day', async ({ page, server }) => {
    await openAt(page, server, at(1, 15, 22), day({
      activities: [activity('party', T(22), 240, { title: 'Dancing & Party', locked: true })]
    }));

    await expect(strip(page)).toBeVisible();
    await expect(strip(page).locator('.live-activity')).toHaveText('Dancing & Party');
    await expect(strip(page)).toContainText('45 min left');
  });
});

test('D13: the timeline shows where the day has got to, in green', async ({ page, server }) => {
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

test('the time line keeps moving through a long activity', async ({ page, server }) => {
  // It used to be repainted only when one activity handed over to the next, so
  // through a two-hour reception it stood still while the strip counted down
  // beside it.
  await openAt(page, server, at(15, 0), day({
    activities: [
      activity('ready', T(11, 30), 45, { title: 'Getting Ready' }),
      activity('party', T(14, 45), 180, { title: 'Dancing & Party', locked: true })
    ]
  }));

  const read = () => page.evaluate(() => {
    const grid = document.querySelector('.timeline-grid').getBoundingClientRect();
    const line = document.querySelector('.now-line').getBoundingClientRect();
    const bar = document.querySelector('.card.is-live .card-progress i');
    return {
      top: Math.round(line.top - grid.top),
      pill: document.querySelector('.now-pill').textContent.trim(),
      progress: bar ? bar.style.width : null
    };
  });

  const before = await read();
  expect(before.pill).toBe('3:00');

  // Half an hour later, still inside the same activity. fastForward runs the
  // timers on the way, which is what setFixedTime does not do — and is why no
  // test had ever seen the clock tick.
  await page.clock.fastForward('30:00');
  await expect.poll(async () => (await read()).pill, { timeout: 30_000 }).toBe('3:30');

  // Thirty minutes at four pixels a minute. Polled, because the line eases to
  // its new time over half a second rather than jumping there — it is the one
  // thing on the page that moves on its own all day, and it should not twitch.
  await expect.poll(async () => (await read()).top - before.top, { timeout: 10_000 })
    .toBeCloseTo(120, -1);

  const after = await read();
  expect(after.progress, 'and the bar across the activity moved with it').not.toBe(before.progress);
});

test('the view opens near the current time rather than at the top', async ({ page, server }) => {
  await openAt(page, server, at(16, 0), day({
    activities: [
      ...Array.from({ length: 8 }, (_, i) => activity(`filler${i}`, T(8) + i * 60, 60, { title: `Filler ${i + 1}` })),
      activity('late', T(16), 60, { title: 'Reception' })
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

    // No controls, no handles, and nothing on the card can be dragged.
    await expect(page.locator('.card-controls')).toHaveCount(0);
    await expect(page.locator('.card.is-draggable')).toHaveCount(0);
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

/**
 * D34 — on the day the title lives in the top bar.
 *
 * The large title used to sit under the strip, which meant it handed over to
 * the bar *behind* the strip: it slid out of sight, stayed gone for the whole
 * height of the strip, and only then reappeared in the bar. There is nothing to
 * hand over from now.
 */
test('D34: the title is in the top bar and not on the page', async ({ page, server }) => {
  await openAt(page, server, at(13, 0));
  await expect(strip(page)).toBeVisible();

  await expect(page.locator('.planner-heading h1')).toHaveCount(0);
  await expect(page.locator('.summary')).toHaveCount(0);

  // Shown outright, not faded in, and it is the page's own heading rather than
  // a copy of one — so it is not hidden from a screen reader.
  const title = page.locator('.collapsed-title--static');
  await expect(title).toBeVisible();
  await expect(title).toContainText('Wedding Day');
  expect(await title.evaluate(node => node.tagName)).toBe('H1');
  expect(await title.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
  await expect(page.locator('.topbar h1')).toHaveCount(1);

  // The span is desktop-only: on a phone the bar is also carrying the mode
  // pill and Edit.
  const span = title.locator('small');
  expect(await span.evaluate(node => getComputedStyle(node).display))
    .toBe(isPhoneLayout(page) ? 'none' : 'block');

  // Switching back gives the page its title and summary again.
  await page.locator('[data-action="menu"][data-menu="app"]').click();
  await page.locator('[data-menu-action="day-of"]').click();
  await expect(page.locator('.planner-heading h1')).toHaveText('Wedding Day');
  await expect(page.locator('.summary-meta')).toBeVisible();
});

/**
 * The strip is a band of its own tint with its own hairline along the bottom.
 * A second rule between it and the bar put three edges inside sixty pixels and
 * read as the bar having grown one.
 */
test('D34: the bar does not draw a hairline against the strip', async ({ page, server }) => {
  await openAt(page, server, at(13, 0));
  await expect(strip(page)).toBeVisible();

  const border = () => page.locator('.topbar').evaluate(node => getComputedStyle(node).borderBottomColor);
  expect(await border()).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(border, { timeout: 2000 }).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  // Nothing collapses, because there is no large title to collapse.
  await expect(page.locator('.topbar')).not.toHaveClass(/is-collapsed/);

  // The strip keeps its own boundary, so the plan is still shown passing under
  // something rather than under nothing.
  const stripBorder = await strip(page).evaluate(node => getComputedStyle(node).borderBottomWidth);
  expect(Number.parseFloat(stripBorder)).toBeGreaterThan(0);
});

/** The plan needs its own gap from the strip now that nothing else makes one. */
test('D34: the plan clears the strip', async ({ page, server }) => {
  await openAt(page, server, at(13, 0));
  await expect(strip(page)).toBeVisible();

  // Arriving at the day-of view scrolls the current time into the upper third,
  // so the top of the plan has to be brought back to measure the gap at all.
  await page.evaluate(() => window.scrollTo(0, 0));
  const gap = await page.evaluate(() => {
    const bottom = document.querySelector('.live-strip').getBoundingClientRect().bottom;
    // The heading and summary sections are empty in view-only, so the first
    // thing with a box of its own is what has to clear the strip.
    const boxes = [...document.querySelector('.planner').children]
      .map(node => node.getBoundingClientRect())
      .filter(rect => rect.height > 0);
    return Math.round(boxes[0].top - bottom);
  });
  expect(gap).toBeGreaterThanOrEqual(8);
});
