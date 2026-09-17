import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { isPhoneLayout, openActivityEditor, setPicker, signInAndWaitForPlan, trackToasts } from './helpers.mjs';

const T = (h, m = 0) => h * 60 + m;

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
const editor = page => page.locator('#activity-dialog');
const saved = page => expect(page.locator('.save-indicator')).toHaveText('Saved');

const base = () => seedPlan({
  activities: [
    activity('ready', T(11, 30), 45, { title: 'Getting Ready', location: 'Getting-ready location', people: ['Bride'] }),
    activity('portraits', T(12, 15), 30, { title: 'Getting-ready Portraits', people: ['Bride', 'Photographer'] }),
    activity('travel', T(12, 45), 35, { title: 'Travel to Church' }),
    activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true }),
    activity('cocktail', T(15, 45), 75, { title: 'Cocktail Hour' })
  ]
});

async function select(page, id) {
  await card(page, id).click({ position: { x: 60, y: 10 } });
  await expect(card(page, id)).toHaveClass(/is-selected/);
}

/** The control for an action, wherever this layout puts it. */
async function act(page, id, action) {
  if (isPhoneLayout(page)) {
    await select(page, id);
    await page.locator(`.toolbar [data-action="${action}"]`).click();
    return;
  }
  // The wide layout keeps lock on the card itself; edit, delete and
  // duplicate live inside the editor now, not a popover on the card.
  if (action === 'lock') {
    await card(page, id).hover();
    await card(page, id).locator('.lock-button').click();
    return;
  }
  await openActivityEditor(page, card(page, id));
  if (action === 'delete') return page.locator('#delete-activity').click();
  if (action === 'duplicate') return page.locator('#duplicate-activity').click();
}

test('the editor asks for things in the order the spec gives', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'portraits'));

  const labels = await editor(page).locator('.field-label').allTextContents();
  expect(labels).toEqual(['Name', 'Timing', 'Location', 'Stage', 'People', 'Notes']);
  await expect(editor(page).locator('#delete-activity')).toBeVisible();
  await expect(editor(page).locator('#duplicate-activity')).toBeVisible();
});

test('a blocked flatpickr script leaves the timing field editable, not stuck', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await page.route('**/vendor/flatpickr/flatpickr.min.js', route => route.abort());
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'portraits'));

  // With no flatpickr to take the field over, it has to stay a plain,
  // editable text input rather than the permanently `readonly` one the
  // markup starts with — or nothing, not even a screen reader, can reach it.
  const start = editor(page).locator('input[name="start"]');
  await expect(start).not.toHaveAttribute('readonly', '');
  await start.fill('2026-11-21 13:05');
  await editor(page).locator('.button--done').click();

  await expect(card(page, 'portraits')).toContainText('1:05');
});

test('the timing block works out the end as you change the duration', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'portraits'));

  await expect(editor(page).locator('[data-ends]')).toHaveText('12:45 PM');
  await editor(page).locator('[data-duration-step="5"]').click();
  await expect(editor(page).locator('[data-ends]')).toHaveText('12:50 PM');

  await editor(page).locator('[data-duration-step="-5"]').click();
  await editor(page).locator('[data-duration-step="-5"]').click();
  await expect(editor(page).locator('[data-ends]')).toHaveText('12:40 PM');
});

test('duration shows the hours-and-minutes reading beside the minute count', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'cocktail'));

  await expect(editor(page).locator('[data-duration-human]')).toHaveText('1 hr 15 min');
  await editor(page).locator('input[name="duration"]').fill('80');
  await editor(page).locator('input[name="duration"]').dispatchEvent('input');
  await expect(editor(page).locator('[data-duration-human]')).toHaveText('1 hr 20 min');
});

test('the editor opens on the start an activity already has, and a new one can be set', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'portraits'));

  await expect(editor(page).locator('input[name="start"]')).toHaveValue('2026-11-21 12:15');

  await setPicker(page, editor(page).locator('input[name="start"]'), '2026-11-21 09:00');
  await editor(page).locator('button[type="submit"]').click();
  await saved(page);

  expect((await server.read()).plan.activities.find(a => a.id === 'portraits').start).toBe(T(9));
});

