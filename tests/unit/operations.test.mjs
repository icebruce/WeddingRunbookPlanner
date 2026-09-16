import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule } from '../../public/src/schedule.js';
import {
  addInOpenTime,
  duplicate,
  extendPrevious,
  fix,
  insertAfter,
  keepAsBuffer,
  move,
  remove,
  resizeBottom,
  resizeTop,
  setStage,
  unfix,
  update
} from '../../public/src/operations.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, duration, extra = {}) => ({
  id, title: id, duration, stage: 'preparation', location: '', people: [], notes: '', lockedStart: null, ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day', title: 'Wedding Day', coupleLabel: 'Our Wedding',
  date: '2026-11-21', dayStart: '10:00', status: 'Working', activities, ...extra
});

const startsOf = p => Object.fromEntries(buildSchedule(p).items.map(item => [item.id, item.start]));
const durationsOf = p => Object.fromEntries(p.activities.map(a => [a.id, a.duration]));

test('nothing mutates the plan it was given', () => {
  const original = plan([activity('a', 30), activity('b', 30)]);
  const snapshot = structuredClone(original);
  resizeBottom(original, 'a', T(11));
  move(original, 'b', 0);
  remove(original, 'a');
  assert.deepEqual(original, snapshot);
});

test('resizing the bottom edge moves the end and ripples the rest', () => {
  const before = plan([activity('a', 30), activity('b', 30), activity('c', 30)]);
  const { plan: after, shifted } = resizeBottom(before, 'a', T(11));

  assert.equal(after.activities[0].duration, 60);
  assert.deepEqual(startsOf(after), { a: T(10), b: T(11), c: T(11, 30) });
  assert.deepEqual(shifted, { count: 2, deltaMinutes: 30 });
});

test('resizing to the same 5-minute line is not a change', () => {
  const before = plan([activity('a', 30)]);
  assert.equal(resizeBottom(before, 'a', T(10, 30)), null);
  assert.equal(resizeBottom(before, 'a', T(10, 28)), null, 'rounds up to the same 30 minutes');
});

test('D5: dragging the top edge down leaves open time before the activity', () => {
  const before = plan([activity('a', 30), activity('b', 30)]);
  const { plan: after } = resizeTop(before, 'b', T(10, 40));

  assert.equal(after.activities[1].gapBefore, 10);
  assert.equal(after.activities[1].duration, 20, 'the end stayed put');
  assert.deepEqual(startsOf(after), { a: T(10), b: T(10, 40) });
  assert.equal(buildSchedule(after).openTimes[0].kind, 'stored');
});

test('D5: dragging the top edge up consumes that open time and stops at the previous end', () => {
  const withGap = resizeTop(plan([activity('a', 30), activity('b', 30)]), 'b', T(10, 40)).plan;

  // Dragging above the previous activity's end does not overlap it: the
  // activity goes back to starting at 10:30 with its original 30 minutes.
  const { plan: after } = resizeTop(withGap, 'b', T(10, 20));
  assert.equal(after.activities[1].gapBefore, undefined, 'the stored open time is consumed');
  assert.equal(after.activities[1].duration, 30);
  assert.deepEqual(startsOf(after), { a: T(10), b: T(10, 30) }, 'it stops where the previous activity ends');
});

test('stored open time travels with its activity when earlier work grows', () => {
  const withGap = resizeTop(plan([activity('a', 30), activity('b', 30)]), 'b', T(10, 40)).plan;
  const { plan: after } = resizeBottom(withGap, 'a', T(11));

  assert.equal(after.activities[1].gapBefore, 10, 'the open time is still 10 minutes');
  assert.deepEqual(startsOf(after), { a: T(10), b: T(11, 10) });
});

test('the top edge cannot be dragged past the end, and a fixed activity has none', () => {
  const before = plan([activity('a', 30), activity('b', 30)]);
  const { plan: after } = resizeTop(before, 'b', T(23));
  assert.equal(after.activities[1].duration, 5, 'five minutes is the minimum');

  const fixed = plan([activity('a', 30), activity('b', 30, { lockedStart: '12:00' })]);
  assert.equal(resizeTop(fixed, 'b', T(11, 30)), null);
});

test('moving reorders and reports the shift', () => {
  const before = plan([activity('a', 30), activity('b', 60), activity('c', 30)]);
  const { plan: after, shifted } = move(before, 'c', 0);

  assert.deepEqual(after.activities.map(a => a.id), ['c', 'a', 'b']);
  // Moving the last activity to the front moves all three: it starts earlier,
  // and the two it jumped over start later.
  assert.equal(shifted.count, 3);
});

