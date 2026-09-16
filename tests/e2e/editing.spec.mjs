import { test, expect, activity, seedPlan } from './fixtures.mjs';
import { isPhoneLayout, openActivityEditor, signInAndWaitForPlan, trackToasts } from './helpers.mjs';

const card = (page, id) => page.locator(`.card[data-activity-id="${id}"]`);
const editor = page => page.locator('#activity-dialog');
const saved = page => expect(page.locator('.save-indicator')).toHaveText('Saved');

const base = () => seedPlan({
  dayStart: '11:30',
  activities: [
    activity('ready', 45, { title: 'Getting Ready', location: 'Getting-ready location', people: ['Bride'] }),
    activity('portraits', 30, { title: 'Getting-ready Portraits', people: ['Bride', 'Photographer'] }),
    activity('travel', 35, { title: 'Travel to Church' }),
    activity('ceremony', 60, { title: 'Ceremony', lockedStart: '14:45' }),
    activity('cocktail', 75, { title: 'Cocktail Hour' })
  ]
});

async function select(page, id) {
  await card(page, id).click({ position: { x: 40, y: 10 } });
  await expect(card(page, id)).toHaveClass(/is-selected/);
}

/** The control for an action, wherever this layout puts it. */
async function act(page, id, action) {
  if (isPhoneLayout(page)) {
    await select(page, id);
    await page.locator(`.toolbar [data-action="${action}"]`).click();
    return;
  }
  // The wide layout keeps lock on the card itself; the rest are in its menu.
  if (action === 'lock') {
    await card(page, id).hover();
    await card(page, id).locator('.lock-button').click();
    return;
  }
  await card(page, id).locator('.card-menu-toggle').click();
  await page.locator(`.card-menu [data-action="${action}"]`).click();
}

test('the editor asks for things in the order the spec gives', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'portraits'));

  const labels = await editor(page).locator('.field-label').allTextContents();
  expect(labels).toEqual(['Name', 'Timing', 'Location', 'Stage', 'People', 'Notes']);
  await expect(editor(page).locator('#delete-activity')).toBeVisible();
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

test('switching to Fixed offers the time it already starts at', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);
  await openActivityEditor(page, card(page, 'portraits'));

  await expect(editor(page).locator('.timing-flexible')).toContainText('Follows the activity before it');
  await editor(page).locator('.segmented label', { hasText: 'Fixed' }).click();

  await expect(editor(page).locator('.timing-fixed')).toBeVisible();
  await expect(editor(page).locator('input[name="lockedStart"]')).toHaveValue('12:15');

  await editor(page).locator('button[type="submit"]').click();
  await saved(page);
  expect((await server.read()).plan.activities[1].lockedStart).toBe('12:15');
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

test('D15: duplicating puts the copy after the original, without its fixed time', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await act(page, 'ceremony', 'duplicate');
  await saved(page);

  const stored = (await server.read()).plan.activities;
  expect(stored[3].id).toBe('ceremony');
  expect(stored[4].title).toBe('Ceremony');
  expect(stored[4].id).not.toBe('ceremony');
  expect(stored[4].lockedStart, 'two activities cannot own the same clock time').toBeNull();
});

test('fixing and unfixing say what it cost the rest of the day', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  await act(page, 'ceremony', 'lock');
  await saved(page);

  await expect(page.locator('.toast')).toContainText('Ceremony now starts');
  await expect(page.locator('.toast')).toContainText('shifted');
  expect((await server.read()).plan.activities[3].lockedStart).toBeNull();

  await page.locator('.toast-action').click();
  await saved(page);
  expect((await server.read()).plan.activities[3].lockedStart).toBe('14:45');
});

test('D3: a fixed activity shows a solid dark lock, not a red one', async ({ page, server }) => {
  await server.seed({ plan: base() });
  await signInAndWaitForPlan(page);

  const colour = await card(page, 'ceremony').locator('.glyph--fixed').evaluate(node => getComputedStyle(node).color);
  const [r, g, b] = colour.match(/\d+/g).map(Number);
  expect(r, 'the lock is ink, not red').toBeLessThan(90);
  expect(Math.abs(r - g), 'and it is not tinted').toBeLessThan(20);
});

test.describe('open time', () => {
  const withGap = () => seedPlan({
    dayStart: '13:00',
    activities: [
      activity('arrive', 30, { title: 'Arrival & Buffer', location: 'Church' }),
      activity('ceremony', 60, { title: 'Ceremony', lockedStart: '14:45' })
    ]
  });

  test('tapping it offers three things, and changes nothing until one is picked', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time').click();
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

    await page.locator('.open-time').click();
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

    await page.locator('.open-time').click();
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

    await page.locator('.open-time').click();
    await page.locator('[data-choice="add"]').click();

    await expect(editor(page)).toBeVisible();
    await editor(page).locator('input[name="title"]').fill('Photos outside');
    await editor(page).locator('button[type="submit"]').click();
    await saved(page);

    const stored = (await server.read()).plan.activities;
    expect(stored.map(a => a.title)).toEqual(['Arrival & Buffer', 'Photos outside', 'Ceremony']);
    expect(stored[1].duration).toBe(75);
  });

  test('each choice can be undone', async ({ page, server }) => {
    await server.seed({ plan: withGap() });
    await signInAndWaitForPlan(page);

    await page.locator('.open-time').click();
    await page.locator('[data-choice="buffer"]').click();
    await saved(page);

    await page.locator('.toast-action').click();
    await saved(page);
    expect((await server.read()).plan.activities.map(a => a.title)).toEqual(['Arrival & Buffer', 'Ceremony']);
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
