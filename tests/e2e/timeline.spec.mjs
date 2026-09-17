import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { signInAndWaitForPlan } from './helpers.mjs';

const PX_PER_MIN = 4;
const INSET = 2;
const T = (h, m = 0) => h * 60 + m;

/** Reads a card's real position on screen, relative to the timeline. */
async function geometry(page) {
  return page.evaluate(() => {
    const plan = document.querySelector('.timeline-plan');
    const planTop = plan.getBoundingClientRect().top;
    return [...document.querySelectorAll('.card')].map(card => {
      const rect = card.getBoundingClientRect();
      return {
        id: card.dataset.activityId,
        start: Number(card.dataset.start),
        end: Number(card.dataset.end),
        top: rect.top - planTop,
        bottom: rect.bottom - planTop,
        left: rect.left,
        right: rect.right
      };
    });
  });
}

async function originMinute(page) {
  // The first tick's minute and position give the mapping from time to pixels.
  return page.evaluate(inset => {
    const plan = document.querySelector('.timeline-plan');
    const planTop = plan.getBoundingClientRect().top;
    const first = document.querySelector('.card');
    return Number(first.dataset.start) - (first.getBoundingClientRect().top - planTop - inset) / 4;
  }, INSET);
}

// The exact top/bottom-in-pixels formula (start/end minute * PX_PER_MIN +/-
// CARD_INSET) is proven precisely, deterministically, at the unit level in
// tests/unit/layout.test.mjs ("F4: every card edge sits on its own time,
// with no minimum height"). These e2e checks exist to prove the DOM is wired
// to that layout at all — that a card is drawn where the data says, not to
// re-derive the geometry formula sub-pixel — so a wiring bug (an
// unpositioned or misattached card) still fails them, but a font-metrics or
// antialiasing nudge of a couple of pixels does not.
const GEOMETRY_TOLERANCE = 3;

test('D8: every card edge is within a few pixels of its own time', async ({ page, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);

  const from = await originMinute(page);
  for (const card of await geometry(page)) {
    expect(Math.abs(card.top - ((card.start - from) * PX_PER_MIN + INSET)), `${card.id} top`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
    expect(Math.abs(card.bottom - ((card.end - from) * PX_PER_MIN - INSET)), `${card.id} bottom`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  }
});

test('F4: a locked 4:00 PM activity is drawn at 4:00 PM, whatever is above it', async ({ page, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);

  const from = await originMinute(page);
  const cocktail = (await geometry(page)).find(card => card.id === 'cocktail-hour');
  expect(cocktail.start).toBe(T(16));
  expect(Math.abs(cocktail.top - ((T(16) - from) * PX_PER_MIN + INSET))).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
});

test('short cards keep their true height rather than a readable minimum', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('a', T(10), 45, { title: 'Getting Ready' }),
        activity('bouquet', T(10, 45), 5, { title: 'Bouquet handoff' }),
        activity('b', T(10, 50), 10, { title: 'Quick change' }),
        activity('c', T(11), 30, { title: 'Portraits' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  const cards = await geometry(page);
  const bouquet = cards.find(card => card.id === 'bouquet');
  expect(Math.round(bouquet.bottom - bouquet.top)).toBe(5 * PX_PER_MIN - INSET * 2);

  // And the card after it still starts on its own line.
  const from = await originMinute(page);
  const next = cards.find(card => card.id === 'b');
  expect(Math.abs(next.top - ((next.start - from) * PX_PER_MIN + INSET))).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
});

test('no two full-width cards overlap, in a dense five-minute plan', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: Array.from({ length: 12 }, (_, i) => activity(`a${i}`, T(9) + i * 5, 5, { title: `Step ${i + 1}` }))
    })
  });
  await signInAndWaitForPlan(page);

  const cards = (await geometry(page)).sort((a, b) => a.top - b.top);
  for (let i = 1; i < cards.length; i += 1) {
    expect(cards[i].top, `${cards[i].id} starts before ${cards[i - 1].id} ends`).toBeGreaterThanOrEqual(cards[i - 1].bottom - 0.5);
  }
});

