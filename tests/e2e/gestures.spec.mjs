import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { boxInView, cardPoint, centreOf, isPhoneLayout, signInAndWaitForPlan, supportsTouchDrag, touchDrag, touchTap, touchTwo } from './helpers.mjs';

const PX_PER_MIN = 4;
const T = (h, m = 0) => h * 60 + m;

const dense = () => seedPlan({
  activities: [
    activity('ready', T(11, 30), 45, { title: 'Getting Ready', location: 'Getting-ready location', people: ['Bride', 'Mothers'] }),
    activity('portraits', T(12, 15), 30, { title: 'Getting-ready Portraits', people: ['Bride', 'Photographer'] }),
    activity('travel', T(12, 45), 35, { title: 'Travel to Church' }),
    activity('buffer', T(13, 20), 25, { title: 'Arrival & Buffer' }),
    activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true }),
    activity('cocktail', T(15, 45), 75, { title: 'Cocktail Hour' })
  ]
});

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
/** A point on the card clear of its own controls, with the card centred first. */
const dragFrom = async (page, id) => {
  const box = await boxInView(page, card(page, id));
  return { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) };
};
const startOf = async (page, id) => Number(await card(page, id).getAttribute('data-start'));

async function select(page, id) {
  await card(page, id).click({ position: { x: 60, y: 10 } });
  await expect(card(page, id)).toHaveClass(/is-selected/);
}

test.describe('scrolling always wins', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'touch drags need CDP');

  const places = [
    ['the top edge', card => ({ x: card.x + card.width / 2, y: card.y + 3 })],
    ['the middle', card => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 })],
    ['the bottom edge', card => ({ x: card.x + card.width / 2, y: card.y + card.height - 3 })],
    ['the right edge', card => ({ x: card.x + card.width - 4, y: card.y + card.height / 2 })]
  ];

  for (const [where, point] of places) {
    test(`F5: a swipe from ${where} scrolls and changes nothing`, async ({ page, server, isMobile }) => {
      test.skip(!isMobile, 'this is the touch behaviour');
      await server.seed({ plan: dense() });
      await signInAndWaitForPlan(page);

      const before = await server.read();
      const box = await card(page, 'ready').boundingBox();
      const from = point(box);

      await touchDrag(page, from, { x: from.x, y: from.y - 260 }, { steps: 10 });
      await page.waitForTimeout(900);

      expect(await page.evaluate(() => window.scrollY), 'the page should have scrolled').toBeGreaterThan(40);
      expect((await server.read()).revision, 'nothing was saved').toBe(before.revision);
      expect((await server.read()).plan.activities[0].duration).toBe(45);
    });
  }

  test('a swipe that starts on a card scrolls, because it never held still', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch behaviour');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    // What separates a move from a scroll is stillness, not where the finger
    // landed: moving straight away is a scroll anywhere on the card.
    const box = await card(page, 'portraits').boundingBox();
    await touchDrag(page, centreOf(box), { x: box.x + box.width / 2, y: box.y - 200 }, { steps: 10 });
    await page.waitForTimeout(700);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(30);
    await expect(page.locator('.card.is-lifted')).toHaveCount(0);
  });
});

test('tapping selects, and tapping outside deselects', async ({ page, server }) => {
  await server.seed({ plan: dense() });
  await signInAndWaitForPlan(page);

  await select(page, 'portraits');
  await expect(page.locator('.card.is-selected')).toHaveCount(1);

  await page.locator('.planner-heading h1').click();
  await expect(page.locator('.card.is-selected')).toHaveCount(0);
});

test('a card carries no drag chrome at all — the body is the drag surface', async ({ page, server }) => {
  await server.seed({ plan: dense() });
  await signInAndWaitForPlan(page);

  await expect(page.locator('.card-grip')).toHaveCount(0);
  await expect(card(page, 'travel')).toHaveClass(/is-draggable/);
  await expect(card(page, 'ceremony')).not.toHaveClass(/is-draggable/);

  await select(page, 'travel');
  await expect(card(page, 'travel')).toHaveClass(/is-draggable/);
});

