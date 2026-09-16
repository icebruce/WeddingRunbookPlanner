import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { boxInView, cardPoint, centreOf, isPhoneLayout, pairInView, signInAndWaitForPlan, supportsTouchDrag, touchDrag, touchTap } from './helpers.mjs';

const PX_PER_MIN = 4;

const dense = () => seedPlan({
  dayStart: '11:30',
  activities: [
    activity('ready', 45, { title: 'Getting Ready', location: 'Getting-ready location', people: ['Bride', 'Mothers'] }),
    activity('portraits', 30, { title: 'Getting-ready Portraits', people: ['Bride', 'Photographer'] }),
    activity('travel', 35, { title: 'Travel to Church' }),
    activity('buffer', 25, { title: 'Arrival & Buffer' }),
    activity('ceremony', 60, { title: 'Ceremony', lockedStart: '14:45' }),
    activity('cocktail', 75, { title: 'Cocktail Hour' })
  ]
});

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);

async function select(page, id) {
  await card(page, id).click({ position: { x: 40, y: 10 } });
  await expect(card(page, id)).toHaveClass(/is-selected/);
}

test.describe('scrolling always wins', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'touch drags need CDP');

  const places = [
    ['the top edge', card => ({ x: card.x + card.width / 2, y: card.y + 3 })],
    ['the middle', card => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 })],
    ['the bottom edge', card => ({ x: card.x + card.width / 2, y: card.y + card.height - 3 })],
    ['the left edge', card => ({ x: card.x + 4, y: card.y + card.height / 2 })]
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

  test('a swipe over the handles area of an unselected card still scrolls', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch behaviour');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    // Handles only exist on the selected card, so this is empty space.
    await expect(page.locator('.handle')).toHaveCount(0);

    const box = await card(page, 'portraits').boundingBox();
    await touchDrag(page, centreOf(box), { x: box.x + box.width / 2, y: box.y - 200 }, { steps: 10 });
    await page.waitForTimeout(700);

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(30);
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

test('a selected card offers handles; a fixed one has no top handle', async ({ page, server }) => {
  await server.seed({ plan: dense() });
  await signInAndWaitForPlan(page);

  await select(page, 'portraits');
  await expect(card(page, 'portraits').locator('.handle--top')).toHaveCount(1);
  await expect(card(page, 'portraits').locator('.handle--bottom')).toHaveCount(1);
  await expect(card(page, 'portraits').locator('.card-reorder')).toHaveCount(1);

  await select(page, 'ceremony');
  await expect(card(page, 'ceremony').locator('.handle--top')).toHaveCount(0);
  await expect(card(page, 'ceremony').locator('.handle--bottom')).toHaveCount(1);
});

test('D2, F6: the toolbar replaces the + and says what the card hid', async ({ page, server }) => {
  // The toolbar belongs to the narrow layout. An iPad is a touch device but a
  // wide one: it gets the desktop layout, and reveals a card's handles by
  // selection rather than by hover.
  test.skip(!isPhoneLayout(page), 'the toolbar is the narrow layout');
  await server.seed({
    plan: seedPlan({
      activities: [
        activity('tight', 15, { title: 'Quick change', location: 'Le Richmond', people: ['Bride', 'Groom', 'Stylist'] }),
        activity('after', 60, { title: 'Portraits' })
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
  await expect(page.locator('.toolbar-buttons button')).toHaveCount(5);
});

test.describe('long press', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'touch input needs CDP');

  test('opens the editor', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await touchTap(page, await cardPoint(page, card(page, 'ready')), { holdMs: 700 });

    await expect(page.locator('#activity-dialog')).toBeVisible();
    await expect(page.locator('#activity-dialog input[name="title"]')).toHaveValue('Getting Ready');
  });

  test('is cancelled by a scroll', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const from = await cardPoint(page, card(page, 'ready'));
    // Hold briefly, then move: this is a scroll, not a press.
    await touchDrag(page, from, { x: from.x, y: from.y - 200 }, { steps: 8, holdMs: 200 });
    await page.waitForTimeout(700);

    await expect(page.locator('#activity-dialog')).toHaveCount(0);
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
    // 80 px is 20 minutes at four pixels a minute; the edge must move 80 px.
    expect(Math.abs((during.y + during.height) - (before.y + before.height) - 80)).toBeLessThanOrEqual(2);

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

  test('later activities preview their new times, and Esc puts everything back', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'portraits');

    const travelBefore = await card(page, 'travel').boundingBox();
    const handle = await card(page, 'portraits').locator('.handle--bottom').boundingBox();

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 120, { steps: 10 });

    const travelDuring = await card(page, 'travel').boundingBox();
    expect(travelDuring.y - travelBefore.y).toBeGreaterThan(100);

    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(200);

    const travelAfter = await card(page, 'travel').boundingBox();
    expect(Math.abs(travelAfter.y - travelBefore.y)).toBeLessThanOrEqual(1);
    expect((await server.read()).revision).toBe(1);
  });

  test('D5: dragging the top edge down leaves open time before the activity', async ({ page, server, isMobile }) => {
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
    const stored = (await server.read()).plan.activities[1];
    expect(stored.gapBefore).toBe(10);
    expect(stored.duration).toBe(20, 'the end stayed where it was');
    // The seeded day has open time before the fixed Ceremony too; this is the
    // one the drag just created.
    await expect(page.locator('.open-time[data-before="portraits"]')).toContainText('10 min open');
  });

  test('D5: the open time moves with its activity when earlier work grows', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({
      plan: seedPlan({
        activities: [
          activity('first', 30, { title: 'First' }),
          activity('second', 30, { title: 'Second', gapBefore: 10 }),
          activity('third', 30, { title: 'Third' })
        ]
      })
    });
    await signInAndWaitForPlan(page);
    await select(page, 'first');

    const handle = await card(page, 'first').locator('.handle--bottom').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 15 * PX_PER_MIN, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    const stored = await server.read();
    expect(stored.plan.activities[0].duration).toBe(45);
    expect(stored.plan.activities[1].gapBefore, 'the open time is unchanged').toBe(10);
    await expect(page.locator('.open-time[data-before="second"]')).toContainText('10 min open');
  });

  test('a fixed activity has no top handle to drag', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'measured with a mouse');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'ceremony');
    await expect(card(page, 'ceremony').locator('.handle--top')).toHaveCount(0);
  });
});

