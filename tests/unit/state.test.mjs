import test from 'node:test';
import assert from 'node:assert/strict';

import '../../public/src/actions.js';
import { createStore, defineAction } from '../../public/src/state.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, start, extra = {}) => ({
  id,
  title: id,
  start,
  duration: 30,
  stage: 'preparation',
  location: '',
  people: [],
  notes: '',
  locked: false,
  ...extra
});

const plan = (...activities) => ({
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  timezone: 'America/Toronto',
  activities: activities.length ? activities : [activity('a', T(11, 30)), activity('b', T(12)), activity('c', T(12, 30))]
});

const store = (...activities) => createStore({ plan: plan(...activities), revision: 1 });

test('an action never mutates the plan it was given', () => {
  const s = store();
  const before = s.plan;
  s.dispatch('activity.stage', { id: 'a', stage: 'ceremony' });
  assert.equal(before.activities[0].stage, 'preparation', 'the previous plan is untouched');
  assert.equal(s.plan.activities[0].stage, 'ceremony');
  assert.notEqual(s.plan, before);
});

test('every change records one undo step with a readable label', () => {
  const s = store();
  assert.equal(s.canUndo, false);

  const result = s.dispatch('activity.remove', { id: 'b' });
  assert.equal(result.label, 'Deleted b');
  assert.equal(s.canUndo, true);
  assert.equal(s.undoLabel, 'Deleted b');
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'c']);

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'b', 'c']);
});

test('the undo buffer holds one step, and undoing twice returns to where you were', () => {
  const s = store();
  s.dispatch('activity.remove', { id: 'a' });
  s.dispatch('activity.remove', { id: 'b' });
  assert.deepEqual(s.plan.activities.map(a => a.id), ['c']);

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['b', 'c'], 'only the last change is undone');

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['c'], 'undo is itself undoable');
});

test('an action that changes nothing records nothing', () => {
  const s = store();
  s.dispatch('activity.stage', { id: 'a', stage: 'ceremony' });
  const noop = s.dispatch('activity.stage', { id: 'a', stage: 'ceremony' });

  assert.equal(noop, null);
  assert.equal(s.undoLabel, 'Changed stage of a', 'the earlier step is still the one on offer');
});

test('moving a card to the start it already has is not a change', () => {
  const s = store();
  assert.equal(s.dispatch('activity.moveTo', { id: 'b', start: T(12) }), null);
  assert.equal(s.canUndo, false);
});

test('moving sets the start directly and reports where the activity landed', () => {
  const s = store();
  const result = s.dispatch('activity.moveTo', { id: 'c', start: T(9) });
  assert.equal(s.plan.activities.find(a => a.id === 'c').start, T(9));
  // The time is in the label because the undo toast is how a mis-drop is caught.
  assert.equal(result.label, 'Moved c to 9:00 AM');
});

test('moving a group shifts everyone in it, except a locked member', () => {
  const s = store(activity('a', T(10)), activity('b', T(11)), activity('anchor', T(12), { locked: true }));
  const result = s.dispatch('activity.moveGroup', { ids: ['a', 'b', 'anchor'], deltaMinutes: 15 });

  assert.equal(s.plan.activities.find(x => x.id === 'a').start, T(10, 15));
  assert.equal(s.plan.activities.find(x => x.id === 'b').start, T(11, 15));
  assert.equal(s.plan.activities.find(x => x.id === 'anchor').start, T(12), 'the locked one does not move');
  assert.equal(result.label, 'Moved 2 activities');
});

test('locking toggles in place and does not move the activity', () => {
  const s = store();
  s.dispatch('activity.toggleLock', { id: 'b' });
  assert.equal(s.plan.activities[1].locked, true);
  assert.equal(s.plan.activities[1].start, T(12), 'locking does not move it');

  s.dispatch('activity.toggleLock', { id: 'b' });
  assert.equal(s.plan.activities[1].locked, false);
});