test('a selected card offers handles; a locked one has no top handle at all', async ({ page, server }) => {
  await server.seed({ plan: dense() });
  await signInAndWaitForPlan(page);

  await select(page, 'portraits');
  await expect(card(page, 'portraits').locator('.handle--top')).toHaveCount(1);
  await expect(card(page, 'portraits').locator('.handle--bottom')).toHaveCount(1);

  await select(page, 'ceremony');
  await expect(card(page, 'ceremony').locator('.handle--top')).toHaveCount(0);
  await expect(card(page, 'ceremony').locator('.handle--bottom')).toHaveCount(0);
});

test('D2, F6: the toolbar replaces the + and says what the card hid', async ({ page, server }) => {
  // The toolbar belongs to the narrow layout. An iPad is a touch device but a
  // wide one: it gets the desktop layout, and reveals a card's handles by
  // selection rather than by hover.
  test.skip(!isPhoneLayout(page), 'the toolbar is the narrow layout');
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('tight', T(11), 15, { title: 'Quick change', location: 'Le Richmond', people: ['Bride', 'Groom', 'Stylist'] }),
        activity('after', T(11, 15), 60, { title: 'Portraits' })
      ]
    })
  });
  await signInAndWaitForPlan(page);

  await expect(page.locator('.mobile-add')).toBeVisible();
  await select(page, 'tight');

  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(page.locator('.mobile-add')).toHaveCount(0);
  await expect(page.locator('.toolbar-context')).toContainText('Quick change');

  // The card could not show its people; the toolbar does.
  await expect(page.locator('.toolbar-hidden')).toContainText('Bride');
  await expect(page.locator('.toolbar-buttons button')).toHaveCount(4);

  // Read right to left, most-pressed to least — and Delete in the first slot
  // is why every delete asks first (§4.1, §5.8).
  const buttons = await page.locator('.toolbar-buttons button').allTextContents();
  expect(buttons.map(text => text.trim())).toEqual(['Delete', 'Stage', 'Lock', 'Edit']);
});

test.describe('long press', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'touch input needs CDP');

  test('lifts the card to be moved, and does not open the editor', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await touchTap(page, await cardPoint(page, card(page, 'ready')), { holdMs: 700 });

    // The hold belongs to the move now. Released without travelling, it commits
    // nothing — and it is emphatically not a way into the editor.
    await expect(page.locator('#activity-dialog')).toHaveCount(0);
    expect((await server.read()).revision).toBe(1);
  });

  test('a double tap is what opens the editor on touch', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route into the editor');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const point = await cardPoint(page, card(page, 'ready'));
    await touchTap(page, point);
    await touchTap(page, point);

    await expect(page.locator('#activity-dialog')).toBeVisible();
    await expect(page.locator('#activity-dialog input[name="title"]')).toHaveValue('Getting Ready');
  });

  test('a second finger does not lift somebody else\'s card', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const first = await cardPoint(page, card(page, 'ready'));
    const second = await cardPoint(page, card(page, 'portraits'));

    // The second press used to overwrite the first while its timer was still
    // armed, and the timer read whatever the candidate had become — so the
    // hold fired for the card the first finger was not on.
    await touchTwo(page, first, second);

    const lifted = page.locator('.card.is-lifted');
    if (await lifted.count()) {
      await expect(lifted, 'the first finger decides').toHaveAttribute('data-activity-id', 'ready');
    }
    // And nothing is left looking pressed.
    await expect(page.locator('.card.is-pressed')).toHaveCount(0);
    await expect(page.locator('.card.is-charging')).toHaveCount(0);
  });

  test('is cancelled by a scroll', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const from = await cardPoint(page, card(page, 'ready'));
    // Held for less than the lift takes, then moved: this is a scroll.
    await touchDrag(page, from, { x: from.x, y: from.y - 200 }, { steps: 8, holdMs: 200 });
    await page.waitForTimeout(700);

    await expect(page.locator('.card.is-lifted')).toHaveCount(0);
    expect((await server.read()).revision, 'nothing was moved').toBe(1);
  });

  test('on a tall open-time block, opens its actions sheet — a tap alone selects it instead', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const gap = page.locator('.open-time[data-before="ceremony"]');
    await expect(gap).not.toHaveClass(/open-time--thin/);

    // A plain tap: CDP's raw touch events don't reliably synthesize the
    // click a real touchscreen would, so selecting (like `select()` above,
    // for a card) is verified with .click() — only the long press itself
    // needs a real touch gesture, since it fires from the touch's own
    // pointerdown rather than any click that might follow it.
    await gap.click();
    await expect(gap).toHaveClass(/is-selected/);
    await expect(page.locator('#open-time-dialog')).toHaveCount(0);

    const point = centreOf(await gap.boundingBox());
    await touchTap(page, point, { holdMs: 700 });
    await expect(page.locator('#open-time-dialog')).toBeVisible();
  });

  test('on a thin open-time block, a long press does not open the sheet — there is no way in but the handles', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: seedPlan({
      activities: [
        activity('arrive', T(14), 30, { title: 'Arrival' }),
        activity('ceremony', T(14, 40), 60, { title: 'Ceremony', locked: true })
      ]
    }) });
    await signInAndWaitForPlan(page);

    const gap = page.locator('.open-time');
    await expect(gap).toHaveClass(/open-time--thin/);

    const point = centreOf(await gap.boundingBox());
    await touchTap(page, point, { holdMs: 700 });
    await expect(page.locator('#open-time-dialog')).toHaveCount(0);
    // The tap it still is, underneath, selects it same as any other.
    await expect(gap).toHaveClass(/is-selected/);
  });
});