test.describe('reorder', () => {
  test('the grip drags a card to a new position', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route; touch holds the handle');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const [, target] = await pairInView(page, card(page, 'travel'), card(page, 'ready'));
    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, target.y + 4, { steps: 12 });
    await expect(page.locator('.drop-slot')).toBeVisible();
    await expect(page.locator('.drop-slot')).toContainText('Lands at');
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    const order = (await server.read()).plan.activities.map(a => a.id);
    expect(order[0]).toBe('travel');
  });

  test('the position shown while dragging is the one committed', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const [, target] = await pairInView(page, card(page, 'buffer'), card(page, 'portraits'));
    const grip = await card(page, 'buffer').locator('.card-grip').boundingBox();

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, target.y + 4, { steps: 12 });

    const landing = await page.locator('.drop-slot').textContent();
    await page.mouse.up();
    await expect(page.locator('.save-indicator')).toHaveText('Saved');

    const moved = (await server.read()).plan.activities.find(a => a.id === 'buffer');
    const index = (await server.read()).plan.activities.indexOf(moved);
    const shownTime = landing.replace('Lands at ', '').trim();
    await expect(card(page, 'buffer')).toContainText(shownTime.replace(/\s[AP]M$/, ''));
    expect(index).toBeLessThan(3);
  });

  test('dropping a card where it started changes nothing', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await boxInView(page, card(page, 'travel'));
    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 6, { steps: 4 });
    await page.mouse.up();

    await page.waitForTimeout(1200);
    expect((await server.read()).revision).toBe(1);
  });

  test('Esc during a drag restores the original order', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const [, target] = await pairInView(page, card(page, 'travel'), card(page, 'ready'));
    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, target.y + 4, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await page.waitForTimeout(1200);
    expect((await server.read()).revision).toBe(1);
    expect((await server.read()).plan.activities.map(a => a.id)[0]).toBe('ready');
  });

  test('a fixed activity has no grip', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await expect(card(page, 'ceremony').locator('.card-grip')).toHaveCount(0);
    await expect(card(page, 'travel').locator('.card-grip')).toHaveCount(1);
  });
});

test.describe('keyboard alternatives', () => {
  test('Alt and the arrows move a card', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard is the desktop pass');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    await card(page, 'travel').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('.save-indicator')).toHaveText('Saved');

    const order = (await server.read()).plan.activities.map(a => a.id);
    expect(order.slice(0, 3)).toEqual(['ready', 'travel', 'portraits']);
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
    expect(Math.abs((during.y + during.height) - (before.y + before.height) - 80)).toBeLessThanOrEqual(2);
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
    expect((await server.read()).plan.activities[1].gapBefore).toBe(10);
  });

  test('D23: reordering needs a short hold on the handle first', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'travel');

    const handle = await boxInView(page, card(page, 'travel').locator('.card-reorder'));
    const from = centreOf(handle);
    const target = await card(page, 'ready').boundingBox();
    // The target may be off-screen; drag towards the top of the viewport and
    // let autoscroll carry the rest.
    const to = { x: from.x, y: Math.max(12, target.y + 6) };

    const gesture = await touchDrag(page, from, to, { steps: 12, holdMs: 260, release: false });
    await expect(page.locator('.drop-slot')).toBeVisible();
    await expect(page.locator('.drop-slot')).toContainText('Lands at');
    await gesture.end();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect((await server.read()).plan.activities[0].id).toBe('travel');
  });

  test('D23: without the hold, the same drag scrolls', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await select(page, 'travel');

    const handle = await boxInView(page, card(page, 'travel').locator('.card-reorder'));
    const from = centreOf(handle);
    await touchDrag(page, from, { x: from.x, y: from.y - 220 }, { steps: 10, holdMs: 0, settleMs: 4 });
    await page.waitForTimeout(700);

    expect((await server.read()).revision, 'nothing was reordered').toBe(1);
  });
});