test('durations are normalised by the action, not by the caller', () => {
  const s = store();
  s.dispatch('activity.duration', { id: 'a', duration: 42 });
  assert.equal(s.plan.activities[0].duration, 45);
  assert.equal(s.dispatch('activity.duration', { id: 'a', duration: 43 }), null, '43 also rounds to 45 — no change');
});

test('adding places the activity after the selected one, or at the end', () => {
  const s = store();
  s.dispatch('activity.add', { activity: activity('new', T(11, 45)), afterId: 'a' });
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'new', 'b', 'c']);

  s.dispatch('activity.add', { activity: activity('last', T(13)) });
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'new', 'b', 'c', 'last']);
});

test('UI state is separate from the plan and is never part of a change', () => {
  const s = store();
  s.setUi({ selectedId: 'b', openMenu: 'stage:b' });

  assert.equal(s.ui.selectedId, 'b');
  assert.equal(s.canUndo, false, 'selecting something is not an undoable change');
  assert.equal('selectedId' in s.plan, false);
  assert.equal(JSON.stringify(s.plan).includes('openMenu'), false);
});

test('a group selection lives in its own field, empty by default', () => {
  const s = store();
  assert.deepEqual(s.ui.groupSelection, []);
  s.setUi({ groupSelection: ['a', 'b'] });
  assert.deepEqual(s.ui.groupSelection, ['a', 'b']);
});

test('setUi reports whether anything actually changed', () => {
  const s = store();
  assert.equal(s.setUi({ selectedId: 'b' }), true);
  assert.equal(s.setUi({ selectedId: 'b' }), false, 'setting the same value repaints nothing');
});

test('subscribers are told which regions to repaint and whether data changed', () => {
  const s = store();
  const seen = [];
  s.subscribe(change => seen.push(change));

  s.setUi({ selectedId: 'a' }, { regions: ['timeline', 'toolbar'] });
  s.dispatch('activity.remove', { id: 'a' }, { regions: ['timeline', 'summary'] });

  assert.deepEqual(seen[0], { regions: ['timeline', 'toolbar'], data: false });
  assert.deepEqual(seen[1], { regions: ['timeline', 'summary'], data: true });
});

test('replacing the plan clears the undo buffer, because it belongs to the old plan', () => {
  const s = store();
  s.dispatch('activity.remove', { id: 'a' });
  assert.equal(s.canUndo, true);

  s.setPlan(plan(), { revision: 9 });
  assert.equal(s.canUndo, false);
  assert.equal(s.revision, 9);
});

test('an unknown action is a programming error, not a silent no-op', () => {
  const s = store();
  assert.throws(() => s.dispatch('activity.teleport', {}), /Unknown action/);
});

test('a custom action can still be registered directly', () => {
  defineAction('test.custom', p => ({ plan: p, label: 'Custom' }));
  const s = store();
  const result = s.dispatch('test.custom', {});
  assert.equal(result.label, 'Custom');
});

test('activity.update replaces the activity whole and records a readable label', () => {
  const s = store();
  const before = s.plan;
  const edited = { ...before.activities[0], title: 'Getting Ready — Updated', duration: 90 };

  const result = s.dispatch('activity.update', { activity: edited });

  assert.equal(s.plan.activities[0].title, 'Getting Ready — Updated');
  assert.equal(s.plan.activities[0].duration, 90);
  assert.equal(result.label, 'Edited Getting Ready — Updated');
  assert.equal(s.undoLabel, 'Edited Getting Ready — Updated');
  assert.equal(before.activities[0].title, 'a', 'the previous plan is untouched');
});

test('activity.resizeBottom moves the end and records a readable label', () => {
  const s = store();
  const before = s.plan;

  const result = s.dispatch('activity.resizeBottom', { id: 'a', newEnd: T(12, 30) });

  assert.equal(s.plan.activities[0].duration, 60);
  assert.equal(result.label, 'Resized a');
  assert.notEqual(s.plan, before);

  const noop = s.dispatch('activity.resizeBottom', { id: 'a', newEnd: T(12, 30) });
  assert.equal(noop, null, 'resizing to the same edge is not a change');
});