test('the first goes last, the last goes first, and a fixed activity is jumped over', () => {
  const before = plan([
    activity('a', 30),
    activity('b', 30),
    activity('fixed', 60, { lockedStart: '14:00' }),
    activity('d', 30)
  ]);

  // First to last.
  const toEnd = move(before, 'a', 3).plan;
  assert.deepEqual(toEnd.activities.map(item => item.id), ['b', 'fixed', 'd', 'a']);

  // Last to first.
  const toStart = move(before, 'd', 0).plan;
  assert.deepEqual(toStart.activities.map(item => item.id), ['d', 'a', 'b', 'fixed']);

  // A fixed activity cannot be dragged, but it can be dragged past: it keeps
  // the clock time it was pinned to whatever lands on either side of it.
  const past = move(before, 'a', 2).plan;
  assert.deepEqual(past.activities.map(item => item.id), ['b', 'fixed', 'a', 'd']);
  assert.equal(past.activities.find(item => item.id === 'fixed').lockedStart, '14:00');
});

test('a fixed activity cannot be moved, and a no-op move is not a change', () => {
  const fixed = plan([activity('a', 30), activity('b', 30, { lockedStart: '12:00' })]);
  assert.equal(move(fixed, 'b', 0), null);
  assert.equal(move(plan([activity('a', 30), activity('b', 30)]), 'b', 1), null);
});

test('fixing pins an activity at the time it already started', () => {
  const before = plan([activity('a', 30), activity('b', 30)]);
  const { plan: after } = fix(before, 'b');

  assert.equal(after.activities[1].lockedStart, '10:30');
  assert.deepEqual(startsOf(after), startsOf(before), 'fixing changes nothing on screen');
});

test('unfixing returns an activity to following the one before it, and says what moved', () => {
  const before = plan([activity('a', 30), activity('b', 30, { lockedStart: '12:00' }), activity('c', 30)]);
  const { plan: after, shifted, newStart } = unfix(before, 'b');

  assert.equal(after.activities[1].lockedStart, null);
  assert.deepEqual(startsOf(after), { a: T(10), b: T(10, 30), c: T(11) });
  assert.equal(newStart, T(10, 30));
  assert.deepEqual(shifted, { count: 2, deltaMinutes: -90 });
});

test('fixing clears stored open time, which a fixed start makes meaningless', () => {
  const withGap = resizeTop(plan([activity('a', 30), activity('b', 30)]), 'b', T(10, 40)).plan;
  const { plan: after } = fix(withGap, 'b');
  assert.equal('gapBefore' in after.activities[1], false);
  assert.equal(after.activities[1].lockedStart, '10:40');
});

test('D15: adding goes after the selected activity, duplicating after the original', () => {
  const before = plan([activity('a', 30), activity('b', 30)]);

  const added = insertAfter(before, 'a', activity('new', 30)).plan;
  assert.deepEqual(added.activities.map(x => x.id), ['a', 'new', 'b']);

  const appended = insertAfter(before, null, activity('last', 30)).plan;
  assert.deepEqual(appended.activities.map(x => x.id), ['a', 'b', 'last']);
});

test('D15: a duplicate copies everything except the fixed time', () => {
  const before = plan([activity('a', 45, {
    lockedStart: '12:00', location: 'Church', people: ['Bride'], notes: 'Bring rings', stage: 'ceremony'
  })]);
  const { plan: after } = duplicate(before, 'a', 'a-copy');
  const copy = after.activities[1];

  assert.equal(copy.id, 'a-copy');
  assert.equal(copy.title, 'a');
  assert.equal(copy.duration, 45);
  assert.equal(copy.stage, 'ceremony');
  assert.equal(copy.location, 'Church');
  assert.deepEqual(copy.people, ['Bride']);
  assert.equal(copy.notes, 'Bring rings');
  assert.equal(copy.lockedStart, null, 'two activities cannot own the same clock time');
});

test('removing pulls the rest of the day earlier', () => {
  const before = plan([activity('a', 30), activity('b', 60), activity('c', 30)]);
  const { plan: after, shifted } = remove(before, 'b');

  assert.deepEqual(after.activities.map(x => x.id), ['a', 'c']);
  assert.deepEqual(startsOf(after), { a: T(10), c: T(10, 30) });
  assert.deepEqual(shifted, { count: 1, deltaMinutes: -60 });
});

