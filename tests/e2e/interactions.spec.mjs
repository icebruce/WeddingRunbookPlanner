/**
 * Interaction polish: the behaviour that happens around and after a gesture
 * rather than during it — the toast, the sheet's own dismissal, the settle
 * after a committed change, and the scroll and viewport rules that hold the
 * rest of it together.
 */
import { test, expect, seedPlan, activity } from './fixtures.mjs';
import { isPhoneLayout, signInAndWaitForPlan } from './helpers.mjs';

const T = (h, m = 0) => h * 60 + m;

test('toast clears the selection toolbar', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Getting-ready Portraits', location: 'Bridal suite, top floor', people: ['Bride', 'Photographer', 'Planner', 'Videographer'] }),
    activity('b', T(12), 45, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await expect(page.locator('.toolbar')).toBeVisible();
  await page.locator('.toolbar [data-action="lock"]').click();

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  const t = await toast.boundingBox();
  const bar = await page.locator('.toolbar').boundingBox();
  // The toolbar is ~122 px tall once it carries a hidden-details line. The
  // toast used to sit at a fixed 96 px, tuned for the 58 px floating +, which
  // put it 44 px inside the toolbar.
  await expect(page.locator('.toolbar-hidden')).toHaveCount(1);
  expect(t.y + t.height).toBeLessThanOrEqual(bar.y);
});

test('toast pauses while hovered and resumes after', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="lock"]').click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.waitForTimeout(7000);
  await expect(toast).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(toast).toBeHidden({ timeout: 8000 });
});

test('a toast can be swiped away', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="lock"]').click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  const drag = async (dx, dy) => {
    // Re-read it each time: the first drag ends off the toast, which counts as
    // a click outside the selection and takes the toolbar away — and the toast
    // floats above whatever occupies the bottom of the screen, so it moves.
    const box = await toast.boundingBox();
    const x = box.x + 30;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 3, y + dy / 3, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await page.mouse.up();
  };

  // Down is the one direction that is nearly free — the toast is already at
  // the bottom of the screen — so it is not a dismissal.
  await drag(0, 60);
  await expect(toast).toBeVisible();

  // Sideways is.
  await drag(60, 0);
  await expect(toast).toBeHidden({ timeout: 2000 });
});

test('a tap on Undo still undoes', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the selection toolbar is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="lock"]').click();
  await expect(page.locator('.card.is-locked')).toHaveCount(1);
  await page.locator('.toast-action').click();
  await expect(page.locator('.card.is-locked')).toHaveCount(0);
});

test('the page does not chain its overscroll to the browser', async ({ page }) => {
  await signInAndWaitForPlan(page);
  const value = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY);
  expect(value).toBe('contain');
});

test('the sticky inset counts every bar that is actually showing', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits', people: ['Bride', 'Photographer'] }),
    activity('b', T(12), 60, { title: 'Ceremony', people: ['Bride'] })
  ] }) });
  await signInAndWaitForPlan(page);

  const read = () => page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-inset')));
  const bare = await read();
  const topbar = await page.locator('.topbar').evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(bare - topbar)).toBeLessThanOrEqual(1);

  // Turning a filter on pins a second bar under the first one.
  await page.locator('.filter-chip', { hasText: 'Photographer' }).click();
  await expect(page.locator('.pinned-bar--filter')).toBeVisible();
  const withFilter = await read();
  const bar = await page.locator('.pinned-bar--filter').evaluate(node => node.getBoundingClientRect().height);
  expect(Math.abs(withFilter - (topbar + bar))).toBeLessThanOrEqual(1);
});

test('a card tabbed onto lands clear of the sticky bars', async ({ page, server }) => {
  const many = Array.from({ length: 14 }, (_, i) => activity(`a${i}`, T(8) + i * 60, 45, { title: `Activity ${i}` }));
  await server.seed({ plan: seedPlan({ activities: many }) });
  await signInAndWaitForPlan(page);

  // Scroll deep into the day, then move focus to a card above the fold.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  await page.locator('.card[data-activity-id="a3"]').evaluate(node => node.focus());
  await page.waitForTimeout(200);

  const { cardTop, barBottom } = await page.evaluate(() => ({
    cardTop: document.querySelector('.card[data-activity-id="a3"]').getBoundingClientRect().top,
    barBottom: document.querySelector('.topbar').getBoundingClientRect().bottom
  }));
  expect(cardTop).toBeGreaterThanOrEqual(barBottom);
});