test('Cancel asks before throwing away typing, and only then', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  // Nothing typed: Cancel just closes.
  await openActivityEditor(page, card(page, 'portraits'));
  await editor(page).locator('.sheet-close').click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('#discard-dialog')).toHaveCount(0);

  // Something typed: Cancel asks.
  await openActivityEditor(page, card(page, 'portraits'));
  await editor(page).locator('input[name="title"]').fill('Changed my mind');
  await editor(page).locator('.sheet-close').click();
  await expect(page.locator('#discard-dialog')).toBeVisible();

  // "Keep editing" puts it back with the typing intact.
  await page.locator('#discard-dialog .sheet-close').click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator('input[name="title"]')).toHaveValue('Changed my mind');

  await editor(page).locator('.sheet-close').click();
  await page.locator('[data-action="discard-confirm"]').click();
  await expect(editor(page)).toHaveCount(0);
  expect((await server.read()).plan.activities[1].title).toBe('Getting-ready Portraits');
});

test('D7: deleting does not ask, and offers Undo instead', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await act(page, 'travel', 'delete');
  await expect(card(page, 'travel')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Deleted Travel to Church');
  await saved(page);
  expect((await server.read()).plan.activities.map(a => a.id)).not.toContain('travel');

  await page.locator('.toast-action').click();
  await saved(page);
  await expect(card(page, 'travel')).toHaveCount(1);
  expect((await server.read()).plan.activities.map(a => a.id)).toEqual(
    ['ready', 'portraits', 'travel', 'ceremony', 'cocktail']);
});

test('D15: duplicating puts the copy right after the original, unlocked', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await act(page, 'ceremony', 'duplicate');
  await saved(page);

  const stored = (await server.read()).plan.activities;
  expect(stored[3].id).toBe('ceremony');
  expect(stored[4].title).toBe('Ceremony');
  expect(stored[4].id).not.toBe('ceremony');
  expect(stored[4].start, 'right after the original ends').toBe(T(15, 45));
  expect(stored[4].locked, 'a copy is never locked').toBe(false);
});

test('locking and unlocking toggles in place, with nothing else moving', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await act(page, 'travel', 'lock');
  await saved(page);
  await expect(page.locator('.toast')).toContainText('Locked Travel to Church');
  expect((await server.read()).plan.activities.find(a => a.id === 'travel').locked).toBe(true);
  expect((await server.read()).plan.activities.find(a => a.id === 'travel').start).toBe(T(12, 45));

  await act(page, 'travel', 'lock');
  await saved(page);
  await expect(page.locator('.toast')).toContainText('Unlocked Travel to Church');
  expect((await server.read()).plan.activities.find(a => a.id === 'travel').locked).toBe(false);
});

test('D3: a locked activity shows a solid dark lock, not a red one', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await card(page, 'ceremony').hover();
  const colour = await card(page, 'ceremony').locator('.lock-button').evaluate(node => getComputedStyle(node).backgroundColor);
  const [r, g, b] = colour.match(/\d+/g).map(Number);
  expect(r, 'the lock is ink, not red').toBeLessThan(90);
  expect(Math.abs(r - g), 'and it is not tinted').toBeLessThan(20);
  expect(Math.abs(g - b), 'and it is not tinted').toBeLessThan(20);
});