test('D10: lines run every five minutes, and only 15/30/60 carry a label', async ({ page, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);

  const ticks = await page.evaluate(() =>
    [...document.querySelectorAll('.tick')].map(tick => ({
      kind: [...tick.classList].find(c => c.startsWith('tick--')),
      label: tick.querySelector('b')?.textContent ?? null,
      top: tick.getBoundingClientRect().top
    })));

  expect(ticks.length).toBeGreaterThan(50);
  expect(ticks.filter(t => t.kind === 'tick--five').every(t => t.label === null)).toBe(true);
  expect(ticks.filter(t => t.kind === 'tick--hour').every(t => /^\d{1,2}:\d{2} [AP]M$/.test(t.label))).toBe(true);
  expect(ticks.filter(t => t.kind === 'tick--quarter').every(t => /^\d{1,2}:\d{2}$/.test(t.label))).toBe(true);

  // Consecutive lines are 20 px apart: five minutes at four pixels a minute.
  // The exact spacing is proven at the unit level in
  // tests/unit/layout.test.mjs ("ticks land on their exact minute"); this
  // only needs to catch a tick grid that has drifted or come unwired.
  const tops = ticks.map(t => t.top).sort((a, b) => a - b);
  for (let i = 1; i < tops.length; i += 1) {
    expect(Math.abs(tops[i] - tops[i - 1] - 20)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  }
});

test('the ruler has a spine and the day ends with a marker', async ({ page, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);

  await expect(page.locator('.timeline-end')).toContainText('End of day');
  await expect(page.locator('.timeline-end')).toContainText('10:45 PM');
});

test('D9: rows drop in order as cards get shorter', async ({ page, server }) => {
  const durations = [45, 30, 25, 20, 15, 10, 5];
  let cursor = T(9);
  const activities = durations.map((duration, i) => {
    const a = activity(`d${duration}`, cursor, duration, {
      title: `Activity ${i + 1}`,
      location: 'St. Peter and Paul Orthodox Sobor',
      people: ['Bride', 'Groom', 'Photographer']
    });
    cursor += duration;
    return a;
  });
  await server.seed({ plan: seedPlan({ activities }) });
  await signInAndWaitForPlan(page);
  await page.waitForTimeout(300);

  const shown = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.card')].map(card => [
      card.dataset.activityId,
      {
        title: Boolean(card.querySelector('.card-title')),
        time: Boolean(card.querySelector('.card-time:not([hidden])')) || Boolean(card.querySelector('.card-line-time')),
        location: Boolean(card.querySelector('.card-location:not([hidden])')),
        stage: Boolean(card.querySelector('.card-stage:not([hidden])')),
        people: Boolean(card.querySelector('.card-people:not([hidden])')),
        clipped: card.classList.contains('is-clipped')
      }
    ])));

  // Every card keeps its title and its time; what goes, goes from the bottom
  // of the priority list upward.
  for (const [id, rows] of Object.entries(shown)) {
    expect(rows.title, `${id} title`).toBe(true);
    expect(rows.time, `${id} time`).toBe(true);
  }

  expect(shown.d45.people, '45 minutes shows people').toBe(true);
  expect(shown.d5.clipped, 'a five-minute card is one line and says so').toBe(true);
  expect(shown.d10.clipped).toBe(true);

  // Nothing below a dropped row survives it.
  for (const [id, rows] of Object.entries(shown)) {
    if (!rows.location) expect(rows.stage, `${id} kept its stage but lost its location`).toBe(false);
    if (!rows.stage) expect(rows.people, `${id} kept people but lost its stage`).toBe(false);
  }
});

test('a card says whether it had to hide anything', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('roomy', T(10), 180, { title: 'Dancing', location: 'Le Richmond', people: ['All Guests'] }),
        activity('tight', T(13), 15, { title: 'Quick change', location: 'Le Richmond', people: ['Bride', 'Groom'] })
      ]
    })
  });
  await signInAndWaitForPlan(page);
  await page.waitForTimeout(300);

  const state = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.card')].map(card => [
      card.dataset.activityId,
      { clipped: card.classList.contains('is-clipped') }
    ])));

  expect(state.roomy.clipped).toBe(false);
  expect(state.tight.clipped).toBe(true);
});

test('D25: people show as names, and the overflow is counted', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [activity('portraits', T(10), 90, {
        title: 'Getting-ready Portraits',
        people: ['Bride', 'Photographer', 'Mothers', 'Sister', 'Maid of Honour', 'Grandma', 'Cousin Léa']
      })]
    })
  });
  await signInAndWaitForPlan(page);
  await page.waitForTimeout(300);

  const tags = await page.evaluate(() =>
    [...document.querySelectorAll('.card-people .tag')]
      .filter(tag => !tag.hidden)
      .map(tag => tag.textContent));

  expect(tags[0]).toBe('Bride');
  expect(tags.every(text => text.length > 2 || text.startsWith('+'))).toBe(true);
  const count = tags.find(text => text.startsWith('+'));
  if (count) {
    const hidden = Number(count.slice(1));
    expect(hidden).toBe(7 - tags.filter(t => !t.startsWith('+')).length);
  }
});

test('open time is drawn on its own times and can be acted on', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('arrive', T(13), 30, { title: 'Arrival & Buffer' }),
        activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  const gap = page.locator('.open-time');
  await expect(gap).toHaveCount(1);
  await expect(gap).toContainText('1 hr 15 min open');
  await expect(gap).toContainText('before Ceremony');

  const from = await originMinute(page);
  const box = await page.evaluate(() => {
    const plan = document.querySelector('.timeline-plan').getBoundingClientRect();
    const rect = document.querySelector('.open-time').getBoundingClientRect();
    return { top: rect.top - plan.top, bottom: rect.bottom - plan.top };
  });
  expect(Math.abs(box.top - ((T(13, 30) - from) * PX_PER_MIN + INSET))).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  expect(Math.abs(box.bottom - ((T(14, 45) - from) * PX_PER_MIN - INSET))).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
});