test('the chip row fades only the side that has more', async ({ page, server }) => {
  const people = ['Bride', 'Groom', 'Photographer', 'Videographer', 'Planner', 'Celebrant', 'Florist', 'Caterer'];
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits', people })] }) });
  await signInAndWaitForPlan(page);

  // The contract is the invariant, not a fixed answer: eight chips overflow a
  // phone and fit a desktop, and the fade has to be right either way.
  const row = page.locator('.filter-chips');
  const read = () => row.evaluate(node => ({
    overflows: node.scrollWidth > node.clientWidth + 1,
    before: node.classList.contains('has-more-before'),
    after: node.classList.contains('has-more-after')
  }));

  const atStart = await read();
  expect(atStart.before).toBe(false);
  expect(atStart.after).toBe(atStart.overflows);

  await row.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await page.waitForTimeout(150);
  const atEnd = await read();
  expect(atEnd.before).toBe(atEnd.overflows);
  expect(atEnd.after).toBe(false);
});

test('a chip row that fits gets no false edge', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits', people: ['Bride'] })] }) });
  await signInAndWaitForPlan(page);
  const row = page.locator('.filter-chips');
  await expect(row).not.toHaveClass(/has-more-after/);
  await expect(row).not.toHaveClass(/has-more-before/);
});

test('a sheet with no keyboard up is a whole sheet', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();

  // The regression this exists for: --keyboard-inset was derived from
  // innerHeight minus visualViewport.height, which are not the same box on
  // every engine and are not meaningful at all before layout. On WebKit that
  // read as nearly the whole screen with nothing typed into, took the sheet's
  // max-height below zero, and left a sheet of no height that the pull gesture
  // then dismissed on any movement — because every distance is past 40% of
  // nothing.
  const inset = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')) || 0);
  expect(inset).toBe(0);

  const { height, viewport } = await page.evaluate(() => ({
    height: document.querySelector('.sheet').offsetHeight,
    viewport: window.innerHeight
  }));
  expect(height).toBeGreaterThan(viewport * 0.3);
});

test('the sheet lifts above the on-screen keyboard', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();

  await sheetAtRest(page);
  const restingBottom = await page.locator('.sheet').evaluate(n => n.getBoundingClientRect().bottom);

  // Playwright cannot raise a real keyboard, so the visual viewport is shrunk
  // the way one does and the resize event is fired by hand.
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 300 });
    vv.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(150);

  const inset = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')));
  expect(inset).toBe(300);

  // The contract is not "moved by roughly 300" — how far that is depends on
  // the dialog's own box, which is not the same on every engine. It is that
  // the sheet ends up clear of the keyboard: its bottom edge at or above the
  // line the keyboard's top sits on.
  const after = await page.evaluate(() => {
    const box = document.querySelector('.sheet').getBoundingClientRect();
    return { bottom: box.bottom, top: box.top, height: box.height, viewport: window.innerHeight };
  });
  const keyboardTop = after.viewport - inset;
  expect(after.bottom, `sheet ${JSON.stringify(after)} against a keyboard topped at ${keyboardTop}`)
    .toBeLessThanOrEqual(keyboardTop + 2);
  expect(after.bottom).toBeLessThan(restingBottom);
});

test('a fast load shows nothing at all, and a slow one shows a skeleton', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });

  // Hold the plan back so the skeleton has a reason to appear.
  await page.route('**/api/plan*', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await signInAndWaitForPlan(page).catch(() => {});
  await page.goto('/');

  // Nothing for the first 400 ms — a load that quick should look instant.
  await page.waitForTimeout(150);
  expect(await page.locator('.skeleton-card').count()).toBe(0);

  await expect(page.locator('.skeleton-card').first()).toBeVisible({ timeout: 2000 });
  expect(await page.locator('.skeleton-card').count()).toBe(3);
  // It is three cards at their real rest heights, not three identical bars.
  const heights = await page.locator('.skeleton-card').evaluateAll(
    nodes => nodes.map(n => Math.round(n.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBeGreaterThan(1);

  await page.unroute('**/api/plan*');
});

test('the saving dot does not pulse', async ({ page }) => {
  await signInAndWaitForPlan(page);
  const name = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'save-indicator save-indicator--saving';
    const dot = document.createElement('span');
    dot.className = 'save-dot';
    probe.append(dot);
    document.body.append(probe);
    const value = getComputedStyle(dot).animationName;
    probe.remove();
    return value;
  });
  expect(name).toBe('none');
});