test.describe('resize', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'pointer drags need CDP for touch projects');

  test('F7: the bottom edge follows the pointer one to one', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse for exactness');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const before = await card(page, 'portraits').boundingBox();
    const handle = await card(page, 'portraits').locator('.handle--bottom').boundingBox();

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 80, { steps: 10 });

    const during = await card(page, 'portraits').boundingBox();
    // The exact 4-px-per-minute scale behind "80 px is 20 minutes" is proven
    // at the unit level in tests/unit/layout.test.mjs; this only needs to
    // show the live preview tracks the pointer by roughly that much, in the
    // right direction — not resolve it to the pixel.
    const grew = (during.y + during.height) - (before.y + before.height);
    expect(grew).toBeGreaterThan(60);
    expect(grew).toBeLessThan(100);

    await page.mouse.up();
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities[1].duration).toBe(50);
  });

  test('a snap label and a bubble show where the edge will land', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const handle = await card(page, 'portraits').locator('.handle--bottom').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 60, { steps: 8 });

    await expect(page.locator('.resize-bubble')).toBeVisible();
    await expect(page.locator('.resize-bubble')).toContainText('Ends');
    await expect(page.locator('.resize-bubble')).toContainText('45 min');
    await expect(page.locator('.tick--snap')).toHaveCount(1);

    await page.mouse.up();
    await expect(page.locator('.resize-bubble')).toHaveCount(0);
    await expect(page.locator('.tick--snap')).toHaveCount(0);
  });

  test('resizing one card previews its own new time; nothing else on the timeline moves', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const travelBefore = await card(page, 'travel').boundingBox();
    const handle = await card(page, 'portraits').locator('.handle--bottom').boundingBox();

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 120, { steps: 10 });

    // Portraits now runs long enough to reach into travel's time — that is
    // drawn as an overlap, not a push. Travel itself has not moved a pixel.
    const travelDuring = await card(page, 'travel').boundingBox();
    expect(Math.abs(travelDuring.y - travelBefore.y)).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(200);

    const travelAfter = await card(page, 'travel').boundingBox();
    expect(Math.abs(travelAfter.y - travelBefore.y)).toBeLessThanOrEqual(1);
    expect((await server.read()).revision).toBe(1);
  });

  test('D5: dragging the top edge down leaves the open time it creates', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const handle = await card(page, 'portraits').locator('.handle--top').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 10 * PX_PER_MIN, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    const stored = (await server.read()).plan.activities.find(a => a.id === 'portraits');
    expect(stored.start).toBe(T(12, 25));
    expect(stored.duration).toBe(20, 'the end stayed where it was');
    await expect(page.locator('.open-time[data-before="portraits"]')).toContainText('10 min open');
  });

  test('dragging the top edge up can overlap the activity before it', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const handle = await card(page, 'portraits').locator('.handle--top').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 10 * PX_PER_MIN, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    const stored = (await server.read()).plan.activities.find(a => a.id === 'portraits');
    expect(stored.start).toBe(T(12, 5));
    expect(stored.duration).toBe(40, 'the end stayed where it was');
    // Ready now runs to 12:15, and portraits starts at 12:05 — an overlap,
    // not a wall the drag stopped at.
    await expect(card(page, 'portraits')).toHaveClass(/is-overlap/);
  });

  test('a locked activity has no top handle to drag', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'ceremony');
    await expect(card(page, 'ceremony').locator('.handle--top')).toHaveCount(0);
  });

  test.describe('open-time handles resize a neighbour', () => {
    const gapPlan = () => seedPlan({
      activities: [
        activity('arrive', T(13), 30, { title: 'Arrival & Buffer' }),
        activity('ceremony', T(14), 60, { title: 'Ceremony' })
      ]
    });

    test('dragging the top handle grows the previous activity, shrinking the gap', async ({ page, server, isMobile }) => {
      test.skip(Boolean(isMobile), 'measured with a mouse');
      await server.seed({ plan: gapPlan() });
      await signInAndWaitForPlan(page);

      const gap = page.locator('.open-time');
      await gap.locator('strong').click();
      await expect(gap).toHaveClass(/is-selected/);

      const handle = await gap.locator('.handle--top').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 10 * PX_PER_MIN, { steps: 8 });
      await page.mouse.up();

      await expect(page.locator('.save-indicator')).toHaveText('Saved');
      const stored = (await server.read()).plan.activities;
      expect(stored.find(a => a.id === 'arrive').duration).toBe(40);
      expect(stored.find(a => a.id === 'ceremony').start).toBe(T(14), 'the next activity did not move');
      await expect(page.locator('.open-time')).toContainText('20 min open');
    });

    test('the block itself follows the drag live, not just on release', async ({ page, server, isMobile }) => {
      test.skip(Boolean(isMobile), 'measured with a mouse');
      await server.seed({ plan: gapPlan() });
      await signInAndWaitForPlan(page);

      const gap = page.locator('.open-time');
      await gap.locator('strong').click();
      const before = await gap.boundingBox();

      const handle = await gap.locator('.handle--top').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 10 * PX_PER_MIN, { steps: 8 });

      // Mid-drag, before release: the block's own top edge — and the handle
      // riding on it — has moved down by roughly the same 10 minutes, not
      // stayed at its pre-drag position.
      const during = await gap.boundingBox();
      expect(during.y - before.y).toBeGreaterThan(30);
      expect(during.height).toBeLessThan(before.height);
      await expect(gap).toContainText('20 min open');

      await page.mouse.up();
    });

    test('a block stays selected after its handle is dragged, same as a card', async ({ page, server, isMobile }) => {
      test.skip(Boolean(isMobile), 'measured with a mouse');
      await server.seed({ plan: gapPlan() });
      await signInAndWaitForPlan(page);

      const gap = page.locator('.open-time');
      await gap.locator('strong').click();
      await expect(gap).toHaveClass(/is-selected/);

      const handle = await gap.locator('.handle--top').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 10 * PX_PER_MIN, { steps: 8 });
      await page.mouse.up();

      await expect(page.locator('.save-indicator')).toHaveText('Saved');
      // The gap that was selected has shrunk, not vanished, so the same
      // element is still there to check — it should still look selected,
      // handle and all, exactly as a card does after its own handle drags.
      await expect(page.locator('.open-time')).toHaveClass(/is-selected/);
      await expect(page.locator('.open-time .handle').first()).toHaveCSS('opacity', '1');
    });

    test('dragging the bottom handle grows the next activity, shrinking the gap', async ({ page, server, isMobile }) => {
      test.skip(Boolean(isMobile), 'measured with a mouse');
      await server.seed({ plan: gapPlan() });
      await signInAndWaitForPlan(page);

      const gap = page.locator('.open-time');
      await gap.locator('strong').click();

      const handle = await gap.locator('.handle--bottom').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 10 * PX_PER_MIN, { steps: 8 });
      await page.mouse.up();

      await expect(page.locator('.save-indicator')).toHaveText('Saved');
      const stored = (await server.read()).plan.activities;
      expect(stored.find(a => a.id === 'ceremony').start).toBe(T(13, 50));
      expect(stored.find(a => a.id === 'ceremony').duration).toBe(70, 'the end stayed where it was');
      expect(stored.find(a => a.id === 'arrive').duration).toBe(30, 'the previous activity did not move');
    });

    test('a locked neighbour has no handle on that side of the gap', async ({ page, server, isMobile }) => {
      test.skip(Boolean(isMobile), 'measured with a mouse');
      await server.seed({ plan: seedPlan({
        activities: [
          activity('arrive', T(13), 30, { title: 'Arrival & Buffer', locked: true }),
          activity('ceremony', T(14), 60, { title: 'Ceremony' })
        ]
      }) });
      await signInAndWaitForPlan(page);

      const gap = page.locator('.open-time');
      await gap.locator('strong').click();
      await expect(gap.locator('.handle--top')).toHaveCount(0);
      await expect(gap.locator('.handle--bottom')).toHaveCount(1);
    });

    test('a thin gap next to a selected card still reveals that card\'s own handle', async ({ page, server, isMobile }) => {
      test.skip(Boolean(isMobile), 'measured with a mouse');
      await server.seed({ plan: seedPlan({
        activities: [
          activity('reception', T(17, 15), 20, { title: 'Reception' }),
          activity('dinner', T(17, 45), 55, { title: 'Dinner' })
        ]
      }) });
      await signInAndWaitForPlan(page);

      await expect(page.locator('.open-time')).toHaveClass(/open-time--thin/);

      // Selecting Dinner reveals its own top handle regardless of the thin
      // gap right above it — the gap's matching handle is a separate control
      // that only shows when the gap itself is selected or hovered, so this
      // card can never be left with no visible handle on that edge.
      await page.locator('.card[data-activity-id="dinner"]').click({ position: { x: 40, y: 10 } });
      await expect(page.locator('.card[data-activity-id="dinner"]')).toHaveClass(/is-selected/);
      await expect(page.locator('.card[data-activity-id="dinner"] .handle--top')).toHaveCSS('opacity', '1');
      await expect(page.locator('.card[data-activity-id="dinner"] .handle--bottom')).toHaveCSS('opacity', '1');
      await expect(page.locator('.open-time .handle--bottom')).toHaveCSS('opacity', '0');
    });
  });
});