test.describe('open time', () => {
  const withGap = () => seedPlan({
    activities: [
      activity('arrive', T(13), 30, { title: 'Arrival & Buffer', location: 'Church' }),
      activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true })
    ]
  });

  test('tapping it offers three things, and changes nothing until one is picked', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time-add').click();
    const sheet = page.locator('#open-time-dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.action-header')).toContainText('1 hr 15 min open before Ceremony');
    await expect(sheet.locator('.action-header')).toContainText('1:30 PM – 2:45 PM');
    await expect(sheet.locator('.action-option')).toHaveCount(3);

    await sheet.locator('.action-cancel').click();
    await expect(sheet).toHaveCount(0);
    expect((await server.read()).revision).toBe(1);
  });

  test('D6: "Keep as buffer" adds a real Buffer activity for that time', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time-add').click();
    await page.locator('[data-choice="buffer"]').click();
    await saved(page);

    const stored = (await server.read()).plan.activities;
    expect(stored.map(a => a.title)).toEqual(['Arrival & Buffer', 'Buffer', 'Ceremony']);
    expect(stored[1].duration).toBe(75);
    expect(stored[1].stage).toBe('buffer');
    await expect(page.locator('.open-time')).toHaveCount(0);
  });

  test('"Extend" stretches the activity before it', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time-add').click();
    await expect(page.locator('[data-choice="extend"]')).toContainText('Extend Arrival & Buffer');
    await expect(page.locator('[data-choice="extend"]')).toContainText('Ends at 2:45 PM instead of 1:30 PM');
    await page.locator('[data-choice="extend"]').click();
    await saved(page);

    expect((await server.read()).plan.activities[0].duration).toBe(105);
    await expect(page.locator('.open-time')).toHaveCount(0);
  });

  test('"Add activity here" fills the time and opens the new activity', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time-add').click();
    await page.locator('[data-choice="add"]').click();

    await expect(editor(page)).toBeVisible();
    await editor(page).locator('input[name="title"]').fill('Photos outside');
    await editor(page).locator('button[type="submit"]').click();
    await saved(page);

    const stored = (await server.read()).plan.activities;
    expect(stored.map(a => a.title)).toEqual(['Arrival & Buffer', 'Photos outside', 'Ceremony']);
    expect(stored[1].duration).toBe(75);
  });

  test('cancelling "Add activity here" leaves the plan exactly as it was', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);
    const before = await server.read();

    await page.locator('.open-time-add').click();
    await page.locator('[data-choice="add"]').click();
    await expect(editor(page)).toBeVisible();

    // Walk away without typing a name.
    await editor(page).locator('.sheet-close').click();
    await expect(editor(page)).toHaveCount(0);

    // Nothing was added — and, because nothing untitled was added, the plan is
    // still one the server will accept.
    await expect(page.locator('.card')).toHaveCount(before.plan.activities.length);
    await expect(page.locator('.card-title', { hasText: /^$/ })).toHaveCount(0);
    await expect(page.locator('.open-time')).toHaveCount(1);

    await page.waitForTimeout(1200);
    const after = await server.read();
    expect(after.revision, 'cancelling is not a change').toBe(before.revision);

    // And the next ordinary edit still saves, which is the thing that broke.
    await openActivityEditor(page, card(page, 'ceremony'));
    await editor(page).locator('input[name="title"]').fill('Ceremony, renamed');
    await editor(page).locator('button[type="submit"]').click();
    await saved(page);
    expect((await server.read()).plan.activities.at(-1).title).toBe('Ceremony, renamed');
  });

  test('"Add activity here" can be given a shorter time than the gap', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time-add').click();
    await page.locator('[data-choice="add"]').click();

    // The gap's length is offered, and overtyping it is respected.
    await expect(editor(page).locator('input[name="duration"]')).toHaveValue('75');
    await editor(page).locator('input[name="duration"]').fill('30');
    await editor(page).locator('input[name="title"]').fill('Quick photos');
    await editor(page).locator('button[type="submit"]').click();
    await saved(page);

    const stored = (await server.read()).plan.activities;
    expect(stored.find(item => item.title === 'Quick photos').duration).toBe(30);
    // The rest of the gap is still open.
    await expect(page.locator('.open-time')).toHaveCount(1);
  });

  test('each choice can be undone', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time-add').click();
    await page.locator('[data-choice="buffer"]').click();
    await saved(page);

    await page.locator('.toast-action').click();
    await saved(page);
    expect((await server.read()).plan.activities.map(a => a.title)).toEqual(['Arrival & Buffer', 'Ceremony']);
  });

  test('tapping the body of a tall block selects it instead, revealing its handles', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    const gap = page.locator('.open-time');
    // Both are offered even though the next activity (ceremony) is locked —
    // dragging that one just won't do anything (see gestures.spec.mjs).
    await expect(gap.locator('.handle')).toHaveCount(2);
    await gap.locator('strong').click();
    await expect(page.locator('#open-time-dialog')).toHaveCount(0);
    await expect(gap).toHaveClass(/is-selected/);
    await expect(gap.locator('.handle--top')).toBeVisible();
    await expect(gap.locator('.handle--bottom')).toBeVisible();

    // Tapping it again clears the selection.
    await gap.locator('strong').click();
    await expect(gap).not.toHaveClass(/is-selected/);
  });

  test('selecting a block deselects a selected card, and selecting a card deselects a block', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    const gap = page.locator('.open-time');
    await select(page, 'arrive');
    await expect(card(page, 'arrive')).toHaveClass(/is-selected/);

    await gap.locator('strong').click();
    await expect(gap).toHaveClass(/is-selected/);
    await expect(card(page, 'arrive')).not.toHaveClass(/is-selected/);

    // Past the double-click window (DOUBLE_TAP_MS, gestures.js) — otherwise
    // this second tap on the same card reads as a double-click and opens
    // the editor instead of reselecting it.
    await page.waitForTimeout(450);
    await select(page, 'arrive');
    await expect(card(page, 'arrive')).toHaveClass(/is-selected/);
    await expect(gap).not.toHaveClass(/is-selected/);
  });

  test('a thin block has no + button, so tapping it still opens the sheet directly', async ({ page, server }) => {
    await server.seed({
      plan: seedPlan({
        activities: [
          activity('arrive', T(14), 30, { title: 'Arrival' }),
          // Locked so its own top handle never renders — otherwise that
          // handle's 44 px touch target (a11y.css) reaches back up into
          // this thin gap right above it and steals the click.
          activity('ceremony', T(14, 40), 60, { title: 'Ceremony', locked: true })
        ]
      })
    });
    await signInAndWaitForPlan(page);

    const gap = page.locator('.open-time');
    await expect(gap).toHaveClass(/open-time--thin/);
    await expect(gap.locator('.open-time-add')).toHaveCount(0);

    await gap.click();
    await expect(page.locator('#open-time-dialog')).toBeVisible();
  });
});