test('a failure during the saving hold is not masked by a stale Saved', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);

  await page.route('**/api/plan', route =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' })
      : route.continue());

  await page.locator('.card').first().click();
  await page.locator(isPhoneLayout(page) ? '.toolbar [data-action="lock"]' : '.card .lock-button').first().click();

  // Whatever the indicator does in between, it must land on the truth.
  await expect(page.locator('.save-indicator--not-saved')).toBeVisible({ timeout: 10_000 });
  await page.unroute('**/api/plan');
});

test('a card re-fits while it is being resized, not after', async ({ page, server }) => {
  test.skip(isPhoneLayout(page), 'a pointer drag of the bottom edge');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 120, { title: 'Getting-ready Portraits', location: 'Bridal suite', people: ['Bride', 'Photographer'] })
  ] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  await card.click();
  // Two hours: everything is on show.
  await expect(card.locator('.card-people')).toBeVisible();
  await expect(card.locator('.card-location')).toBeVisible();

  const handle = card.locator('[data-role="resize"]');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Drag the bottom edge up by 105 minutes' worth of pixels, and stop there.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 420, { steps: 12 });
  await page.waitForTimeout(120);

  // Still mid-gesture: the card is 15 minutes tall and has already let go of
  // what does not fit, rather than slicing it off behind overflow: hidden.
  const height = await card.evaluate(node => node.getBoundingClientRect().height);
  expect(height).toBeLessThan(80);
  await expect(card.locator('.card-people')).toBeHidden();
  await expect(card).toHaveClass(/is-clipped/);
  const overflow = await card.locator('.card-body').evaluate(
    node => node.scrollHeight - node.clientHeight);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.mouse.up();
});

test('the fit pass costs a handful of layouts, not one per card', async ({ page, server }) => {
  const many = Array.from({ length: 24 }, (_, i) => activity(`a${i}`, T(7) + i * 35, 30, {
    title: `Activity number ${i} with a reasonably long title`,
    location: 'St. Peter and Paul Orthodox Sobor, side entrance',
    people: ['Bride', 'Groom', 'Photographer', 'Videographer', 'Planner']
  }));
  await server.seed({ plan: seedPlan({ activities: many }) });
  await signInAndWaitForPlan(page);
  await expect(page.locator('.card')).toHaveCount(24);

  // Count forced synchronous layouts across one whole fit pass by counting the
  // reads that can cause one. Before the phase split this was one per card at
  // minimum; it is now a fixed handful whatever the length of the day.
  const reads = await page.evaluate(async () => {
    let count = 0;
    const proto = window.Element.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
    Object.defineProperty(proto, 'scrollHeight', {
      configurable: true,
      get() { count += 1; return original.get.call(this); }
    });
    const { fitCards } = await import('/src/render/fit.js');
    await new Promise(resolve => {
      fitCards(document.querySelector('#app'), resolve);
    });
    Object.defineProperty(proto, 'scrollHeight', original);
    return count;
  });
  // 24 cards: one read each in the measure phase plus one each in the single
  // correction round. The point is that it does not grow with the rows dropped.
  console.log(`scrollHeight reads for 24 cards: ${reads}`);
  expect(reads).toBeLessThanOrEqual(24 * 2 + 4);
});

/**
 * Record every settle animation the page starts, by name.
 *
 * Recorded rather than sampled: a settle lasts 180 ms and two round trips to
 * the browser can outlast it, so asking afterwards what is running is a race.
 * Named, because a card's hover lift and its selection ring are both
 * `box-shadow` transitions of exactly the same duration and `getAnimations`
 * returns those too.
 *
 * Cards are keyed by their activity, open-time blocks by the activity they sit
 * before — with a prefix, because those are the same ids.
 */
/** Wait until no settle is in flight, so a measurement is of a card at rest. */
async function settled(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll('.card, .open-time')]
    .some(node => node.getAnimations().some(animation => animation.id === 'settle')));
}

async function recordSettles(page) {
  await page.evaluate(() => {
    window.__settles = [];
    const real = window.Element.prototype.animate;
    window.Element.prototype.animate = function (frames, options) {
      if (options?.id === 'settle') {
        window.__settles.push({
          key: this.classList.contains('card') ? `card:${this.dataset.activityId}`
            : this.classList.contains('open-time') ? `gap:${this.dataset.before}`
              : 'end',
          from: frames[0].transform,
          ms: options.duration
        });
      }
      return real.call(this, frames, options);
    };
  });
  return {
    async take() {
      const all = await page.evaluate(() => {
        const seen = window.__settles;
        window.__settles = [];
        return seen;
      });
      return all;
    }
  };
}

