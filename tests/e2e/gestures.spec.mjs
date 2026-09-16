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

  test('a swipe over the grip of an unselected card still scrolls with a short tap-and-move', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch behaviour');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    // Without the short hold, a swipe on the grip is a scroll, not a drag —
    // the grip itself is what needs the hold; the rest of the card never did.
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

test('the grip is always there, whether or not the card is selected — a locked one has none', async ({ page, server }) => {
  await server.seed({ plan: dense() });
  await signInAndWaitForPlan(page);

  await expect(card(page, 'travel').locator('.card-grip')).toHaveCount(1);
  await expect(card(page, 'ceremony').locator('.card-grip')).toHaveCount(0);

  await select(page, 'travel');
  await expect(card(page, 'travel').locator('.card-grip')).toHaveCount(1);
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

  test('a second finger does not open somebody else\'s card', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'long press is a touch gesture');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const first = await cardPoint(page, card(page, 'ready'));
    const second = await cardPoint(page, card(page, 'portraits'));

    // The second press used to overwrite the first while its timer was still
    // armed, and the timer read whatever the candidate had become — so the
    // editor opened for the card the first finger was not on.
    await touchTwo(page, first, second);

    const open = await page.locator('#activity-dialog').count();
    if (open) {
      await expect(page.locator('#activity-dialog input[name="title"]'), 'the first finger decides')
        .toHaveValue('Getting Ready');
    }
    // And nothing is left looking pressed.
    await expect(page.locator('.card.is-pressed')).toHaveCount(0);
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
});

test.describe('moving a card', () => {
  test.skip(({ browserName }) => !supportsTouchDrag(browserName), 'pointer drags need CDP for touch projects');

  test('the grip drags a card to any time — including a drop in what was empty space', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route; touch holds it first');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    // Up by 100 px — 25 minutes at four pixels a minute.
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 100, { steps: 12 });
    await expect(page.locator('.resize-bubble')).toContainText('Starts');
    await page.mouse.up();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'travel')).toBe(before - 25);
  });

  test('dropping a card back where it started changes nothing', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 2, { steps: 4 });
    await page.mouse.up();

    await page.waitForTimeout(1200);
    expect((await server.read()).revision).toBe(1);
  });

  test('Esc during a drag restores the original time', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 100, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await page.waitForTimeout(1200);
    expect((await server.read()).revision).toBe(1);
    expect(await startOf(page, 'travel')).toBe(before);
  });

  test('a locked activity has no grip', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'the grip is the pointer route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);
    await expect(card(page, 'ceremony').locator('.card-grip')).toHaveCount(0);
    await expect(card(page, 'travel').locator('.card-grip')).toHaveCount(1);
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

    const grip = await card(page, 'travel').locator('.card-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    // Down by 60 px — 15 minutes at four pixels a minute.
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 60, { steps: 10 });
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

    const grip = await card(page, 'buffer').locator('.card-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 40, { steps: 8 });
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

  test('D23: moving needs a short hold on the grip first', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const before = await startOf(page, 'travel');
    const handle = await boxInView(page, card(page, 'travel').locator('.card-grip'));
    const from = centreOf(handle);
    const to = { x: from.x, y: Math.max(12, from.y - 100) };

    const gesture = await touchDrag(page, from, to, { steps: 12, holdMs: 260, release: false });
    await expect(page.locator('.resize-bubble')).toContainText('Starts');
    await gesture.end();

    await expect(page.locator('.save-indicator')).toHaveText('Saved');
    expect(await startOf(page, 'travel')).toBe(before - 25);
  });

  test('D23: without the hold, the same drag scrolls', async ({ page, server, isMobile }) => {
    test.skip(!isMobile, 'this is the touch route');
    await server.seed({ plan: dense() });
    await signInAndWaitForPlan(page);

    const handle = await boxInView(page, card(page, 'travel').locator('.card-grip'));
    const from = centreOf(handle);
    await touchDrag(page, from, { x: from.x, y: from.y - 220 }, { steps: 10, holdMs: 0, settleMs: 4 });
    await page.waitForTimeout(700);

    expect((await server.read()).revision, 'nothing was moved').toBe(1);
  });
});