test.describe('moving a card', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'pointer drags need CDP for touch projects');

  test('the card body drags to any time — including a drop in what was empty space', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a mouse lifts on movement; touch holds first');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    // Down into the hour that is open between Arrival & Buffer and Ceremony.
    const before = await startOf(page, 'buffer');
    const from = await dragFrom(page, 'buffer');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Down by 100 px — 25 minutes at four pixels a minute.
    await page.mouse.move(from.x, from.y + 100, { steps: 12 });
    // Landing in a gap, so the readout is a time and not a verdict.
    await expect(page.locator('.resize-bubble')).toContainText('Starts');
    await expect(page.locator('.card.is-clash')).toHaveCount(0);
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'buffer')).toBe(before + 25);
  });

  test('a hold lifts a card on touch, and the card travels with the finger', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    // The card's middle, stage pill and all: a hold lifts the card wherever it
    // lands, so the controls the card draws do not punch holes in the surface.
    const from = centreOf(await boxInView(page, card(page, 'travel')));

    // Held still past the lift threshold, then moved: a drag, not a scroll.
    await touchDrag(page, from, { x: from.x, y: from.y - 100 }, { steps: 12, holdMs: 450 });

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'travel')).toBe(before - 25);
  });

  test('a lift under a five-minute step lands nowhere and changes nothing', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a mouse lifts on movement');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const from = await dragFrom(page, 'travel');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Past the 3 px lift threshold but inside the 10 px that a 5-minute step
    // needs: the card visibly lifts and still commits nothing.
    await page.mouse.move(from.x, from.y + 6, { steps: 4 });
    await expect(page.locator('.card.is-lifted')).toHaveCount(1);
    await page.mouse.up();

    await page.waitForTimeout(1200);
    expect((await server.read()).revision).toBe(1);
  });

  test('Esc during a drag restores the original time', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a mouse lifts on movement');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    const from = await dragFrom(page, 'travel');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 100, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await page.waitForTimeout(1200);
    expect((await server.read()).revision).toBe(1);
    expect(await startOf(page, 'travel')).toBe(before);
  });

  test('a drop that would collide says so before it is dropped', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a mouse lifts on movement');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const from = await dragFrom(page, 'travel');
    const ceremony = await card(page, 'ceremony').boundingBox();

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Onto the locked Ceremony, which cannot move out of the way.
    await page.mouse.move(from.x, ceremony.y + 20, { steps: 14 });

    // The verdict replaces the time, and both sides of the collision are marked.
    await expect(page.locator('.resize-bubble')).toContainText('Overlaps');
    await expect(page.locator('.card.is-lifted.is-clash')).toHaveCount(1);
    await expect(card(page, 'ceremony')).toHaveClass(/is-overlap/);

    await page.keyboard.press('Escape');
    await page.mouse.up();
  });

  test('a locked activity cannot be lifted', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a mouse lifts on movement');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await expect(card(page, 'ceremony')).not.toHaveClass(/is-draggable/);
    await expect(card(page, 'travel')).toHaveClass(/is-draggable/);

    const from = await dragFrom(page, 'ceremony');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 100, { steps: 10 });
    await expect(page.locator('.card.is-lifted')).toHaveCount(0);
    await page.mouse.up();
  });
});