test('an undone move settles rather than teleporting', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(14), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  await card.click();
  // Move it with the keyboard, so no gesture is involved at all.
  await card.press('Alt+ArrowDown');
  await expect(page.locator('.toast')).toBeVisible();

  // Let the move's own settle finish first. Undoing mid-settle is a different
  // question, and the honest answer to it is the next test.
  await settled(page);

  // Undo puts it back, and that return is animated: five minutes is 20 px.
  const settles = await recordSettles(page);
  await page.evaluate(() => document.querySelector('.toast-action').click());
  const seen = (await settles.take()).filter(entry => entry.key === 'card:a');
  expect(seen).toHaveLength(1);
  expect(seen[0].ms).toBe(180);
  expect(seen[0].from).toBe('translate(0px, 20px)');
});

test('undoing mid-settle continues from where the card is, not from where it was', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(14), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  await card.click();
  await card.press('Alt+ArrowDown');

  // No wait: the move is still gliding, so the card has barely left 10:00 —
  // and undo is putting it back to 10:00. There is almost nothing to travel,
  // and the settle says so rather than replaying the whole twenty pixels.
  const settles = await recordSettles(page);
  await page.evaluate(() => document.querySelector('.toast-action').click());
  const seen = (await settles.take()).filter(entry => entry.key === 'card:a');
  const travel = seen.length
    ? Math.abs(Number.parseFloat(seen[0].from.match(/,\s*(-?[\d.]+)px/)[1]))
    : 0;
  expect(travel).toBeLessThan(20);
  await expect(card).toHaveAttribute('data-start', String(T(10)));
});

test('a committed drag does not glide back to where it started', async ({ page, server }) => {
  test.skip(isPhoneLayout(page), 'a pointer drag');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(15), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const settles = await recordSettles(page);
  const card = page.locator('.card[data-activity-id="a"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 30 + 240, { steps: 10 });
  await page.mouse.up();

  // The card is already where the finger put it, so there is nothing to
  // settle. Anything animating it here would be a slide back to 10:00 and out
  // again, which is worse than the snap it replaced.
  //
  // The open time below it is a different matter: that gap really did get
  // shorter, and it settles. Moving the earliest activity also re-bases the
  // whole visible range, which in page pixels moves every card on the
  // timeline — so this also pins down that the settle measures the clock and
  // not the page.
  const seen = await settles.take();
  expect(seen.filter(entry => entry.key === 'card:a')).toHaveLength(0);
  expect(seen.filter(entry => entry.key === 'card:b')).toHaveLength(0);
  await expect(card).not.toHaveAttribute('data-start', String(T(10)));
});

test('a cancelled drag eases back instead of snapping', async ({ page, server }) => {
  test.skip(isPhoneLayout(page), 'a pointer drag');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);

  const settles = await recordSettles(page);
  const card = page.locator('.card[data-activity-id="a"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 30 + 200, { steps: 10 });
  await page.keyboard.press('Escape');

  const seen = (await settles.take()).filter(entry => entry.key === 'card:a');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen[0].ms).toBe(180);
  await expect(card).toHaveAttribute('data-start', String(T(10)));
});

test('a locked activity in a group is not carried by the preview', async ({ page, server }) => {
  test.skip(isPhoneLayout(page), 'ctrl-click group selection is a pointer gesture');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(12), 60, { title: 'Ceremony', locked: true })
  ] }) });
  await signInAndWaitForPlan(page);

  await page.locator('.card[data-activity-id="a"]').click();
  await page.locator('.card[data-activity-id="b"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.card.is-group-selected')).toHaveCount(2);

  const box = await page.locator('.card[data-activity-id="a"]').boundingBox();
  const lockedBefore = await page.locator('.card[data-activity-id="b"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 30 + 120, { steps: 8 });

  // Mid-drag: the locked one has not budged, because committing will not move
  // it either. A preview that carried it would be promising a change that
  // never happens.
  const lockedDuring = await page.locator('.card[data-activity-id="b"]').boundingBox();
  expect(Math.abs(lockedDuring.y - lockedBefore.y)).toBeLessThanOrEqual(1);
  await page.mouse.up();
  await expect(page.locator('.card[data-activity-id="b"]')).toHaveAttribute('data-start', String(T(12)));
});