test('activity.resizeTop moves the start, keeps the end, and records a readable label', () => {
  const s = store();
  const before = s.plan;

  const result = s.dispatch('activity.resizeTop', { id: 'b', newStart: T(12, 10) });

  assert.equal(s.plan.activities[1].start, T(12, 10));
  assert.equal(result.label, 'Resized b');
  assert.notEqual(s.plan, before);

  const noop = s.dispatch('activity.resizeTop', { id: 'b', newStart: T(12, 10) });
  assert.equal(noop, null, 'resizing to the same edge is not a change');
});

test('openTime.buffer turns open time into a real Buffer activity', () => {
  const s = store(activity('a', T(10), { duration: 30 }), activity('fixed', T(12), { duration: 30 }));
  const openTime = { beforeId: 'fixed', start: T(10, 30), end: T(12) };

  const result = s.dispatch('openTime.buffer', { openTime, newId: 'buffer-1' });

  const buffer = s.plan.activities.find(a => a.id === 'buffer-1');
  assert.equal(buffer.title, 'Buffer');
  assert.equal(buffer.duration, 90);
  assert.equal(result.label, 'Added Buffer');

  const stale = { ...openTime, start: T(9) };
  assert.equal(s.dispatch('openTime.buffer', { openTime: stale, newId: 'buffer-2' }), null, 'gone open time is a no-op');
});

test('openTime.extend stretches the previous activity to close the gap', () => {
  const s = store(activity('a', T(10), { duration: 30 }), activity('fixed', T(12), { duration: 30 }));
  const openTime = { beforeId: 'fixed', start: T(10, 30), end: T(12) };

  const result = s.dispatch('openTime.extend', { openTime });

  assert.equal(s.plan.activities.find(x => x.id === 'a').duration, 120);
  assert.equal(result.label, 'Extended the previous activity');

  const stale = { ...openTime, start: T(9) };
  assert.equal(s.dispatch('openTime.extend', { openTime: stale }), null, 'gone open time is a no-op');
});

test('openTime.add fills the gap with a new activity', () => {
  const s = store(activity('a', T(10), { duration: 30 }), activity('fixed', T(12), { duration: 30 }));
  const openTime = { beforeId: 'fixed', start: T(10, 30), end: T(12) };
  const newActivity = activity('new', 0);
  delete newActivity.duration;

  const result = s.dispatch('openTime.add', { openTime, activity: newActivity });

  const created = s.plan.activities.find(x => x.id === 'new');
  assert.equal(created.duration, 90, 'takes the whole gap by default');
  assert.equal(result.label, 'Added new');
});

test('plan.settings applies the changed fields and records one undo step', () => {
  const s = store();
  const before = s.plan;

  const result = s.dispatch('plan.settings', { changes: { title: 'Our Big Day', sunset: '17:05' } });

  assert.equal(s.plan.title, 'Our Big Day');
  assert.equal(s.plan.sunset, '17:05');
  assert.equal(result.label, 'Changed plan settings');
  assert.equal(before.title, 'Wedding Day', 'the previous plan is untouched');
});

test('plan.settings with only unchanged values records nothing', () => {
  const s = store();
  const noop = s.dispatch('plan.settings', { changes: { title: s.plan.title, date: s.plan.date } });
  assert.equal(noop, null);
  assert.equal(s.canUndo, false);
});

test('plan.replaceActivities swaps the whole day in as one undoable step', () => {
  const s = store();
  const before = s.plan;
  const replacement = [activity('x', T(9)), activity('y', T(10))];

  const result = s.dispatch('plan.replaceActivities', { activities: replacement });

  assert.deepEqual(s.plan.activities.map(a => a.id), ['x', 'y']);
  assert.equal(result.label, 'Used the wedding template');
  assert.equal(s.canUndo, true);
  assert.deepEqual(before.activities.map(a => a.id), ['a', 'b', 'c'], 'the previous plan is untouched');

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'b', 'c']);
});