test.describe('group selection', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'pointer drags need CDP for touch projects');

  test('Ctrl/Cmd-click builds a group, and dragging one member moves them all by the same amount', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the modifier key is a desktop gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await card(page, 'portraits').click({ position: { x: 60, y: 10 } });
    await card(page, 'travel').click({ position: { x: 60, y: 10 }, modifiers: ['Control'] });
    await card(page, 'buffer').click({ position: { x: 60, y: 10 }, modifiers: ['Control'] });

    await expect(card(page, 'portraits')).toHaveClass(/is-group-selected/);
    await expect(card(page, 'travel')).toHaveClass(/is-group-selected/);
    await expect(card(page, 'buffer')).toHaveClass(/is-group-selected/);

    const [portraitsBefore, travelBefore, bufferBefore] = await Promise.all(
      ['portraits', 'travel', 'buffer'].map(id => startOf(page, id)));

    const from = await dragFrom(page, 'travel');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Down by 60 px — 15 minutes at four pixels a minute.
    await page.mouse.move(from.x, from.y + 60, { steps: 10 });
    await expect(page.locator('.resize-bubble')).toContainText('3 activities');
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'portraits')).toBe(portraitsBefore + 15);
    expect(await startOf(page, 'travel')).toBe(travelBefore + 15);
    expect(await startOf(page, 'buffer')).toBe(bufferBefore + 15);
  });

  test('a locked activity in the group does not move with the rest', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the modifier key is a desktop gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await card(page, 'buffer').click({ position: { x: 60, y: 10 } });
    await card(page, 'ceremony').click({ position: { x: 60, y: 10 }, modifiers: ['Control'] });

    const ceremonyBefore = await startOf(page, 'ceremony');
    const bufferBefore = await startOf(page, 'buffer');

    const from = await dragFrom(page, 'buffer');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 40, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'buffer')).toBe(bufferBefore + 10);
    expect(await startOf(page, 'ceremony'), 'locked stays exactly where it was').toBe(ceremonyBefore);
  });

  test('a plain click drops the group back to a single selection', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the modifier key is a desktop gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await card(page, 'portraits').click({ position: { x: 60, y: 10 } });
    await card(page, 'travel').click({ position: { x: 60, y: 10 }, modifiers: ['Control'] });
    await expect(card(page, 'travel')).toHaveClass(/is-group-selected/);

    await card(page, 'buffer').click({ position: { x: 60, y: 10 } });
    await expect(card(page, 'buffer')).toHaveClass(/is-selected/);
    await expect(page.locator('.is-group-selected')).toHaveCount(0);
  });
});