test('nothing settles when the reader has asked for reduced motion', async ({ browser, server }) => {
  const context = await browser.newContext({ baseURL: server.baseURL, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  await card.click();
  await card.press('Alt+ArrowDown');
  const settles = await recordSettles(page);
  await page.evaluate(() => document.querySelector('.toast-action').click());
  expect(await settles.take()).toHaveLength(0);
  await context.close();
});

test('pressing Undo does not also clear the selection', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(14), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  await card.click();
  await expect(card).toHaveClass(/is-selected/);
  await card.press('Alt+ArrowDown');
  await settled(page);

  await page.evaluate(() => document.querySelector('.toast-action').click());
  // The toast is chrome, not "outside": undoing must not take the toolbar out
  // from under the thumb that is about to use it again.
  await expect(page.locator('.card[data-activity-id="a"]')).toHaveClass(/is-selected/);
});

/**
 * Wait until the sheet has finished rising into place.
 *
 * Its entrance is a CSS animation, and a running animation's transform beats
 * an inline one — so anything measured during those 240 ms is measuring the
 * entrance, not the thing under test.
 */
/**
 * Wait until the sheet has actually arrived.
 *
 * "Nothing is running" is not enough now that the entrance is a transition
 * rather than a keyframe animation: a transition that has not started yet is
 * not in `getAnimations()` either, so the old check answered yes before the
 * sheet had moved at all and handed the next line a sheet still on its way up.
 * Where it is, is the honest question.
 */
async function sheetAtRest(page) {
  await page.waitForFunction(() => {
    const sheet = document.querySelector('.sheet');
    if (!sheet) return false;
    if (sheet.getAnimations().some(a => a.playState === 'running')) return false;
    return Math.abs(new window.DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42) < 0.5;
  });
}

/**
 * Pull the open sheet down by `distance`, optionally letting go at the end.
 *
 * `settleMs` is the pause before release, and it is not padding: a sheet leaves
 * if it is pulled *far* or thrown *fast*, and a synthetic drag runs at whatever
 * rate the harness manages — a 60 px pull dispatched in 40 ms is a flick by any
 * honest reading. A test about the distance rule has to hold still long enough
 * to be asking about distance.
 */
async function pullSheet(page, distance, { release = true, from = '.sheet-header', settleMs = 0 } = {}) {
  const grip = await page.locator(from).boundingBox();
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 12, { steps: 2 });
  await page.mouse.move(x, y + distance, { steps: 8 });
  if (settleMs) await page.waitForTimeout(settleMs);
  if (release) await page.mouse.up();
}

const sheetOffset = page => page.locator('.sheet').evaluate(node => {
  const value = new window.DOMMatrixReadOnly(getComputedStyle(node).transform);
  return value.m42;
});

test('a sheet follows the finger and springs back from a short pull', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await sheetAtRest(page);

  await pullSheet(page, 60, { release: false, settleMs: 250 });
  // It follows the finger exactly: no easing on a direct manipulation.
  expect(await sheetOffset(page)).toBeGreaterThan(40);
  await page.mouse.up();

  // Well short of the threshold, and let go of rather than thrown, so it comes
  // back and stays open.
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await expect.poll(() => sheetOffset(page)).toBe(0);
});

test('a short pull thrown fast dismisses anyway', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await sheetAtRest(page);

  // Nowhere near 40 % of the sheet's height, but flicked — which is how a
  // sheet is really thrown away, and the rule the distance test above must not
  // be accidentally measuring.
  await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    const send = (type, y) => sheet.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, clientX: 40, clientY: y
    }));
    send('pointerdown', 100);
    send('pointermove', 120);
    send('pointermove', 180);
    send('pointerup', 180);
  });
  await expect(page.locator('#activity-dialog')).toBeHidden();
});

test('a long pull dismisses the sheet', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await sheetAtRest(page);

  const height = await page.locator('.sheet').evaluate(node => node.offsetHeight);
  await pullSheet(page, Math.round(height * 0.6));
  await expect(page.locator('#activity-dialog')).toBeHidden();
});