test('a stage change moves nothing', () => {
  const before = plan([activity('a', 30)]);
  const { plan: after, shifted } = setStage(before, 'a', 'ceremony');
  assert.equal(after.activities[0].stage, 'ceremony');
  assert.deepEqual(shifted, { count: 0, deltaMinutes: 0 });
  assert.equal(setStage(after, 'a', 'ceremony'), null);
});

test('an edit that changes the duration reports the ripple', () => {
  const before = plan([activity('a', 30), activity('b', 30)]);
  const { shifted } = update(before, { ...activity('a', 90), title: 'Longer' });
  assert.deepEqual(shifted, { count: 1, deltaMinutes: 60 });
});

// ------------------------------------------------------------- open time

const withOpenTime = () => plan([activity('a', 30), activity('fixed', 60, { lockedStart: '12:00' })]);
const firstGap = p => buildSchedule(p).openTimes[0];

test('D6: "Keep as buffer" inserts a real Buffer activity of exactly that length', () => {
  const before = withOpenTime();
  const { plan: after } = keepAsBuffer(before, firstGap(before), 'buffer-1');

  const buffer = after.activities.find(a => a.id === 'buffer-1');
  assert.equal(buffer.title, 'Buffer');
  assert.equal(buffer.stage, 'buffer');
  assert.equal(buffer.duration, 90);
  assert.deepEqual(after.activities.map(a => a.id), ['a', 'buffer-1', 'fixed']);

  const schedule = buildSchedule(after);
  assert.equal(schedule.openTimes.length, 0, 'the open time is now an activity');
  assert.equal(schedule.items[1].start, T(10, 30));
  assert.equal(schedule.items[2].start, T(12), 'the fixed activity has not moved');
});

test('"Keep as buffer" clears stored open time so the two do not stack', () => {
  const before = resizeTop(plan([activity('a', 30), activity('b', 30)]), 'b', T(10, 45)).plan;
  const { plan: after } = keepAsBuffer(before, firstGap(before), 'buffer-1');

  assert.equal('gapBefore' in after.activities.find(a => a.id === 'b'), false);
  assert.equal(buildSchedule(after).openTimes.length, 0);
  assert.deepEqual(startsOf(after), { a: T(10), 'buffer-1': T(10, 30), b: T(10, 45) });
});

test('"Extend" stretches the previous activity to the end of the open time', () => {
  const before = withOpenTime();
  const { plan: after } = extendPrevious(before, firstGap(before));

  assert.equal(after.activities[0].duration, 120, '10:00 to 12:00');
  assert.equal(buildSchedule(after).openTimes.length, 0);
  assert.equal(buildSchedule(after).items[1].start, T(12), 'still no conflict');
});

test('"Extend" works even when the previous activity is fixed', () => {
  const before = plan([
    activity('fixed-a', 30, { lockedStart: '10:00' }),
    activity('fixed-b', 30, { lockedStart: '12:00' })
  ]);
  const { plan: after } = extendPrevious(before, firstGap(before));

  assert.equal(after.activities[0].duration, 120);
  assert.equal(after.activities[0].lockedStart, '10:00', 'it still starts when it promised to');
});

test('"Add activity here" fills the open time exactly', () => {
  const before = withOpenTime();
  const { plan: after } = addInOpenTime(before, firstGap(before), activity('new', 30));

  const created = after.activities.find(a => a.id === 'new');
  assert.equal(created.duration, 90);
  assert.equal(created.lockedStart, null);
  assert.deepEqual(after.activities.map(a => a.id), ['a', 'new', 'fixed']);
  assert.equal(buildSchedule(after).openTimes.length, 0);
});

test('an open-time action against open time that no longer exists does nothing', () => {
  const before = withOpenTime();
  const stale = { ...firstGap(before), start: T(9) };
  assert.equal(keepAsBuffer(before, stale, 'x'), null);
  assert.equal(extendPrevious(before, stale), null);
  assert.equal(addInOpenTime(before, stale, activity('x', 30)), null);
});

test('every operation reports a shift the toast can read out', () => {
  const before = plan([activity('a', 30), activity('b', 30), activity('c', 30)]);
  for (const [name, result] of [
    ['resizeBottom', resizeBottom(before, 'a', T(11))],
    ['move', move(before, 'c', 0)],
    ['remove', remove(before, 'a')],
    ['insertAfter', insertAfter(before, 'a', activity('new', 15))]
  ]) {
    assert.ok(result, name);
    assert.equal(typeof result.shifted.count, 'number', `${name} count`);
    assert.equal(typeof result.shifted.deltaMinutes, 'number', `${name} delta`);
  }
});