test.describe('keyboard alternatives', () => {
  test('Alt and the arrows move a card five minutes at a time', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard is the desktop pass');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    await card(page, 'travel').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities.find(a => a.id === 'travel').start, 'up is five minutes earlier').toBe(before - 5);

    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities.find(a => a.id === 'travel').start).toBe(before);
  });

  test('a locked card does not move with Alt and the arrows', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard is the desktop pass');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await card(page, 'ceremony').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(400);
    expect((await server.read()).revision).toBe(1);
  });

  test('F30: the arrows on a handle move that edge the way it moves on screen', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard is the desktop pass');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    await card(page, 'portraits').locator('.handle--bottom').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities[1].duration, 'down is later, so longer').toBe(35);

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities[1].duration, 'up is earlier, so shorter').toBe(30);
  });

  test('Enter on a selected card opens it', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard is the desktop pass');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await card(page, 'portraits').focus();
    await page.keyboard.press('Enter');
    await expect(card(page, 'portraits')).toHaveClass(/is-selected/);

    await page.keyboard.press('Enter');
    await expect(page.locator('#activity-dialog')).toBeVisible();
  });
});

test.describe('the same gestures with a finger', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'touch drags need CDP');

  test('F7: the bottom handle follows the finger and commits what it showed', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const handle = await boxInView(page, card(page, 'portraits').locator('.handle--bottom'));
    const before = await card(page, 'portraits').boundingBox();
    const from = centreOf(handle);

    const gesture = await touchDrag(page, from, { x: from.x, y: from.y + 80 }, { steps: 10, release: false });
    const during = await card(page, 'portraits').boundingBox();
    // As above: the exact px-per-minute scale is unit-tested; this only
    // needs to show the finger is actually driving the live preview.
    const grew = (during.y + during.height) - (before.y + before.height);
    expect(grew).toBeGreaterThan(60);
    expect(grew).toBeLessThan(100);
    await expect(page.locator('.resize-bubble')).toBeVisible();

    await gesture.end();
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities[1].duration).toBe(50);
  });

  test('D5: the top handle creates open time with a finger too', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const handle = await boxInView(page, card(page, 'portraits').locator('.handle--top'));
    const from = centreOf(handle);
    await touchDrag(page, from, { x: from.x, y: from.y + 10 * PX_PER_MIN }, { steps: 8 });

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    await expect(page.locator('.open-time[data-before="portraits"]')).toContainText('10 min open');
  });

  test('D23: moving needs the card held still first', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    const from = centreOf(await boxInView(page, card(page, 'travel')));
    const to = { x: from.x, y: Math.max(12, from.y - 100) };

    const gesture = await touchDrag(page, from, to, { steps: 12, holdMs: 450, release: false });
    // Travel sits exactly in the gap between Portraits and Arrival & Buffer, so
    // moving it at all collides — what this asserts is that the hold lifted it.
    await expect(page.locator('.card.is-lifted')).toHaveCount(1);
    await gesture.end();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'travel')).toBe(before - 25);
  });

  test('D23: without the hold, the same drag scrolls', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await boxInView(page, card(page, 'travel'));
    const from = centreOf(await boxInView(page, card(page, 'travel')));
    await touchDrag(page, from, { x: from.x, y: from.y - 220 }, { steps: 10, holdMs: 0, settleMs: 4 });
    await page.waitForTimeout(700);

    expect((await server.read()).revision, 'nothing was moved').toBe(1);
  });

  test('sideways drift during the hold does not cancel it', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    await boxInView(page, card(page, 'travel'));
    const from = await cardPoint(page, card(page, 'travel'));

    // A thumb pivots around its knuckle: lateral drift is not a scroll signal,
    // so it gets 20 px of tolerance where vertical movement gets 10.
    const gesture = await touchDrag(page, from, { x: from.x + 14, y: from.y },
      { steps: 4, holdMs: 450, release: false });
    await gesture.move(from.x + 14, from.y - 100);
    await expect(page.locator('.card.is-lifted')).toHaveCount(1);
    await gesture.end(from.x + 14, from.y - 100);

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'travel')).toBe(before - 25);
  });
});