test('pulling a sheet down with typing in it still asks first', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();
  await sheetAtRest(page);
  await page.locator('#activity-dialog input[name="title"]').fill('Something else entirely');

  const height = await page.locator('.sheet').evaluate(node => node.offsetHeight);
  await pullSheet(page, Math.round(height * 0.6));

  // Swiping down and pressing Cancel are the same thing, so both ask.
  await expect(page.locator('#alert-root dialog')).toBeVisible();
  // And the editor is still there, sitting at rest under the question, so
  // "Keep editing" comes back to something that has not moved.
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await expect.poll(() => sheetOffset(page)).toBe(0);

  await page.locator('#alert-root .sheet-close').click();
  await expect(page.locator('#activity-dialog input[name="title"]')).toHaveValue('Something else entirely');
});

test('a sheet scrolled down is not dragged away by a downward swipe', async ({ page, server }) => {
  test.skip(!isPhoneLayout(page), 'the bottom sheet is the narrow layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().click();
  await page.locator('.toolbar [data-action="edit"]').click();

  await sheetAtRest(page);
  const scrolled = await page.locator('.sheet-body').evaluate(node => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop;
  });
  test.skip(scrolled === 0, 'this editor fits without scrolling at this size');

  await pullSheet(page, 200, { from: '.sheet-body' });
  // Below the top of the body, a downward drag means scrolling back up.
  await expect(page.locator('#activity-dialog')).toBeVisible();
  expect(await page.locator('.sheet').evaluate(node => node.style.transform)).toBe('');
});

test('the desktop dialog is not draggable', async ({ page, server }) => {
  test.skip(isPhoneLayout(page), 'this is the wide layout');
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);
  await page.locator('.card').first().dblclick();
  await expect(page.locator('#activity-dialog')).toBeVisible();
  await sheetAtRest(page);

  await pullSheet(page, 220);
  await expect(page.locator('#activity-dialog')).toBeVisible();
  // A centred dialog carries its own `translate(-50%, -50%)`, so the test is
  // whether the drag wrote anything of its own — not what the total comes to.
  expect(await page.locator('.sheet').evaluate(node => node.style.transform)).toBe('');
});

test('the app menu is drawn at the sizes the design guide gives', async ({ page }) => {
  await signInAndWaitForPlan(page);
  await page.locator('[data-action="menu"][data-menu="app"]').click();
  const menu = page.locator('.menu-popover');
  await expect(menu).toBeVisible();

  const phone = isPhoneLayout(page);
  expect(await menu.evaluate(node => node.getBoundingClientRect().width)).toBe(250);
  const row = menu.locator('button').first();
  expect(await row.evaluate(node => getComputedStyle(node).fontSize)).toBe(phone ? '17px' : '15px');
  expect(await row.evaluate(node => Math.round(node.getBoundingClientRect().height)))
    .toBeGreaterThanOrEqual(phone ? 46 : 40);
});

test('the brand and the collapsed title cross-fade in one place', async ({ page, server }) => {
  const many = Array.from({ length: 10 }, (_, i) => activity(`a${i}`, T(8) + i * 60, 45, { title: `Activity ${i}` }));
  await server.seed({ plan: seedPlan({ activities: many }) });
  await signInAndWaitForPlan(page);

  const read = () => page.evaluate(() => {
    const brand = document.querySelector('.topbar .brand');
    const title = document.querySelector('.collapsed-title');
    return {
      brand: Number(getComputedStyle(brand).opacity),
      title: Number(getComputedStyle(title).opacity),
      // Neither is ever display:none, so neither ever costs a reflow.
      brandShown: getComputedStyle(brand).display !== 'none',
      titleShown: getComputedStyle(title).display !== 'none',
      sameCell: brand.getBoundingClientRect().left === title.getBoundingClientRect().left
    };
  });

  const atTop = await read();
  expect(atTop.brand).toBe(1);
  expect(atTop.title).toBe(0);
  expect(atTop.sameCell).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => (await read()).title).toBe(1);
  const scrolled = await read();
  expect(scrolled.brand).toBe(0);
  expect(scrolled.brandShown).toBe(true);
  expect(scrolled.titleShown).toBe(true);
});

test('back clears an open-time selection instead of leaving the app', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(13), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const block = page.locator('.open-time').first();
  await block.click();
  await expect(block).toHaveClass(/is-selected/);

  await page.goBack();
  await expect(page.locator('.open-time.is-selected')).toHaveCount(0);
  // Still in the app, not back on whatever preceded it.
  await expect(page.locator('#main-plan')).toBeVisible();
});

