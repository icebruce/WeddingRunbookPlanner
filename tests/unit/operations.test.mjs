import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule } from '../../public/src/schedule.js';
import {
  addInOpenTime,
  duplicate,
  extendPrevious,
  insertAfter,
  keepAsBuffer,
  moveGroup,
  moveTo,
  remove,
  resizeBottom,
  resizeTop,
  setStage,
  toggleLock,
  update
} from '../../public/src/operations.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, start, duration, extra = {}) => ({
  id, title: id, start, duration, stage: 'preparation', location: '', people: [], notes: '', locked: false, ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day', title: 'Wedding Day', coupleLabel: 'Our Wedding',
  date: '2026-11-21', status: 'Working', activities, ...extra
});

const startsOf = p => Object.fromEntries(p.activities.map(a => [a.id, a.start]));

test('nothing mutates the plan it was given', () => {
  const original = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30)]);
  const snapshot = structuredClone(original);
  resizeBottom(original, 'a', T(11));
  moveTo(original, 'b', T(9));
  remove(original, 'a');
  assert.deepEqual(original, snapshot);
});

test('resizing the bottom edge moves the end only — nothing else changes', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30), activity('c', T(11), 30)]);
  const { plan: after } = resizeBottom(before, 'a', T(11));

  assert.equal(after.activities[0].duration, 60);
  assert.deepEqual(startsOf(after), { a: T(10), b: T(10, 30), c: T(11) }, 'b and c stay exactly where they were');
  const schedule = buildSchedule(after);
  assert.equal(schedule.overlaps.length, 1, 'a now overlaps b — that is drawn, not resolved');
});

test('resizing to the same 5-minute line is not a change', () => {
  const before = plan([activity('a', T(10), 30)]);
  assert.equal(resizeBottom(before, 'a', T(10, 30)), null);
  assert.equal(resizeBottom(before, 'a', T(10, 28)), null, 'rounds up to the same 30 minutes');
});

test('dragging the top edge down shortens the activity and leaves the gap it creates', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30)]);
  const { plan: after } = resizeTop(before, 'b', T(10, 40));

  assert.equal(after.activities[1].start, T(10, 40));
  assert.equal(after.activities[1].duration, 20, 'the end stayed put');
  const schedule = buildSchedule(after);
  assert.equal(schedule.openTimes.length, 1);
  assert.deepEqual({ start: schedule.openTimes[0].start, end: schedule.openTimes[0].end }, { start: T(10, 30), end: T(10, 40) });
});

test('dragging the top edge up can overlap the previous activity — it is not stopped there', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30)]);
  const { plan: after } = resizeTop(before, 'b', T(10, 15));

  assert.equal(after.activities[1].start, T(10, 15));
  assert.equal(after.activities[1].duration, 45, 'the end stayed put');
  assert.equal(buildSchedule(after).overlaps.length, 1, 'now overlapping a, which is drawn as an overlap');
});

test('the top edge cannot pass the end, and a locked activity has no handle to move', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30)]);
  const { plan: after } = resizeTop(before, 'b', T(23));
  assert.equal(after.activities[1].duration, 5, 'five minutes is the minimum');

  const locked = plan([activity('a', T(10), 30), activity('b', T(12), 30, { locked: true })]);
  assert.equal(resizeTop(locked, 'b', T(11, 30)), null);
});

test('moving sets the start directly, anywhere on the timeline', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(11), 60)]);
  const { plan: after } = moveTo(before, 'b', T(9));

  assert.deepEqual(startsOf(after), { a: T(10), b: T(9) }, 'b can land before a — nothing here reorders it');
});

test('a locked activity cannot be moved, and a no-op move is not a change', () => {
  const locked = plan([activity('a', T(10), 30), activity('b', T(12), 30, { locked: true })]);
  assert.equal(moveTo(locked, 'b', T(9)), null);
  assert.equal(moveTo(plan([activity('a', T(10), 30)]), 'a', T(10)), null);
});

test('moving a group shifts every member by the same amount, except a locked one', () => {
  const before = plan([
    activity('a', T(10), 30),
    activity('b', T(11), 30),
    activity('anchor', T(12), 30, { locked: true })
  ]);
  const { plan: after, movedCount } = moveGroup(before, ['a', 'b', 'anchor'], 15);

  assert.deepEqual(startsOf(after), { a: T(10, 15), b: T(11, 15), anchor: T(12) }, 'the locked one stays put');
  assert.equal(movedCount, 2);
});

test('moving a group by zero minutes is not a change', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(11), 30)]);
  assert.equal(moveGroup(before, ['a', 'b'], 0), null);
});

test('locking and unlocking toggles the one flag it owns', () => {
  const before = plan([activity('a', T(10), 30)]);
  const { plan: locked } = toggleLock(before, 'a');
  assert.equal(locked.activities[0].locked, true);
  assert.deepEqual(startsOf(locked), startsOf(before), 'locking changes nothing about where it sits');

  const { plan: unlocked } = toggleLock(locked, 'a');
  assert.equal(unlocked.activities[0].locked, false);
});

test('D15: adding goes after the selected activity, duplicating after the original', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30)]);

  const added = insertAfter(before, 'a', activity('new', T(10, 15), 30)).plan;
  assert.deepEqual(added.activities.map(x => x.id), ['a', 'new', 'b']);

  const appended = insertAfter(before, null, activity('last', T(11), 30)).plan;
  assert.deepEqual(appended.activities.map(x => x.id), ['a', 'b', 'last']);
});