test.describe('undo', () => {
  const actions = [
    ['a stage change', async page => {
      if (isPhoneLayout(page)) {
        await select(page, 'travel');
        await page.locator('.toolbar [data-action="menu"]').click();
        await page.locator('#stage-dialog [data-stage="ceremony"]').click();
      } else {
        await card(page, 'travel').locator('.stage-tag--button').click();
        await page.locator('.stage-menu [data-stage="ceremony"]').click();
      }
    }],
    ['an edit', async page => {
      await openActivityEditor(page, card(page, 'travel'));
      await editor(page).locator('input[name="title"]').fill('Drive to the church');
      await editor(page).locator('button[type="submit"]').click();
    }],
    ['a delete', async page => act(page, 'travel', 'delete')],
    ['a duplicate', async page => act(page, 'travel', 'duplicate')]
  ];

  for (const [name, run] of actions) {
    test(`${name} can be taken back, exactly`, async ({ page, server }) => {
      await server.seed({ plan: base() });
      await signInAndWaitForPlan(page);
      const before = (await server.read()).plan;

      await run(page);
      await saved(page);
      expect((await server.read()).plan).not.toEqual(before);

      await page.locator('.toast-action').click();
      await saved(page);
      // Deep equality, not the same JSON text: a round trip through validation
      // may reorder keys, which changes nothing about the plan.
      expect((await server.read()).plan).toEqual(before);
    });
  }

  test('Ctrl+Z does the same as the toast', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a keyboard shortcut needs a keyboard');
    await server.seed({ plan: base() });
    await signInAndWaitForPlan(page);
    const before = (await server.read()).plan;

    await act(page, 'travel', 'delete');
    await saved(page);

    await page.keyboard.press('Control+z');
    await saved(page);
    expect((await server.read()).plan).toEqual(before);
  });

  test('Ctrl+Z inside a field is left to the browser', async ({ page, server, isMobile }) => {
    test.skip(Boolean(isMobile), 'a keyboard shortcut needs a keyboard');
    await server.seed({ plan: base() });
    await signInAndWaitForPlan(page);

    await act(page, 'travel', 'delete');
    await saved(page);

    await openActivityEditor(page, card(page, 'ready'));
    await editor(page).locator('input[name="title"]').fill('Typed');
    await editor(page).locator('input[name="title"]').press('Control+z');

    // The deleted activity is still gone: the shortcut did not reach the plan.
    expect((await server.read()).plan.activities.map(a => a.id)).not.toContain('travel');
  });
});

test('D7: nothing is announced that the screen already shows', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  const toasts = await trackToasts(page);

  // A save says "Saved" in the header; it does not also raise a toast.
  await openActivityEditor(page, card(page, 'portraits'));
  await editor(page).locator('input[name="location"]').fill('The garden');
  await editor(page).locator('button[type="submit"]').click();
  await saved(page);

  const messages = await toasts.all();
  expect(messages.some(text => /saved/i.test(text)), `unexpected: ${messages.join(' | ')}`).toBe(false);
  expect(messages.some(text => /Undo/.test(text)), 'but the change itself is offered back').toBe(true);
});