test('back deselects where you are, without taking the scroll back with it', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(9), 60, { title: 'Portraits' }),
    activity('b', T(18), 60, { title: 'Party' })
  ] }) });
  await signInAndWaitForPlan(page);

  await page.locator('.card[data-activity-id="a"]').click({ position: { x: 40, y: 10 } });
  await expect(page.locator('.card.is-selected')).toHaveCount(1);

  // Read on, a long way past the card that is selected.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  const before = await page.evaluate(() => window.scrollY);

  await page.goBack();
  await expect(page.locator('.card.is-selected')).toHaveCount(0);

  // The browser records a scroll position against the entry the selection
  // pushed, and restoring it threw the reader back to the card they had left
  // behind. Back closes the top thing; it is not a way of travelling.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(before, -1);
});

test('the drop line is drawn over the cards, not behind them', async ({ page, server, isMobile }) => {
  test.skip(Boolean(isMobile), 'driven with a mouse');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(14), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 90, { steps: 8 });

  const line = page.locator('.drop-line');
  await expect(line).toHaveCount(1);

  // Drawn in the plan layer rather than the ruler, which is painted first and
  // therefore always behind the very card the line is placing.
  expect(await line.evaluate(node => node.parentElement.className)).toContain('timeline-plan');

  // And it marks the minute the card will start on: the card's own top border
  // settles the usual two-pixel inset below it, at any card height.
  const gap = await page.evaluate(() => {
    const drop = document.querySelector('.drop-line').getBoundingClientRect();
    const moving = document.querySelector('.card.is-lifted').getBoundingClientRect();
    return moving.top - (drop.top + drop.height / 2);
  });
  expect(Math.abs(gap - 2)).toBeLessThan(1.5);

  await page.mouse.up();
  await expect(page.locator('.drop-line')).toHaveCount(0);
});

test('the card being dragged is the selected card', async ({ page, server, isMobile }) => {
  test.skip(Boolean(isMobile), 'driven with a mouse');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 60, { title: 'Portraits' }),
    activity('b', T(14), 60, { title: 'Ceremony' })
  ] }) });
  await signInAndWaitForPlan(page);

  const box = await page.locator('.card[data-activity-id="a"]').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 90, { steps: 8 });
  await page.mouse.up();

  // A mouse lifts on movement alone, so it never goes through the tap that
  // would have selected the card — it used to be dropped wearing a plain
  // card's ring, with no toolbar and no handles.
  await expect(page.locator('.card[data-activity-id="a"]')).toHaveClass(/is-selected/);
});

test('the top bar draws its hairline only once the plan is under it', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(9), 60, { title: 'Portraits' }),
    activity('b', T(18), 60, { title: 'Party' })
  ] }) });
  await signInAndWaitForPlan(page);

  const border = () => page.locator('.topbar').evaluate(node => getComputedStyle(node).borderBottomColor);
  expect(await border(), 'nothing is passing underneath yet').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('.topbar')).toHaveClass(/is-collapsed/);
  // It fades in over the handover rather than appearing with it.
  await expect.poll(border).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

test('the bars under the top bar stick to its measured height, not to a guess', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ status: 'Final', activities: [
    activity('a', T(9), 60, { title: 'Portraits' })
  ] }) });
  await signInAndWaitForPlan(page);

  const measured = await page.evaluate(() => ({
    token: getComputedStyle(document.documentElement).getPropertyValue('--topbar-height').trim(),
    real: Math.round(document.querySelector('.topbar').getBoundingClientRect().height)
  }));
  expect(measured.token).toBe(`${measured.real}px`);
});