test('D15: a duplicate copies everything, unlocked, right after the original ends', () => {
  const before = plan([activity('a', T(12), 45, {
    locked: true, location: 'Church', people: ['Bride'], notes: 'Bring rings', stage: 'ceremony'
  })]);
  const { plan: after } = duplicate(before, 'a', 'a-copy');
  const copy = after.activities[1];

  assert.equal(copy.id, 'a-copy');
  assert.equal(copy.title, 'a');
  assert.equal(copy.duration, 45);
  assert.equal(copy.start, T(12, 45), 'right after the original, not stacked on it');
  assert.equal(copy.stage, 'ceremony');
  assert.equal(copy.location, 'Church');
  assert.deepEqual(copy.people, ['Bride']);
  assert.equal(copy.notes, 'Bring rings');
  assert.equal(copy.locked, false, 'a copy is never locked — the original still is');
});

test('removing leaves the hole, and touches nothing else', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 60), activity('c', T(11, 30), 30)]);
  const { plan: after } = remove(before, 'b');

  assert.deepEqual(after.activities.map(x => x.id), ['a', 'c']);
  assert.deepEqual(startsOf(after), { a: T(10), c: T(11, 30) });
  assert.equal(buildSchedule(after).openTimes.length, 1, 'the hole b left is now open time');
});

test('a stage change moves nothing', () => {
  const before = plan([activity('a', T(10), 30)]);
  const { plan: after } = setStage(before, 'a', 'ceremony');
  assert.equal(after.activities[0].stage, 'ceremony');
  assert.equal(setStage(after, 'a', 'ceremony'), null);
});

test('editing an activity through update() replaces it whole and moves nothing else', () => {
  const before = plan([activity('a', T(10), 30), activity('b', T(10, 30), 30)]);
  const { plan: after } = update(before, { ...activity('a', T(10), 90), title: 'Longer' });
  assert.equal(after.activities[0].duration, 90);
  assert.equal(after.activities[0].title, 'Longer');
  assert.equal(after.activities[1].start, T(10, 30), 'b never moves on its own');
});

// ------------------------------------------------------------- open time

const withOpenTime = () => plan([activity('a', T(10), 30), activity('fixed', T(12), 60)]);
const firstGap = p => buildSchedule(p).openTimes[0];

test('D6: "Keep as buffer" inserts a real Buffer activity of exactly that length', () => {
  const before = withOpenTime();
  const { plan: after } = keepAsBuffer(before, firstGap(before), 'buffer-1');

  const buffer = after.activities.find(a => a.id === 'buffer-1');
  assert.equal(buffer.title, 'Buffer');
  assert.equal(buffer.stage, 'buffer');
  assert.equal(buffer.duration, 90);
  assert.equal(buffer.start, T(10, 30));
  assert.deepEqual(after.activities.map(a => a.id), ['a', 'buffer-1', 'fixed']);

  const schedule = buildSchedule(after);
  assert.equal(schedule.openTimes.length, 0, 'the open time is now an activity');
  assert.equal(schedule.items[2].start, T(12), 'the other activity has not moved');
});

test('"Extend" stretches the previous activity to the end of the open time', () => {
  const before = withOpenTime();
  const { plan: after } = extendPrevious(before, firstGap(before));

  assert.equal(after.activities[0].duration, 120, '10:00 to 12:00');
  assert.equal(buildSchedule(after).openTimes.length, 0);
});

test('"Extend" works even when the previous activity is locked', () => {
  const before = plan([
    activity('locked-a', T(10), 30, { locked: true }),
    activity('locked-b', T(12), 30, { locked: true })
  ]);
  const { plan: after } = extendPrevious(before, firstGap(before));

  assert.equal(after.activities[0].duration, 120);
  assert.equal(after.activities[0].locked, true, 'extending duration is not the same as moving it');
});

test('"Add activity here" fills the open time exactly', () => {
  const before = withOpenTime();
  // No duration of its own: the gap's length is what it takes (§5.9).
  const blank = activity('new', 0, 30);
  delete blank.duration;
  const { plan: after } = addInOpenTime(before, firstGap(before), blank);

  const created = after.activities.find(a => a.id === 'new');
  assert.equal(created.duration, 90);
  assert.equal(created.start, T(10, 30));
  assert.deepEqual(after.activities.map(a => a.id), ['a', 'new', 'fixed']);
  assert.equal(buildSchedule(after).openTimes.length, 0);
});

test('"Add activity here" takes a shorter time if it is given one', () => {
  // The editor opens before anything is added, pre-filled with the gap, so a
  // duration that reaches here was typed. Overriding it would throw away what
  // the person asked for; the rest of the gap simply stays open.
  const before = withOpenTime();
  const { plan: after } = addInOpenTime(before, firstGap(before), activity('new', 0, 30));

  const created = after.activities.find(a => a.id === 'new');
  assert.equal(created.duration, 30);
  assert.equal(buildSchedule(after).openTimes.length, 1, 'the remaining hour is still open');
});

test('an open-time action against open time that no longer exists does nothing', () => {
  const before = withOpenTime();
  const stale = { ...firstGap(before), start: T(9) };
  assert.equal(keepAsBuffer(before, stale, 'x'), null);
  assert.equal(extendPrevious(before, stale), null);
  assert.equal(addInOpenTime(before, stale, activity('x', 0, 30)), null);
});