test('short open time collapses to one line', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('arrive', T(14), 30, { title: 'Arrival' }),
        activity('ceremony', T(14, 40), 60, { title: 'Ceremony', locked: true })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  const gap = page.locator('.open-time');
  await expect(gap).toHaveClass(/open-time--thin/);
  await expect(gap).toContainText('10 min open');

  // A thin block selects (revealing its handles) exactly like a tall one.
  // Ceremony is locked, so only arrive's (top) handle exists at all.
  const handles = gap.locator('.handle');
  await expect(handles).toHaveCount(1);
  await expect(handles.first()).toHaveCSS('opacity', '0');

  await gap.click();
  await expect(gap).toHaveClass(/is-selected/);
  await expect(handles.first()).toHaveCSS('opacity', '1');
});

test('a very short open time is not stretched past its own duration', async ({ page, server }) => {
  // Under 11 minutes, the gap's own box (16px, layout.js's CARD_INSET math)
  // is shorter than the 44px a11y.css would otherwise force role="button"
  // elements to (a11y.css) — which used to push its bottom edge, and the
  // handle riding on it, down into the card right after it.
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('reception', T(17, 15), 20, { title: 'Reception' }),
        activity('dinner', T(17, 40), 60, { title: 'Dinner' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  const gap = page.locator('.open-time');
  const dinner = page.locator('.card[data-activity-id="dinner"]');
  const [gapBox, dinnerBox] = await Promise.all([gap.boundingBox(), dinner.boundingBox()]);
  expect(gapBox.height).toBeLessThan(20);
  expect(gapBox.y + gapBox.height).toBeLessThanOrEqual(dinnerBox.y);
});

test('an overlap puts the two activities in lanes, both on their real times', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('travel', T(13), 120, { title: 'Travel to Church' }),
        activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true }),
        activity('after', T(15, 45), 30, { title: 'Photos' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  const cards = await geometry(page);
  const travel = cards.find(card => card.id === 'travel');
  const ceremony = cards.find(card => card.id === 'ceremony');
  const after = cards.find(card => card.id === 'after');

  // They overlap in time and are side by side, not stacked.
  expect(travel.top).toBeLessThan(ceremony.bottom);
  expect(ceremony.top).toBeLessThan(travel.bottom);
  expect(travel.right).toBeLessThanOrEqual(ceremony.left + 1);
  expect(after.right - after.left).toBeGreaterThan(travel.right - travel.left);

  const from = await originMinute(page);
  expect(Math.abs(ceremony.top - ((T(14, 45) - from) * PX_PER_MIN + INSET))).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);

  await expect(page.locator('.card[data-activity-id="travel"] .card-warn')).toContainText('Overlaps 15 min with Ceremony');
  await expect(page.locator('.card[data-activity-id="ceremony"] .card-warn')).toContainText('Overlaps 15 min with Travel to Church');
});

test('D11: the summary counts the day and offers the problems as links', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('travel', T(13), 120, { title: 'Travel' }),
        activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true }),
        activity('gap-after', T(16, 30), 30, { title: 'Photos', locked: true })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  await expect(page.locator('.summary')).toContainText('1:00 PM – 5:00 PM');
  await expect(page.locator('.summary')).toContainText('3 activities');
  await expect(page.locator('.summary-link').first()).toContainText('open');
  await expect(page.locator('.summary-link--bad')).toContainText('conflict');
});

test('a summary link scrolls to the thing it names', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        ...Array.from({ length: 6 }, (_, i) => activity(`filler${i}`, T(11) + i * 60, 60, { title: `Filler ${i}` })),
        activity('late', T(19), 30, { title: 'Late fixed', locked: true })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  await page.locator('.summary-link').first().click();
  await page.waitForTimeout(700);

  const visible = await page.locator('.open-time').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  });
  expect(visible).toBe(true);
});

test('D17: the sunset marker sits at the time it is set to', async ({ page, server }) => {
  await server.seed();
  await signInAndWaitForPlan(page);

  await expect(page.locator('.sunset-pill')).toContainText('4:19');
  const from = await originMinute(page);
  const top = await page.evaluate(() => {
    const plan = document.querySelector('.timeline-plan').getBoundingClientRect();
    return document.querySelector('.sunset-line').getBoundingClientRect().top - plan.top;
  });
  expect(Math.abs(top - ((T(16, 19) - from) * PX_PER_MIN))).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
});

test('a plan that runs past midnight stays on one timeline', async ({ page, server }) => {
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('party', T(21), 180, { title: 'Dancing & Party' }),
        activity('after', T(25, 15), 60, { title: 'After party', locked: true })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  await expect(page.locator('.card[data-activity-id="after"]')).toContainText('1:15');
  await expect(page.locator('.timeline-end')).toContainText('2:15 AM');

  const cards = (await geometry(page)).sort((a, b) => a.top - b.top);
  expect(cards.map(card => card.id)).toEqual(['party', 'after']);
  expect(cards[1].top).toBeGreaterThan(cards[0].top);
});