test('a sheet leaves on the same curve it arrived on', async ({ page, server }) => {
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card').first();
  if (await isPhoneLayout(page)) {
    await card.click({ position: { x: 40, y: 10 } });
    await page.locator('.toolbar [data-action="edit"]').click();
  } else {
    await card.dblclick({ position: { x: 40, y: 10 } });
  }
  const dialog = page.locator('#activity-dialog');
  await expect(dialog).toBeVisible();

  // It arrives on a transition rather than a keyframe, so a pull can take it
  // over mid-entrance (sheet-drag.js finishes whatever is running).
  expect(await dialog.locator('.sheet').evaluate(node => getComputedStyle(node).transitionProperty))
    .toMatch(/transform|scale/);

  await dialog.locator('.sheet-close').click();

  // Still on the page for the length of its exit — that is the whole point,
  // because a dialog torn down on the same tick as `close()` cannot animate —
  // but closed, inert and untouchable while it goes.
  const leaving = page.locator('#activity-dialog.is-leaving');
  await expect(leaving).toHaveCount(1);
  expect(await leaving.evaluate(node => node.open)).toBe(false);
  expect(await leaving.evaluate(node => node.inert)).toBe(true);
  expect(await leaving.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none');

  // The exit is held open by `overlay`, so it is asked for only where that is
  // understood: `display` on its own would draw the sheet into the middle of
  // the page on its way out, having already left the top layer.
  const held = await page.evaluate(() => CSS.supports('overlay', 'auto'));
  expect(await leaving.evaluate(node => getComputedStyle(node).display))
    .toBe(held ? 'block' : 'none');

  // And then gone: one leaving sheet does not become two.
  await expect(page.locator('#activity-dialog')).toHaveCount(0);
});

test('a row that comes back during a resize is faded in, not popped', async ({ page, server }) => {
  test.skip(isPhoneLayout(page), 'a pointer drag of the bottom edge');
  await server.seed({ plan: seedPlan({ activities: [
    activity('a', T(10), 120, { title: 'Getting-ready Portraits', location: 'Bridal suite', people: ['Bride', 'Photographer'] })
  ] }) });
  await signInAndWaitForPlan(page);

  const card = page.locator('.card[data-activity-id="a"]');
  await card.click();
  const hidden = () => card.evaluate(node =>
    [...node.querySelectorAll('[data-drop]')].filter(row => row.hidden).length);

  const box = await card.locator('[data-role="resize"]').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  // Down to a quarter of an hour: rows go as the card shrinks under the finger.
  await page.mouse.move(x, y - 420, { steps: 12 });
  await page.waitForTimeout(120);
  expect(await hidden(), 'the card re-fits while it is being resized').toBeGreaterThan(0);

  // Each row comes back at its own point in the drag and its fade is over in
  // 140 ms, so asking what is running at the end catches nothing. Count them
  // as they start instead.
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    window.__rowFades = 0;
    Element.prototype.animate = function animate(...args) {
      if (this.hasAttribute?.('data-drop')) window.__rowFades += 1;
      return original.apply(this, args);
    };
  });

  // And back. A row that returns appeared out of nothing, so it fades in —
  // the half of the change the card's own moving edge does not cover.
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();

  // The drop commits and repaints, and the fit pass that follows runs in a
  // frame of its own — so this is polled rather than read once.
  await expect.poll(hidden, { message: 'and they are back' }).toBe(0);
  expect(await page.evaluate(() => window.__rowFades), 'the rows that came back were faded in')
    .toBeGreaterThan(0);
});

test('the now line eases between ticks rather than stepping', async ({ page, server }) => {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  await server.seed({ plan: seedPlan({
    date: now.toISOString().slice(0, 10),
    status: 'Final',
    activities: [activity('a', Math.max(0, minutes - 20), 90, { title: 'Happening now' })]
  }) });
  await signInAndWaitForPlan(page);
  await expect(page.locator('.now-line')).toBeVisible();
  expect(await page.locator('.now-line').evaluate(node => getComputedStyle(node).transitionProperty))
    .toContain('top');
  expect(await page.locator('.now-pill').evaluate(node => getComputedStyle(node).transitionDuration))
    .toBe('0.5s');
});

test('a reader with reduced motion still gets a charge before the lift', async ({ browser, server }) => {
  const context = await browser.newContext({ baseURL: server.baseURL, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await server.seed({ plan: seedPlan({ activities: [activity('a', T(10), 60, { title: 'Portraits' })] }) });
  await signInAndWaitForPlan(page);

  const charge = await page.evaluate(() => {
    const card = document.querySelector('.card');
    card.classList.add('is-charging');
    const style = getComputedStyle(card, '::before');
    // Read into strings before dropping the class: the declaration is live,
    // and reading it afterwards describes a card that is no longer charging.
    const result = {
      name: style.animationName,
      duration: style.animationDuration,
      ring: style.boxShadow,
      // The press is on the individual `scale` property, so that going from
      // held to lifted is one property easing rather than two transforms
      // swapping.
      scale: getComputedStyle(card).scale
    };
    card.classList.remove('is-charging');
    return result;
  });
  // The scale is gone, because that is movement; the ring fades in over the
  // same 300 ms, because opacity is allowed and silence is not.
  expect(charge.scale).toBe('none');
  expect(charge.name).toBe('charge-ring');
  expect(charge.duration).toBe('0.3s');
  expect(charge.ring).toContain('inset');
  await context.close();
});
